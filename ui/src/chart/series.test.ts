import { expect, test } from 'vitest';
import type { History } from '../bindings/History';
import { buildEasternOffsets, buildSeries, formatTick, hasReal } from './series';
import { getRequestBars, RANGES, sliceToWindow } from './ranges';

const COLS = ['open', 'high', 'low', 'close', 'volume', 'sma20', 'sma100', 'sma200', 'bbands_upper', 'bbands_lower', 'macd', 'macd_signal', 'macd_difference', 'rsi'];

function history(times: number[], ind: (i: number) => number | null = () => null): History {
  return {
    columns: COLS,
    index: times,
    data: times.map((_, i) => [10 + i, 11 + i, 9 + i, i % 2 ? 9 + i : 11 + i, 100, ind(i), ind(i), null, ind(i), ind(i), ind(i), ind(i), ind(i) == null ? null : (i % 2 ? -1 : 1), ind(i)]),
  };
}

test('every pane gets the same slot times, with whitespace for warmup', () => {
  const times = [0, 1, 2, 3].map(d => Date.UTC(2026, 6, 13 + d, 14, 0));
  const s = buildSeries(history(times, i => (i < 2 ? null : 50)));
  const t = (arr: { time: number }[]) => arr.map(p => p.time);
  expect(t(s.sma20)).toEqual(t(s.candles));
  expect(t(s.rsi)).toEqual(t(s.candles));
  expect(t(s.macdHist)).toEqual(t(s.candles));
  expect(s.sma20[0]).toEqual({ time: s.candles[0].time });
  expect(s.sma20[3].value).toBe(50);
  expect(hasReal(s.sma200)).toBe(false);
  expect(hasReal(s.sma20)).toBe(true);
});

test('times shift to Eastern, and volume and histogram colors follow direction', () => {
  const ms = Date.UTC(2026, 6, 15, 14, 0);
  const s = buildSeries(history([ms, ms + 60_000], () => 1));
  expect(s.candles[0].time).toBe(ms / 1000 - 4 * 3600);
  expect(s.volumes[0].color).toBe('rgba(76,175,80,0.3)');
  expect(s.volumes[1].color).toBe('rgba(244,67,54,0.3)');
  expect(s.macdHist[1].color).toBe('rgba(244,67,54,0.7)');
});

test('the 5D grid pads a short session to full width', () => {
  const day1 = [0, 1].map(k => Date.UTC(2026, 6, 14, 13, 30) + k * 3_600_000);
  const day2 = [0, 1, 2].map(k => Date.UTC(2026, 6, 15, 13, 30) + k * 3_600_000);
  const s = buildSeries(history([...day1, ...day2]), 3600);
  expect(s.candles.length).toBe(6);
  expect(s.candles[2]).toEqual({ time: s.candles[2].time });
  expect(s.sessionOpens.length).toBe(2);
});

test('DST: offsets switch exactly at the change', () => {
  const before = Date.UTC(2026, 2, 7, 15, 0);
  const after = Date.UTC(2026, 2, 9, 15, 0);
  expect(buildEasternOffsets([before, after])).toEqual([-5 * 3600, -4 * 3600]);
});

test('tick labels per range', () => {
  const t = (h: number, m: number) => Date.UTC(2026, 8, 25, h, m) / 1000;
  expect(formatTick(t(9, 30), '1D')).toBe('9:30');
  expect(formatTick(t(13, 0), '1D')).toBe('1');
  expect(formatTick(t(13, 5), '1D')).toBe('');
  expect(formatTick(t(9, 30), '5D')).toBe('');
  expect(formatTick(t(12, 0), '1Y')).toBe('Sep 25');
  expect(formatTick(t(12, 0), '5Y')).toBe('Sep 2026');
});

test('ranges: defaults, request sizing, and slicing to the window or 5 sessions', () => {
  expect(RANGES.map(r => [r.label, r.defaultFreq])).toEqual([
    ['1D', '1min'], ['5D', '5min'], ['1M', 'h'], ['6M', 'D'], ['1Y', 'D'], ['5Y', 'W'],
  ]);
  expect(getRequestBars(RANGES[4], 'D')).toBe(Math.ceil(((365 * 24 * 60) / (16 * 60)) * 1.5));
  const days = Array.from({ length: 10 }, (_, d) => Date.UTC(2026, 8, 14 + d, 14, 0));
  const h = history(days);
  expect(sliceToWindow(h, 3 * 86_400_000).index).toEqual(days.slice(-4));
  expect(sliceToWindow(h, 0, 5).index).toEqual(days.slice(-5));
});
