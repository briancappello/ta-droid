import { computeIndicators, INDICATOR_COLUMNS } from '../src/indicators';

test('exposes the exact column set the chart reads', () => {
  expect(INDICATOR_COLUMNS).toEqual([
    'sma20',
    'sma100',
    'sma200',
    'bbands_upper',
    'bbands_lower',
    'macd',
    'macd_signal',
    'macd_difference',
    'rsi',
  ]);
});

test('returns one row per input close', () => {
  const closes = Array.from({ length: 50 }, (_, i) => i + 1);
  expect(computeIndicators(closes)).toHaveLength(50);
});

test('warmup positions are null until the period fills', () => {
  const closes = Array.from({ length: 250 }, (_, i) => i + 1);
  const rows = computeIndicators(closes);
  // sma100 needs 100 samples: index 98 (99th) still warming, index 99 stable.
  expect(rows[98].sma100).toBeNull();
  expect(rows[99].sma100).not.toBeNull();
  // sma200 needs 200 samples.
  expect(rows[198].sma200).toBeNull();
  expect(rows[199].sma200).not.toBeNull();
});

test('sma20 equals the mean of the last 20 closes on a stable window', () => {
  const closes = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40
  const rows = computeIndicators(closes);
  // Last row: mean of 21..40 = 30.5
  expect(rows[39].sma20).toBeCloseTo(30.5, 6);
  // Bollinger middle band IS sma20; upper/lower straddle it symmetrically.
  const { sma20, bbands_upper, bbands_lower } = rows[39];
  expect((bbands_upper! + bbands_lower!) / 2).toBeCloseTo(sma20!, 6);
});

test('macd_difference is macd minus signal once stable', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i));
  const rows = computeIndicators(closes);
  const last = rows[59];
  expect(last.macd).not.toBeNull();
  expect(last.macd_difference).toBeCloseTo(last.macd! - last.macd_signal!, 6);
});
