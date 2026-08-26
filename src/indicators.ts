// ponytail: calibrated vs fa-techan/TA-Lib on AAPL 400d (last-100 tail) —
// maxRel ~0 for every column (sma/bbands/rsi/macd all < 1e-5, floating-point
// noise). trading-signals uses population sigma (matches TA-Lib BBands) and the
// MACD EMA first-value seeding transient fully decays past warmup. See
// __tests__/indicatorCalibration.test.ts. Upgrade path: hand-roll an indicator
// with TA-Lib seeding only if a future tighter match is ever required.
import { SMA, EMA, MACD, RSI, BollingerBands } from 'trading-signals';

export const INDICATOR_COLUMNS = [
  'sma20',
  'sma100',
  'sma200',
  'bbands_upper',
  'bbands_lower',
  'macd',
  'macd_signal',
  'macd_difference',
  'rsi',
] as const;

export type IndicatorRow = Record<
  (typeof INDICATOR_COLUMNS)[number],
  number | null
>;

// Params match fa-techan/TA-Lib: SMA(100/200), BBands(20, 2sigma) whose middle
// band is sma20, MACD(12,26,9), RSI(14, Wilder). `.add()` returns null during
// each indicator's warmup.
export function computeIndicators(closes: number[]): IndicatorRow[] {
  const sma100 = new SMA(100);
  const sma200 = new SMA(200);
  const bb = new BollingerBands(20, 2);
  const macd = new MACD(new EMA(12), new EMA(26), new EMA(9));
  const rsi = new RSI(14);

  return closes.map(close => {
    const s100 = sma100.add(close);
    const s200 = sma200.add(close);
    const band = bb.add(close);
    const m = macd.add(close);
    const r = rsi.add(close);

    return {
      sma20: band ? band.middle : null,
      sma100: s100 ?? null,
      sma200: s200 ?? null,
      bbands_upper: band ? band.upper : null,
      bbands_lower: band ? band.lower : null,
      macd: m ? m.macd : null,
      macd_signal: m ? m.signal : null,
      macd_difference: m ? m.histogram : null,
      rsi: r ?? null,
    };
  });
}
