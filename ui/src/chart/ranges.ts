// Chart ranges, frequencies, and window slicing (charting spec). Moved from
// the React Native ChartScreen unchanged.
import type { History } from '../bindings/History';
import { easternOffset, sessionStartIndex } from './chartTime';

export type FreqOption = { label: string; value: string };

export type RangeConfig = {
  label: string;
  defaultFreq: string;
  freqOptions: FreqOption[];
  /** Duration of the visual window in milliseconds. */
  windowMs: number;
  /** How many bars to over-request (buffer factor). */
  requestMultiplier: number;
  /**
   * Slice to exactly this many trading sessions instead of by windowMs. A
   * calendar window leaves a partial extra session hanging off the left edge,
   * which the 5D axis would label as a sixth day.
   */
  sessions?: number;
};

const HOURS_MS = 60 * 60 * 1000;
const DAYS_MS = 24 * HOURS_MS;
/** Extended hours: 4am-8pm ET = 16 hours. */
const EXTENDED_DAY_HOURS = 16;

/** Minutes per bar, for request sizing and the 5D session grid. */
export const FREQ_MINUTES: Record<string, number> = {
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

/** App frequency -> MarketStore timeframe, for the live stream key. */
export const TIMEFRAME: Record<string, string> = {
  '1min': '1Min',
  '2min': '2Min',
  '5min': '5Min',
  '10min': '10Min',
  '15min': '15Min',
  '30min': '30Min',
  h: '1H',
  D: '1D',
  W: '1W',
  M: '1M',
};

export const RANGES: RangeConfig[] = [
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

/** The chart opens at 1Y with daily bars. */
export const DEFAULT_RANGE_INDEX = 4;

/** Bars to request so the window is covered (a daily bar counts as 16 h). */
export function getRequestBars(range: RangeConfig, freq: string): number {
  const windowMinutes = range.windowMs / (60 * 1000);
  const freqMinutes = FREQ_MINUTES[freq] ?? EXTENDED_DAY_HOURS * 60;
  return Math.ceil((windowMinutes / freqMinutes) * range.requestMultiplier);
}

/** Keep only the bars in the visual window, ending at the latest bar. */
export function sliceToWindow(data: History, windowMs: number, sessions?: number): History {
  if (data.index.length === 0) return data;
  let startIdx: number;
  if (sessions) {
    const eastern = data.index.map(ms => Math.floor(ms / 1000) + easternOffset(ms));
    startIdx = sessionStartIndex(eastern, sessions);
  } else {
    const windowStart = data.index[data.index.length - 1] - windowMs;
    startIdx = Math.max(0, data.index.findIndex(t => t >= windowStart));
  }
  return { columns: data.columns, index: data.index.slice(startIdx), data: data.data.slice(startIdx) };
}
