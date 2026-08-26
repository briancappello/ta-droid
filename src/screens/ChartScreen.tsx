import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { fetchHistory, type HistoryResponse } from '../api';
import { LIGHTWEIGHT_CHARTS_JS } from '../vendor/lightweightCharts';
import { useAccounts } from '../AccountContext';
import { holdingsForSymbol, type SymbolHolding } from '../flatten';
import { freqToTimeframe } from '../marketstore';
import { stream } from '../marketstoreStream';
import { barFromBarPayload, easternOffset } from '../chartTime';

type Props = NativeStackScreenProps<RootStackParamList, 'Chart'>;

// --- Range/Frequency Config ---

type FreqOption = {
  label: string;
  value: string; // maps to Freq enum name on backend
};

type RangeConfig = {
  label: string;
  defaultFreq: string;
  freqOptions: FreqOption[];
  // Duration of the visual window in milliseconds
  windowMs: number;
  // How many bars to over-request from the backend (buffer factor)
  requestMultiplier: number;
};

const HOURS_MS = 60 * 60 * 1000;
const DAYS_MS = 24 * HOURS_MS;

// Extended hours: 4am-8pm ET = 16 hours
const EXTENDED_DAY_HOURS = 16;

// Minutes per bar for each frequency (for request size estimation)
const FREQ_MINUTES: Record<string, number> = {
  '1min': 1,
  '5min': 5,
  '10min': 10,
  '15min': 15,
  '30min': 30,
  h: 60,
  D: EXTENDED_DAY_HOURS * 60,
  W: EXTENDED_DAY_HOURS * 60 * 5,
  M: EXTENDED_DAY_HOURS * 60 * 21,
};

// Estimate how many bars to request from the backend.
// Over-requests by the multiplier to ensure we have enough data to slice.
function getRequestBars(range: RangeConfig, freq: string): number {
  const windowMinutes = range.windowMs / (60 * 1000);
  const freqMinutes = FREQ_MINUTES[freq] ?? EXTENDED_DAY_HOURS * 60;
  return Math.ceil((windowMinutes / freqMinutes) * range.requestMultiplier);
}

// Slice the response data to only include bars within the visual window.
// Looks at the latest timestamp and works backwards.
function sliceToWindow(
  data: HistoryResponse,
  windowMs: number,
): HistoryResponse {
  if (data.index.length === 0) {
    return data;
  }
  const latestTs = data.index[data.index.length - 1];
  const windowStart = latestTs - windowMs;

  let startIdx = 0;
  for (let i = 0; i < data.index.length; i++) {
    if (data.index[i] >= windowStart) {
      startIdx = i;
      break;
    }
  }

  return {
    columns: data.columns,
    index: data.index.slice(startIdx),
    data: data.data.slice(startIdx),
  };
}

const RANGES: RangeConfig[] = [
  {
    label: '1D',
    defaultFreq: '1min',
    freqOptions: [
      { label: '1min', value: '1min' },
      { label: '5min', value: '5min' },
      { label: '10min', value: '10min' },
      { label: '15min', value: '15min' },
    ],
    windowMs: 1 * DAYS_MS,
    requestMultiplier: 2,
  },
  {
    label: '1W',
    defaultFreq: '5min',
    freqOptions: [
      { label: '5min', value: '5min' },
      { label: '10min', value: '10min' },
      { label: '15min', value: '15min' },
      { label: '30min', value: '30min' },
      { label: '1hr', value: 'h' },
    ],
    windowMs: 7 * DAYS_MS,
    requestMultiplier: 2,
  },
  {
    label: '1M',
    defaultFreq: 'h',
    freqOptions: [
      { label: '15min', value: '15min' },
      { label: '30min', value: '30min' },
      { label: '1hr', value: 'h' },
      { label: '1D', value: 'D' },
    ],
    windowMs: 30 * DAYS_MS,
    requestMultiplier: 1.5,
  },
  {
    label: '6M',
    defaultFreq: 'D',
    freqOptions: [
      { label: '1D', value: 'D' },
      { label: '1W', value: 'W' },
    ],
    windowMs: 182 * DAYS_MS,
    requestMultiplier: 1.5,
  },
  {
    label: '1Y',
    defaultFreq: 'D',
    freqOptions: [
      { label: '1D', value: 'D' },
      { label: '1W', value: 'W' },
    ],
    windowMs: 365 * DAYS_MS,
    requestMultiplier: 1.5,
  },
  {
    label: '5Y',
    defaultFreq: 'W',
    freqOptions: [
      { label: '1W', value: 'W' },
      { label: '1M', value: 'M' },
    ],
    windowMs: 5 * 365 * DAYS_MS,
    requestMultiplier: 1.3,
  },
];

