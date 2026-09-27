// Ported from __tests__/chartTime.test.ts.
import { expect, test } from 'vitest';
import {
  easternOffset,
  barFromBarPayload,
  padSessionGrid,
  sessionOpenTimes,
  sessionStartIndex,
} from './chartTime';

// Chart times are "fake UTC" seconds representing Eastern wall-clock time,
// so these helpers build them with Date.UTC directly.
const t = (y: number, mo: number, d: number, h: number, mi: number) =>
  Math.floor(Date.UTC(y, mo, d, h, mi, 0) / 1000);

test('sessionOpenTimes anchors each session at 9:30, skipping premarket bars', () => {
  const times = [
    t(2026, 7, 26, 4, 0), // Wed premarket - must NOT be the anchor
    t(2026, 7, 26, 9, 30), // Wed open
    t(2026, 7, 26, 15, 55),
    t(2026, 7, 27, 5, 35), // Thu premarket
    t(2026, 7, 27, 9, 30), // Thu open
    t(2026, 8, 1, 8, 20), // Tue premarket
    t(2026, 8, 1, 9, 35), // Tue - no 9:30 print, first bar after the open
  ];
  expect(sessionOpenTimes(times)).toEqual([
    t(2026, 7, 26, 9, 30),
    t(2026, 7, 27, 9, 30),
    t(2026, 8, 1, 9, 35),
  ]);
});

test('sessionOpenTimes skips a session that never reaches the open', () => {
  const times = [
    t(2026, 7, 26, 4, 0), // premarket only, no regular session
    t(2026, 7, 26, 8, 0),
    t(2026, 7, 27, 9, 30), // next day trades normally
  ];
  expect(sessionOpenTimes(times)).toEqual([t(2026, 7, 27, 9, 30)]);
  expect(sessionOpenTimes([])).toEqual([]);
});

const HOUR = 3600;

test('padSessionGrid gives every session the same number of slots', () => {
  // Wed trades 9:30 and 10:30 only; Thu trades 9:30, 10:30, 11:30.
  // Both sessions must end up 3 slots wide (9:30, 10:30, 11:30).
  const times = [
    t(2026, 7, 26, 9, 30),
    t(2026, 7, 26, 10, 30),
    t(2026, 7, 27, 9, 30),
    t(2026, 7, 27, 10, 30),
    t(2026, 7, 27, 11, 30),
  ];
  const slots = padSessionGrid(times, HOUR);
  expect(slots).toHaveLength(6);

  const perDay = new Map<string, number>();
  for (const s of slots) {
    const key = new Date(s.time * 1000).toISOString().slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  expect([...perDay.values()]).toEqual([3, 3]);

  // Wed's missing 11:30 is padding; every real bar keeps its source index.
  expect(slots.map(s => s.src)).toEqual([0, 1, -1, 2, 3, 4]);
  expect(slots[2].time).toBe(t(2026, 7, 26, 11, 30));
});

test('padSessionGrid never drops a bar that falls off the grid', () => {
  const times = [
    t(2026, 7, 26, 9, 30),
    t(2026, 7, 26, 9, 47), // off-grid print
    t(2026, 7, 26, 10, 30),
    t(2026, 7, 27, 9, 30),
  ];
  const slots = padSessionGrid(times, HOUR);
  const kept = slots.filter(s => s.src >= 0).map(s => s.time);
  expect(kept).toEqual(times);
  // still ascending
  expect([...slots].sort((a, b) => a.time - b.time)).toEqual(slots);
});

test('padSessionGrid is identity for empty input or a non-positive interval', () => {
  expect(padSessionGrid([], HOUR)).toEqual([]);
  const times = [t(2026, 7, 26, 9, 30), t(2026, 7, 26, 10, 30)];
  expect(padSessionGrid(times, 0)).toEqual([
    { time: times[0], src: 0 },
    { time: times[1], src: 1 },
  ]);
});

test('sessionStartIndex slices to the last N trading sessions', () => {
  const times = [
    t(2026, 7, 25, 9, 30), // Tue  (oldest, should be dropped when N=3)
    t(2026, 7, 26, 9, 30), // Wed
    t(2026, 7, 26, 10, 0),
    t(2026, 7, 27, 9, 30), // Thu
    t(2026, 7, 28, 9, 30), // Fri
  ];
  // last 3 sessions = Wed, Thu, Fri -> starts at index 1
  expect(sessionStartIndex(times, 3)).toBe(1);
  // asking for more sessions than exist keeps everything
  expect(sessionStartIndex(times, 99)).toBe(0);
  expect(sessionStartIndex([], 5)).toBe(0);
});

test('easternOffset is -4h in summer (EDT) and -5h in winter (EST)', () => {
  expect(easternOffset(Date.UTC(2026, 6, 15, 16, 0, 0))).toBe(-4 * 3600);
  expect(easternOffset(Date.UTC(2026, 0, 15, 16, 0, 0))).toBe(-5 * 3600);
});

test('barFromBarPayload maps OHLCV and shifts epoch by the eastern offset', () => {
  const epoch = Math.floor(Date.UTC(2026, 6, 15, 16, 0, 0) / 1000); // summer
  const bar = barFromBarPayload({
    epoch,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  });
  expect(bar).toEqual({
    time: epoch + -4 * 3600,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  });
});
