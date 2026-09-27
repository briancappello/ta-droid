// The three synced chart panes (charting spec: layout), drawn with
// lightweight-charts straight into the page. Replaces the React Native
// WebView and its postMessage bridge.
import { createChart, type IChartApi, type ISeriesApi, type LogicalRange, type Time, type UTCTimestamp } from 'lightweight-charts';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import styles from './ChartPanes.module.css';
import { DAY_NAMES, formatTick, hasReal, type ChartSeries, type Point } from './series';

export type LivePoint = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ChartPanesHandle = { pushBar: (b: LivePoint) => void };

const asData = <T extends { time: number }>(arr: T[]) => arr.map(p => ({ ...p, time: p.time as UTCTimestamp }));
const line = (color: string, extra: object = {}) => ({ color, lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false, ...extra });

export const ChartPanes = forwardRef<ChartPanesHandle, { series: ChartSeries; range: string }>(function ChartPanes({ series, range }, ref) {
  const mainEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const daysMain = useRef<HTMLDivElement>(null);
  const daysRsi = useRef<HTMLDivElement>(null);
  const live = useRef<{ candles: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'> } | null>(null);

  useImperativeHandle(ref, () => ({
    pushBar(b) {
      const s = live.current;
      if (!s) return;
      const time = b.time as UTCTimestamp;
      s.candles.update({ time, open: b.open, high: b.high, low: b.low, close: b.close });
      s.volume.update({ time, value: b.volume, color: b.close >= b.open ? '#4caf50' : '#f44336' });
    },
  }));

  useEffect(() => {
    const opts = {
      autoSize: true,
      layout: { background: { color: '#1a1a2e' }, textColor: '#ccc', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: '#1e2940' }, horzLines: { color: '#1e2940' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#333' },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
        tickMarkFormatter: (t: Time) => formatTick(t as number, range),
        tickMarkMaxCharacterLength: 5,
        // Fit every requested 5D session on a phone (the 0.5 default clamps).
        minBarSpacing: 0.02,
      },
    };
    const main = createChart(mainEl.current!, opts);
    const macd = createChart(macdEl.current!, { ...opts, timeScale: { ...opts.timeScale, visible: false } });
    const rsi = createChart(rsiEl.current!, opts);
    const charts: IChartApi[] = [main, macd, rsi];

    const candles = main.addCandlestickSeries({
      upColor: '#4caf50', downColor: '#f44336', borderUpColor: '#4caf50', borderDownColor: '#f44336',
      wickUpColor: '#4caf50', wickDownColor: '#f44336', priceLineVisible: false,
    });
    candles.setData(asData(series.candles) as never);
    const volume = main.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false });
    main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(asData(series.volumes) as never);
    live.current = { candles, volume };

    const add = (chart: IChartApi, data: Point[], color: string, extra?: object) => {
      if (hasReal(data)) chart.addLineSeries(line(color, extra)).setData(asData(data) as never);
    };
    add(main, series.sma20, '#ff9800');
    add(main, series.sma100, '#2196f3');
    add(main, series.sma200, '#e91e63');
    if (hasReal(series.bbandsUpper)) {
      add(main, series.bbandsUpper, 'rgba(33,150,243,0.4)', { lineStyle: 2 });
      add(main, series.bbandsLower, 'rgba(33,150,243,0.4)', { lineStyle: 2 });
    }
    if (hasReal(series.macd)) {
      add(macd, series.macd, '#2196f3');
      add(macd, series.macdSignal, '#ff9800');
      macd.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false }).setData(asData(series.macdHist) as never);
    }
    add(rsi, series.rsi, '#ab47bc');
    charts.forEach(c => c.timeScale().fitContent());

    const renderDays = () => {
      const hosts = [daysMain.current, daysRsi.current];
      if (range !== '5D') {
        hosts.forEach(h => h && (h.innerHTML = ''));
        return;
      }
      const scale = main.timeScale();
      const pad = 14;
      const maxX = (hosts[0]?.clientWidth ?? 0) - pad;
      const marks: { x: number; name: string }[] = [];
      for (const t of series.sessionOpens) {
        const c = scale.timeToCoordinate(t as UTCTimestamp);
        // null when the session is scrolled out of view
        if (c == null) continue;
        const x = Math.max(Number(c), pad);
        marks.push({ x: maxX > pad ? Math.min(x, maxX) : x, name: DAY_NAMES[new Date(t * 1000).getUTCDay()] });
      }
      for (const host of hosts) {
        if (!host) continue;
        host.replaceChildren(
          ...marks.map(m => {
            const span = document.createElement('span');
            span.textContent = m.name;
            span.style.left = `${m.x}px`;
            return span;
          }),
        );
      }
    };

    // Keep all three panes on the same logical range.
    let syncing = false;
    const sync = (from: IChartApi) => (r: LogicalRange | null) => {
      if (r && !syncing) {
        syncing = true;
        charts.filter(c => c !== from).forEach(c => c.timeScale().setVisibleLogicalRange(r));
        syncing = false;
      }
      if (from === main) renderDays();
    };
    charts.forEach(c => c.timeScale().subscribeVisibleLogicalRangeChange(sync(c)));
    const raf = requestAnimationFrame(renderDays);
    window.addEventListener('resize', renderDays);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', renderDays);
      live.current = null;
      charts.forEach(c => c.remove());
    };
  }, [series, range]);

  return (
    <div className={styles.panes} data-testid="chart-panes" data-range={range} data-bars={series.candles.length}>
      <div className={`${styles.pane} ${styles.main}`}>
        <div ref={mainEl} className={styles.chart} data-testid="pane-main" />
        <div ref={daysMain} className={styles.days} data-testid="day-labels" />
      </div>
      <div className={`${styles.pane} ${styles.macd}`}>
        <div ref={macdEl} className={styles.chart} data-testid="pane-macd" />
      </div>
      <div className={`${styles.pane} ${styles.rsi}`}>
        <div ref={rsiEl} className={styles.chart} data-testid="pane-rsi" />
        <div ref={daysRsi} className={styles.days} />
      </div>
    </div>
  );
});