// --- Timezone Helpers ---
//
// TIMEZONE STRATEGY:
// Lightweight Charts only understands UTC. To display Eastern time on the
// chart axis, we shift each UTC timestamp by the America/New_York offset
// before passing it to the chart. This produces "fake UTC" timestamps that
// actually represent Eastern time. Anywhere you see getUTC*() called on
// these shifted timestamps, it is intentionally reading back Eastern time,
// not real UTC.

// Pre-compute Eastern UTC offset (seconds) for a batch of timestamps.
// Returns a simple array of offsets aligned with the input timestamps.
// Only calls Intl twice in the common case (no DST boundary in range).
function buildEasternOffsets(timestamps: number[]): number[] {
  if (timestamps.length === 0) {
    return [];
  }

  const getOffset = easternOffset;

  const firstOffset = getOffset(timestamps[0]);
  const lastOffset = getOffset(timestamps[timestamps.length - 1]);

  // Fast path: no DST boundary in range
  if (firstOffset === lastOffset) {
    return new Array(timestamps.length).fill(firstOffset);
  }

  // DST boundary exists — find it with binary search, then fill
  let lo = 0;
  let hi = timestamps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (getOffset(timestamps[mid]) === firstOffset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo is the index where offset changes
  const offsets = new Array(timestamps.length);
  offsets.fill(firstOffset, 0, lo);
  offsets.fill(lastOffset, lo);
  return offsets;
}

// --- Chart HTML Builder ---

function buildChartHtml(data: HistoryResponse, rangeLabel: string): string {
  const colIdx: Record<string, number> = {};
  data.columns.forEach((col, i) => {
    colIdx[col] = i;
  });

  // Pre-compute timezone offsets once for all timestamps
  const offsets = buildEasternOffsets(data.index);

  // Pre-compute chart times once (shifted to "fake UTC" representing Eastern time;
  // see TIMEZONE STRATEGY comment above)
  const chartTimes: number[] = new Array(data.index.length);
  for (let i = 0; i < data.index.length; i++) {
    chartTimes[i] = Math.floor(data.index[i] / 1000) + offsets[i];
  }

  const candles = data.index.map((_ts, i) => {
    const row = data.data[i];
    return {
      time: chartTimes[i],
      open: row[colIdx.open],
      high: row[colIdx.high],
      low: row[colIdx.low],
      close: row[colIdx.close],
    };
  });

  const volumes = data.index.map((_ts, i) => {
    const row = data.data[i];
    const close = row[colIdx.close];
    const open = row[colIdx.open];
    return {
      time: chartTimes[i],
      value: row[colIdx.volume],
      color: close >= open ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)',
    };
  });

  const buildLineSeries = (colName: string) => {
    if (!(colName in colIdx)) {
      return [];
    }
    const result: { time: number; value: number }[] = [];
    for (let i = 0; i < data.index.length; i++) {
      const val = data.data[i][colIdx[colName]];
      if (val === null || val === undefined || Number.isNaN(val)) {
        continue;
      }
      result.push({ time: chartTimes[i], value: val });
    }
    return result;
  };

  const sma20 = buildLineSeries('sma20');
  const sma100 = buildLineSeries('sma100');
  const sma200 = buildLineSeries('sma200');
  const bbandsUpper = buildLineSeries('bbands_upper');
  const bbandsLower = buildLineSeries('bbands_lower');
  const macd = buildLineSeries('macd');
  const macdSignal = buildLineSeries('macd_signal');
  const rsi = buildLineSeries('rsi');

  const macdHist = data.index
    .map((_ts, i) => {
      const val = data.data[i][colIdx.macd_difference];
      if (val === null || val === undefined || Number.isNaN(val)) {
        return null;
      }
      return {
        time: chartTimes[i],
        value: val,
        color: val >= 0 ? 'rgba(76,175,80,0.7)' : 'rgba(244,67,54,0.7)',
      };
    })
    .filter(Boolean);

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <script>
    window.onerror = function(msg, url, line) {
      document.body.innerHTML = '<pre style="color:red;padding:20px">' + msg + '\\n' + url + ':' + line + '</pre>';
    };
  </script>
  <script>${LIGHTWEIGHT_CHARTS_JS}</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: #1a1a2e; overflow: hidden; width: 100vw; height: 100vh; }
    #main-chart { width: 100vw; height: 55vh; }
    #macd-chart { width: 100vw; height: 22vh; border-top: 1px solid #333; }
    #rsi-chart  { width: 100vw; height: 23vh; border-top: 1px solid #333; }
  </style>
</head>
<body>
  <div id="main-chart"></div>
  <div id="macd-chart"></div>
  <div id="rsi-chart"></div>
  <script>
    var rangeLabel = ${JSON.stringify(rangeLabel)};

    // Timestamps are "fake UTC" shifted to Eastern time (see TIMEZONE STRATEGY).
    // Using getUTC*() here intentionally reads back Eastern hours/minutes/etc.
    function formatTick(time) {
      var d = new Date(time * 1000);
      var h = d.getUTCHours();
      var m = d.getUTCMinutes();
      var mon = d.getUTCMonth();
      var day = d.getUTCDate();
      var year = d.getUTCFullYear();
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      if (rangeLabel === '1D') {
        if (h === 9 && m === 30) { return '9:30'; }
        if (m !== 0) { return ''; }
        var h12 = h % 12 || 12;
        return h12 + '';
        return '';
      }
      if (rangeLabel === '1W') {
        var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        var wh = h % 12 || 12;
        return days[d.getUTCDay()] + ' ' + wh + (m ? ':' + (m < 10 ? '0' + m : m) : '');
      }
      if (rangeLabel === '1M' || rangeLabel === '6M') {
        return months[mon] + ' ' + day;
      }
      if (rangeLabel === '1Y') {
        return months[mon] + ' ' + day;
      }
      // 5Y
      return months[mon] + ' ' + year;
    }

    var chartOpts = {
      layout: { background: { color: '#1a1a2e' }, textColor: '#ccc', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: '#1e2940' }, horzLines: { color: '#1e2940' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#333' },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
        tickMarkFormatter: formatTick,
        tickMarkMaxCharacterLength: 5,
      },
    };

    var main = LightweightCharts.createChart(
      document.getElementById('main-chart'), chartOpts
    );

    var candleSeries = main.addCandlestickSeries({
      upColor: '#4caf50', downColor: '#f44336',
      borderUpColor: '#4caf50', borderDownColor: '#f44336',
      wickUpColor: '#4caf50', wickDownColor: '#f44336',
      priceLineVisible: false,
    });
    candleSeries.setData(${JSON.stringify(candles)});

    var volumeSeries = main.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
    });
    main.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(${JSON.stringify(volumes)});

    window.__pushBar = function (b) {
      candleSeries.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
      volumeSeries.update({ time: b.time, value: b.volume, color: b.close >= b.open ? '#4caf50' : '#f44336' });
    };

    ${
      sma20.length > 0
        ? `
    main.addLineSeries({ color: '#ff9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      sma20,
    )});
    `
        : ''
    }
    ${
      sma100.length > 0
        ? `
    main.addLineSeries({ color: '#2196f3', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      sma100,
    )});
    `
        : ''
    }
    ${
      sma200.length > 0
        ? `
    main.addLineSeries({ color: '#e91e63', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      sma200,
    )});
    `
        : ''
    }
    ${
      bbandsUpper.length > 0
        ? `
    main.addLineSeries({ color: 'rgba(33,150,243,0.4)', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      bbandsUpper,
    )});
    main.addLineSeries({ color: 'rgba(33,150,243,0.4)', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      bbandsLower,
    )});
    `
        : ''
    }

    main.timeScale().fitContent();

    var macdChart = LightweightCharts.createChart(
      document.getElementById('macd-chart'),
      Object.assign({}, chartOpts, {
        timeScale: { borderColor: '#333', timeVisible: true, visible: false },
      })
    );

    ${
      macd.length > 0
        ? `
    macdChart.addLineSeries({ color: '#2196f3', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      macd,
    )});
    macdChart.addLineSeries({ color: '#ff9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      macdSignal,
    )});
    macdChart.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      macdHist,
    )});
    `
        : ''
    }
    macdChart.timeScale().fitContent();

    var rsiChart = LightweightCharts.createChart(
      document.getElementById('rsi-chart'), chartOpts
    );

    ${
      rsi.length > 0
        ? `
    rsiChart.addLineSeries({ color: '#ab47bc', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      rsi,
    )});
    `
        : ''
    }
    rsiChart.timeScale().fitContent();

    // Sync time scales
    main.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
      if (range) {
        macdChart.timeScale().setVisibleLogicalRange(range);
        rsiChart.timeScale().setVisibleLogicalRange(range);
      }
    });
    macdChart.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
      if (range) {
        main.timeScale().setVisibleLogicalRange(range);
        rsiChart.timeScale().setVisibleLogicalRange(range);
      }
    });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
      if (range) {
        main.timeScale().setVisibleLogicalRange(range);
        macdChart.timeScale().setVisibleLogicalRange(range);
      }
    });
  </script>
