// Turn a columnar History into chart series (charting spec: layout). Moved
// from the React Native buildChartHtml, minus the inline HTML.
import type { History } from '../bindings/History';
import { easternOffset, padSessionGrid, sessionOpenTimes } from './chartTime';

export type Point = { time: number; value?: number; color?: string };
export type Candle = { time: number; open?: number; high?: number; low?: number; close?: number };

export type ChartSeries = {
  candles: Candle[];
  volumes: Point[];
  sma20: Point[];
  sma100: Point[];
  sma200: Point[];
  bbandsUpper: Point[];
  bbandsLower: Point[];
  macd: Point[];
  macdSignal: Point[];
  macdHist: Point[];
  rsi: Point[];
  /** One chart time per session at its 09:30 open (5D day labels). */
  sessionOpens: number[];
};

/**
 * Eastern offset (seconds) per timestamp. Calls Intl twice in the common
 * case; with a DST change in range it binary-searches the switch point.
 */
export function buildEasternOffsets(timestamps: number[]): number[] {
  if (timestamps.length === 0) return [];
  const first = easternOffset(timestamps[0]);
  const last = easternOffset(timestamps[timestamps.length - 1]);
  if (first === last) return new Array(timestamps.length).fill(first);
  let lo = 0;
  let hi = timestamps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (easternOffset(timestamps[mid]) === first) lo = mid + 1;
    else hi = mid;
  }
  const out = new Array(timestamps.length);
  out.fill(first, 0, lo);
  out.fill(last, lo);
  return out;
}

/** A series is worth drawing only if it has at least one real value. */
export const hasReal = (arr: Point[]) => arr.some(p => p.value !== undefined);

/**
 * Build every series over one shared slot list so the panes stay aligned.
 * With `gridIntervalSec` > 0 (the 5D range) each session is padded to the same
 * slot count. Warmup and padding become whitespace points ({time} only).
 */
export function buildSeries(data: History, gridIntervalSec = 0): ChartSeries {
  const col: Record<string, number> = {};
  data.columns.forEach((c, i) => (col[c] = i));
  const offsets = buildEasternOffsets(data.index);
  const chartTimes = data.index.map((ms, i) => Math.floor(ms / 1000) + offsets[i]);
  const slots = padSessionGrid(chartTimes, gridIntervalSec);
  const cell = (src: number, name: string): number | null => {
    if (src < 0 || !(name in col)) return null;
    const v = data.data[src][col[name]];
    return v == null || Number.isNaN(v) ? null : v;
  };
  const line = (name: string): Point[] => {
    if (!(name in col)) return [];
    return slots.map(({ time, src }) => {
      const v = cell(src, name);
      return v == null ? { time } : { time, value: v };
    });
  };

  return {
    candles: slots.map(({ time, src }) =>
      src < 0
        ? { time }
        : { time, open: cell(src, 'open')!, high: cell(src, 'high')!, low: cell(src, 'low')!, close: cell(src, 'close')! },
    ),
    volumes: slots.map(({ time, src }) => {
      if (src < 0) return { time };
      const up = cell(src, 'close')! >= cell(src, 'open')!;
      return { time, value: cell(src, 'volume')!, color: up ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)' };
    }),
    sma20: line('sma20'),
    sma100: line('sma100'),
    sma200: line('sma200'),
    bbandsUpper: line('bbands_upper'),
    bbandsLower: line('bbands_lower'),
    macd: line('macd'),
    macdSignal: line('macd_signal'),
    macdHist: slots.map(({ time, src }) => {
      const v = cell(src, 'macd_difference');
      return v == null ? { time } : { time, value: v, color: v >= 0 ? 'rgba(76,175,80,0.7)' : 'rgba(244,67,54,0.7)' };
    }),
    rsi: line('rsi'),
    sessionOpens: sessionOpenTimes(slots.map(s => s.time)),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Axis tick text for a range. Times are "fake UTC" Eastern, so getUTC* reads
 * Eastern wall-clock values. 5D ticks are blank: day labels are an overlay.
 */
export function formatTick(time: number, range: string): string {
  const d = new Date(time * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (range === '1D') {
    if (h === 9 && m === 30) return '9:30';
    if (m !== 0) return '';
    return String(h % 12 || 12);
  }
  if (range === '5D') return '';
  if (range === '5Y') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
