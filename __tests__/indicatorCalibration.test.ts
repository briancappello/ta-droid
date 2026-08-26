import { computeIndicators } from '../src/indicators';
import fixture from './fixtures/faTechanHistory.json';

type Columnar = {
  columns: string[];
  index: number[];
  data: (number | null)[][];
};

const fx = fixture as Columnar;
const col = (name: string) => {
  const idx = fx.columns.indexOf(name);
  if (idx < 0) {
    throw new Error(`fixture missing column ${name}`);
  }
  return fx.data.map(row => row[idx]);
};

const closes = col('close').map(Number);
const ours = computeIndicators(closes);

// Compare only the last 100 bars, where every indicator is well past warmup and
// MACD EMA-seeding transients have decayed.
const TAIL = 100;
const from = closes.length - TAIL;

function assertColumnClose(name: keyof (typeof ours)[number], tol: number) {
  const theirs = col(name as string);
  let maxRel = 0;
  for (let i = from; i < closes.length; i++) {
    const a = ours[i][name];
    const b = theirs[i];
    if (a == null || b == null || Number.isNaN(b as number)) {
      continue;
    }
    const denom = Math.max(Math.abs(b as number), 1e-6);
    maxRel = Math.max(maxRel, Math.abs((a as number) - (b as number)) / denom);
  }
  // Surface the residual for documentation even on success.
  // eslint-disable-next-line no-console
  console.log(`calibration ${String(name)} maxRel=${maxRel.toFixed(5)}`);
  expect(maxRel).toBeLessThan(tol);
}

test('SMAs match fa-techan within 0.1%', () => {
  assertColumnClose('sma20', 0.001);
  assertColumnClose('sma100', 0.001);
  assertColumnClose('sma200', 0.001);
});

test('Bollinger bands match within 0.5%', () => {
  assertColumnClose('bbands_upper', 0.005);
  assertColumnClose('bbands_lower', 0.005);
});

test('RSI matches within 1%', () => {
  assertColumnClose('rsi', 0.01);
});

test('MACD family matches within 2% on the tail', () => {
  assertColumnClose('macd', 0.02);
  assertColumnClose('macd_signal', 0.02);
  assertColumnClose('macd_difference', 0.02);
});