</body>
</html>`;
}

// --- Toolbar Components ---

function RangePills({
  ranges,
  activeIndex,
  onSelect,
}: {
  ranges: RangeConfig[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <View style={styles.pillRow}>
      {ranges.map((r, i) => (
        <TouchableOpacity
          key={r.label}
          style={[styles.pill, activeIndex === i && styles.pillActive]}
          onPress={() => onSelect(i)}
        >
          <Text
            style={[
              styles.pillText,
              activeIndex === i && styles.pillTextActive,
            ]}
          >
            {r.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function FreqDropdown({
  options,
  selected,
  onSelect,
}: {
  options: FreqOption[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    options.find(o => o.value === selected)?.label ?? selected;

  return (
    <View>
      <TouchableOpacity style={styles.freqButton} onPress={() => setOpen(true)}>
        <Text style={styles.freqButtonText}>{selectedLabel} ▼</Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.dropdownMenu}>
            {options.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.dropdownItem,
                  opt.value === selected && styles.dropdownItemActive,
                ]}
                onPress={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    opt.value === selected && styles.dropdownItemTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// --- Screen ---

export default function ChartScreen({ route, navigation }: Props) {
  const { ticker } = route.params;
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const { accounts, activeId } = useAccounts();
  const [rangeIndex, setRangeIndex] = useState(4); // default 1Y
  const [freq, setFreq] = useState('D');
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<SymbolHolding[]>([]);

  // ponytail: holdingsForSymbol re-fetches every account's full position list on
  // each ticker change, with no shared cache between PositionsScreen and this
  // screen. Fine at single-user scale; add a shared positions cache if
  // chart-hopping volume makes the redundant Alpaca calls matter.
  useEffect(() => {
    holdingsForSymbol(accounts, ticker)
      .then(setHoldings)
      .catch(e => console.warn('[ChartScreen] holdings:', e.message));
  }, [accounts, ticker]);

  const activeRange = useMemo(() => RANGES[rangeIndex], [rangeIndex]);

  const handleRangeSelect = useCallback((index: number) => {
    setRangeIndex(index);
    setFreq(RANGES[index].defaultFreq);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const requestBars = getRequestBars(activeRange, freq);
    const t0 = Date.now();
    fetchHistory(ticker, freq, requestBars)
      .then(rawData => {
        const tFetch = Date.now();
        // Slice to the visual window so we only show the intended time range
        const data = sliceToWindow(rawData, activeRange.windowMs);
        const tSlice = Date.now();
        if (data.data.length === 0) {
          setError('No data available for this range');
          return;
        }
        const html = buildChartHtml(data, activeRange.label);
        const tBuild = Date.now();
        console.warn(
          `[ChartScreen] fetch=${tFetch - t0}ms (${
            rawData.data.length
          } rows) ` +
            `slice=${tSlice - tFetch}ms (${data.data.length} rows) ` +
            `buildHtml=${tBuild - tSlice}ms total=${tBuild - t0}ms`,
        );
        setHtml(html);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [ticker, freq, activeRange]);

  useEffect(() => {
    const key = `${ticker}/${freqToTimeframe(freq)}/OHLCV`;
    const off = stream.subscribe([key], msg => {
      if (msg.data.msg_type !== 'bar') {
        return;
      }
      const bar = barFromBarPayload(msg.data.payload);
      webRef.current?.injectJavaScript(
        `window.__pushBar && window.__pushBar(${JSON.stringify(bar)}); true;`,
      );
    });
    return off;
  }, [ticker, freq]);

  return (
    <View style={styles.container}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 6 }]}>
        <RangePills
          ranges={RANGES}
          activeIndex={rangeIndex}
          onSelect={handleRangeSelect}
        />
        <FreqDropdown
          options={activeRange.freqOptions}
          selected={freq}
          onSelect={setFreq}
        />
        {holdings.length > 0 && (
          <TouchableOpacity
            style={styles.exitButton}
            onPress={() => navigation.navigate('Exit', { symbol: ticker })}
          >
            <Text style={styles.exitButtonText}>Exit</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.tradeButton}
          onPress={() =>
            navigation.navigate('OrderEntry', {
              symbol: ticker,
              accountId: activeId ?? undefined,
            })
          }
        >
          <Text style={styles.tradeButtonText}>Trade</Text>
        </TouchableOpacity>
      </View>
      {holdings.length > 0 && (
        <View style={styles.posStrip}>
          {holdings.map(h => {
            const pl = Number(h.position.unrealized_pl);
            return (
              <View key={h.account.id} style={styles.posPill}>
                <Text style={styles.posPillText}>
                  {h.account.name} · {h.position.qty} @{' '}
                  {h.position.avg_entry_price}
                </Text>
                <Text
                  style={[
                    styles.posPillPl,
                    { color: pl >= 0 ? '#4caf50' : '#f44336' },
                  ]}
                >
                  {pl >= 0 ? '+' : ''}
                  {h.position.unrealized_pl}
                </Text>
              </View>
            );
          })}
        </View>
      )}
      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2196f3" />
        </View>
      ) : html ? (
        <WebView
          ref={webRef}
          key={html.length}
          source={{ html }}
          style={styles.webview}
          scrollEnabled={false}
          javaScriptEnabled
          originWhitelist={['*']}
        />
      ) : null}
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  pillRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#1a1a2e',
  },
  pillActive: {
    backgroundColor: '#2196f3',
  },
  tradeButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#2196f3',
  },
  tradeButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  exitButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#f44336',
  },
  exitButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  posStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#16213e',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  posPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    margin: 3,
    gap: 6,
  },
  posPillText: { color: '#ccc', fontSize: 12 },
  posPillPl: { fontSize: 12, fontWeight: '600' },
  pillText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
  },
  freqButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#1a1a2e',
  },
  freqButtonText: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '600',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownMenu: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 120,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  dropdownItemActive: {
    backgroundColor: '#2196f3',
  },
  dropdownItemText: {
    color: '#ccc',
    fontSize: 14,
  },
  dropdownItemTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  webview: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  center: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 16,
  },
});
