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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DrawerActions } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import { fetchHistory, type HistoryResponse } from '../api';
import { LIGHTWEIGHT_CHARTS_JS } from '../vendor/lightweightCharts';
import { useAccounts } from '../AccountContext';
import { holdingsForSymbol, type SymbolHolding } from '../flatten';
import { freqToTimeframe } from '../marketstore';
import { stream } from '../marketstoreStream';
import {
  barFromBarPayload,
  easternOffset,
  padSessionGrid,
  sessionOpenTimes,
  sessionStartIndex,
} from '../chartTime';
import { formatMoney } from '../format';

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
  // When set, slice to exactly this many trading sessions instead of by
  // windowMs. A calendar window leaves a partial extra session hanging off the
  // left edge (7 days back lands mid-session), which the 5D axis would then
  // label as a sixth day.
  sessions?: number;
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
  sessions?: number,
): HistoryResponse {
  if (data.index.length === 0) {
    return data;
  }

  let startIdx = 0;
  if (sessions) {
    // Session-based slicing needs Eastern-shifted times to bucket by trading
    // day (see TIMEZONE STRATEGY).
    const eastern = data.index.map(ms => Math.floor(ms / 1000) + easternOffset(ms));
    startIdx = sessionStartIndex(eastern, sessions);
  } else {
    const latestTs = data.index[data.index.length - 1];
    const windowStart = latestTs - windowMs;
    for (let i = 0; i < data.index.length; i++) {
      if (data.index[i] >= windowStart) {
        startIdx = i;
        break;
      }
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
    // Labelled 5D because the 7-calendar-day window is 5 trading days.
    label: '5D',
    defaultFreq: '5min',
    sessions: 5,
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

function buildChartHtml(
  data: HistoryResponse,
  rangeLabel: string,
  // Bar interval in seconds. When > 0, sessions are padded to a uniform grid of
  // this interval so each trading day is equally wide (see padSessionGrid).
  gridIntervalSec = 0,
): string {
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

  // Every series is drawn over this one slot list, so the panes stay aligned.
  // When gridIntervalSec is set (the 5D range) each session is padded to the
  // same slot count, giving every trading day equal width; otherwise slots map
  // 1:1 onto the bars.
  const slots = padSessionGrid(chartTimes, gridIntervalSec);

  // One anchor per trading session, at its 09:30 open. The 5D axis draws its
  // weekday labels here as an overlay (see renderDayLabels below). Taken from
  // the padded slots so a session missing its 09:30 print still gets one.
  const sessionOpens = sessionOpenTimes(slots.map(s => s.time));

  const candles = slots.map(({ time, src }) => {
    if (src < 0) {
      return { time };
    }
    const row = data.data[src];
    return {
      time,
      open: row[colIdx.open],
      high: row[colIdx.high],
      low: row[colIdx.low],
      close: row[colIdx.close],
    };
  });

  const volumes = slots.map(({ time, src }) => {
    if (src < 0) {
      return { time };
    }
    const row = data.data[src];
    const close = row[colIdx.close];
    const open = row[colIdx.open];
    return {
      time,
      value: row[colIdx.volume],
      color: close >= open ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)',
    };
  });

  // Emit whitespace points ({ time } with no value) for null/NaN warmup bars
  // instead of dropping them, so every pane (main, MACD, RSI) has the SAME
  // points at the SAME times. The panes sync by bar-index (logical range); if
  // an indicator had fewer points than the candles, index N in the main chart
  // would fall past the end of the indicator's data, cramming it into the left
  // and leaving the right empty. Whitespace keeps counts/times aligned and
  // renders as a blank gap during warmup.
  const buildLineSeries = (colName: string): { time: number; value?: number }[] => {
    if (!(colName in colIdx)) {
      return [];
    }
    const result: { time: number; value?: number }[] = [];
    for (const { time, src } of slots) {
      const val = src < 0 ? null : data.data[src][colIdx[colName]];
      if (val === null || val === undefined || Number.isNaN(val)) {
        result.push({ time });
      } else {
        result.push({ time, value: val });
      }
    }
    return result;
  };

  // A series is worth drawing only if it has at least one real (non-whitespace)
  // value; a whitespace-only array would add an invisible, range-padding series.
  const hasReal = (arr: { value?: number }[]) =>
    arr.some(p => p.value !== undefined);

  const sma20 = buildLineSeries('sma20');
  const sma100 = buildLineSeries('sma100');
  const sma200 = buildLineSeries('sma200');
  const bbandsUpper = buildLineSeries('bbands_upper');
  const bbandsLower = buildLineSeries('bbands_lower');
  const macd = buildLineSeries('macd');
  const macdSignal = buildLineSeries('macd_signal');
  const rsi = buildLineSeries('rsi');

  // Full-length (whitespace-padded) so the MACD pane shares the candles' time
  // points — see buildLineSeries. Null bars become whitespace, not dropped.
  const macdHist = slots.map(({ time, src }) => {
    const val = src < 0 ? null : data.data[src][colIdx.macd_difference];
    if (val === null || val === undefined || Number.isNaN(val)) {
      return { time };
    }
    return {
      time,
      value: val,
      color: val >= 0 ? 'rgba(76,175,80,0.7)' : 'rgba(244,67,54,0.7)',
    };
  });

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
    #main-chart { width: 100%; height: 100%; }
    #macd-chart { width: 100vw; height: 22vh; border-top: 1px solid #333; }
    #rsi-chart  { width: 100%; height: 100%; }
    .pane { position: relative; width: 100vw; }
    .pane-main { height: 55vh; }
    .pane-rsi { height: 23vh; border-top: 1px solid #333; }
    /* Overlay strip sitting on the chart's time axis, where the built-in tick
       labels would be. Pointer-events off so it never eats chart gestures.
       z-index MUST beat the chart canvases: lightweight-charts renders them at
       z-index 1, so an auto/0 overlay is painted underneath and is invisible. */
    .daylabels { position: absolute; left: 0; right: 0; bottom: 2px;
                 height: 12px; pointer-events: none; z-index: 2; }
    .daylabels span { position: absolute; transform: translateX(-50%);
                      color: #ccc; font-size: 10px; line-height: 12px;
                      white-space: nowrap; }
  </style>
</head>
<body>
  <div class="pane pane-main">
    <div id="main-chart"></div>
    <div class="daylabels" id="main-days"></div>
  </div>
  <div id="macd-chart"></div>
  <div class="pane pane-rsi">
    <div id="rsi-chart"></div>
    <div class="daylabels" id="rsi-days"></div>
  </div>
  <script>
    var rangeLabel = ${JSON.stringify(rangeLabel)};
    // One chart time per session, at its 09:30 open. Drives the 5D day labels.
    var SESSION_OPENS = ${JSON.stringify(sessionOpens)};

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
      if (rangeLabel === '5D') {
        // Built-in ticks are blank on 5D: the library only places a tick where
        // the UTC date rolls over (the day's FIRST bar, i.e. premarket) and
        // silently drops ticks it has no room for, so it can neither hit 09:30
        // nor guarantee one label per session. renderDayLabels() draws them
        // instead, positioned with timeToCoordinate().
        return '';
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
        // The default (0.5) is too wide to fit a full 5-session intraday
        // series on a phone: fitContent() would silently clamp and show only
        // the most recent ~70% of the range. Allow tighter packing so every
        // requested session is actually visible.
        minBarSpacing: 0.02,
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
      hasReal(sma20)
        ? `
    main.addLineSeries({ color: '#ff9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      sma20,
    )});
    `
        : ''
    }
    ${
      hasReal(sma100)
        ? `
    main.addLineSeries({ color: '#2196f3', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      sma100,
    )});
    `
        : ''
    }
    ${
      hasReal(sma200)
        ? `
    main.addLineSeries({ color: '#e91e63', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      sma200,
    )});
    `
        : ''
    }
    ${
      hasReal(bbandsUpper)
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
      // MERGE the timeScale rather than replacing it. A shallow
      // Object.assign that supplies a fresh timeScale object silently drops
      // every other timeScale option -- notably minBarSpacing, which left this
      // pane clamped at the 0.5 default. Because the panes sync by pushing
      // logical ranges at each other, that clamp propagated back to the main
      // chart and stopped the full range from ever fitting.
      Object.assign({}, chartOpts, {
        timeScale: Object.assign({}, chartOpts.timeScale, { visible: false }),
      })
    );

    ${
      hasReal(macd)
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
      hasReal(rsi)
        ? `
    rsiChart.addLineSeries({ color: '#ab47bc', lineWidth: 1, lastValueVisible: false, priceLineVisible: false }).setData(${JSON.stringify(
      rsi,
    )});
    `
        : ''
    }
    rsiChart.timeScale().fitContent();

    // --- 5D day labels ---
    //
    // Drawn as an overlay rather than via tickMarkFormatter because the
    // library places ticks only where the UTC date rolls over (the day's first
    // bar, which is premarket) and drops ticks it cannot fit — so it can
    // neither anchor on 09:30 nor guarantee one label per session.
    // timeToCoordinate() gives the exact x for each session's opening bar.
    var DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var dayLabelHosts = [
      document.getElementById('main-days'),
      document.getElementById('rsi-days')
    ];

    function renderDayLabels() {
      if (rangeLabel !== '5D') { return; }
      var scale = main.timeScale();
      var marks = [];
      for (var i = 0; i < SESSION_OPENS.length; i++) {
        var t = SESSION_OPENS[i];
        var x = scale.timeToCoordinate(t);
        // null when the session is scrolled out of view
        if (x === null || x === undefined) { continue; }
        marks.push({ x: x, name: DAY_NAMES[new Date(t * 1000).getUTCDay()] });
      }
      // Labels are centred on their bar (translateX(-50%)), so one sitting on
      // the first bar would hang half off the left edge. Keep them on screen.
      var pad = 14;
      var maxX = (dayLabelHosts[0] ? dayLabelHosts[0].clientWidth : 0) - pad;
      for (var j = 0; j < marks.length; j++) {
        if (marks[j].x < pad) { marks[j].x = pad; }
        if (maxX > pad && marks[j].x > maxX) { marks[j].x = maxX; }
      }
      for (var h = 0; h < dayLabelHosts.length; h++) {
        var host = dayLabelHosts[h];
        if (!host) { continue; }
        host.innerHTML = '';
        for (var k = 0; k < marks.length; k++) {
          var span = document.createElement('span');
          span.textContent = marks[k].name;
          span.style.left = marks[k].x + 'px';
          host.appendChild(span);
        }
      }
    }

    // Sync time scales
    main.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
      if (range) {
        macdChart.timeScale().setVisibleLogicalRange(range);
        rsiChart.timeScale().setVisibleLogicalRange(range);
      }
      renderDayLabels();
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

    // Defer the first paint until layout has settled, otherwise
    // timeToCoordinate() reports positions for a not-yet-sized canvas.
    requestAnimationFrame(renderDayLabels);
    window.addEventListener('resize', renderDayLabels);
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
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  // The header symbol IS the input: it shows the live ticker, and typing over
  // it switches the chart. Re-sync whenever ticker changes from elsewhere
  // (drawer, watchlist tap, submitSymbol's own setParams).
  const [symInput, setSymInput] = useState(ticker);
  useEffect(() => setSymInput(ticker), [ticker]);

  // Switch the chart to a typed symbol. ticker drives the data-load, holdings,
  // and stream effects, so setParams reloads everything in place.
  const submitSymbol = useCallback(() => {
    const next = symInput.trim().toUpperCase();
    if (next && next !== ticker) {
      navigation.setParams({ ticker: next });
    } else {
      setSymInput(ticker); // empty or unchanged — snap back to the real ticker
    }
  }, [symInput, ticker, navigation]);

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
        const data = sliceToWindow(
          rawData,
          activeRange.windowMs,
          activeRange.sessions,
        );
        const tSlice = Date.now();
        if (data.data.length === 0) {
          setError('No data available for this range');
          return;
        }
        // Seed the header price from the last loaded close; the stream effect
        // keeps it in sync with the chart's right-axis last-value label.
        const closeIdx = data.columns.indexOf('close');
        const lastRow = data.data[data.data.length - 1];
        setLastPrice(closeIdx >= 0 && lastRow ? lastRow[closeIdx] : null);
        // Pad sessions to equal width only on session-sliced ranges (5D);
        // elsewhere bars map 1:1 onto slots.
        const gridIntervalSec = activeRange.sessions
          ? (FREQ_MINUTES[freq] ?? 0) * 60
          : 0;
        const html = buildChartHtml(data, activeRange.label, gridIntervalSec);
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
      setLastPrice(bar.close);
      webRef.current?.injectJavaScript(
        `window.__pushBar && window.__pushBar(${JSON.stringify(bar)}); true;`,
      );
    });
    return off;
  }, [ticker, freq]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
            style={styles.headerNavBtn}
            accessibilityLabel="Open navigation menu"
          >
            <Text style={styles.headerNavIcon}>☰</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.headerSymbol}
            value={symInput}
            onChangeText={setSymInput}
            onSubmitEditing={submitSymbol}
            onBlur={() => setSymInput(ticker)}
            selectTextOnFocus
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Switch symbol"
          />
          {lastPrice != null && (
            <Text style={styles.headerPrice}>{formatMoney(lastPrice)}</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.tradeButton}
            accessibilityLabel="Trade"
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
      </View>
      <View style={styles.toolbar}>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 6,
    backgroundColor: '#16213e',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  headerNavBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  headerNavIcon: { color: '#fff', fontSize: 20 },
  // Doubles as the symbol TextInput. Explicit padding overrides Android's
  // larger default input inset; the border makes it read as editable at rest.
  // minWidth keeps a tappable target for 1-2 letter tickers.
  headerSymbol: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#888', // matches styles.pillText — visible but not shouty
    borderRadius: 4,
    minWidth: 68,
  },
  headerPrice: { color: '#fff', fontSize: 16, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
