# Marketstore Direct Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point the mobile app's quotes and chart-history fetching directly at MarketStore's REST API, computing the chart's technical indicators client-side, so market data no longer depends on the fa-techan backend.

**Architecture:** Adapter approach. Two new modules — `src/marketstore.ts` (REST client + auth-header seam) and `src/indicators.ts` (client-side TA via `trading-signals`). `src/api.ts` keeps its existing function signatures and return types (`ApiQuote[]`, columnar `HistoryResponse`) but rewires internals to MarketStore. `ChartScreen.tsx`, `WatchlistsScreen.tsx`, and `techan.ts` are untouched.

**Tech Stack:** React Native, TypeScript, `react-native-config`, `trading-signals@8.3.0`, Jest.

## Global Constraints

- **Consumers unchanged.** `src/screens/ChartScreen.tsx` and `src/screens/WatchlistsScreen.tsx` must not be edited. The adapter preserves their input types exactly.
- **`HistoryResponse.index` is epoch milliseconds.** `ChartScreen.tsx:233` divides by 1000 to reach seconds. Convert MarketStore RFC3339 `time` via `Date.parse`.
- **Column names must match fa-techan exactly:** `open,high,low,close,volume,sma20,sma100,sma200,bbands_upper,bbands_lower,macd,macd_signal,macd_difference,rsi`. Do not emit `sma500/sma1000/stoch_*` (chart never reads them).
- **Indicator params (TA-Lib, from `../fa-techan/app/api/v1/finance/history.py:48`):** SMA(100), SMA(200); BollingerBands(20, ±2σ) whose middle band IS `sma20`; MACD(12,26,9); RSI(14, Wilder).
- **Warmup = 200.** Over-fetch `limit + 200` bars so `sma200` is warm across the returned window, mirroring fa-techan computing TA on the full series then slicing.
- **`trading-signals@8.3.0` API:** `.add(price)` returns the result number/object or `null` during warmup. `new SMA(n)`, `new RSI(n)`, `new BollingerBands(interval, deviations)` → `{lower,middle,upper}`, `new MACD(new EMA(12), new EMA(26), new EMA(9))` → `{macd,signal,histogram}`.
- **Auth seam:** send `Authorization: <MARKETSTORE_AUTH_TOKEN>` verbatim when set (value may include a scheme like `Bearer x`); omit the header when unset. MarketStore is wide open today.

---

### Task 1: MarketStore REST client + config

**Files:**
- Create: `src/marketstore.ts`
- Create: `__tests__/marketstore.test.ts`
- Modify: `.env.example` (append MarketStore keys)
- Modify: `.env` (append MarketStore keys)
- Modify: `jest.setup.js:31-38` (add `MARKETSTORE_BASE_URL` to the `react-native-config` mock)

**Interfaces:**
- Consumes: `react-native-config` `Config.MARKETSTORE_BASE_URL`, `Config.MARKETSTORE_AUTH_TOKEN`.
- Produces:
  - `type MarketstoreBar = { time: string; open: number; high: number; low: number; close: number; volume: number }`
  - `type MarketstoreBars = { symbol: string; timeframe: string; bars: MarketstoreBar[] }`
  - `type MarketstoreQuote = { symbol: string; time: string; open: number; high: number; low: number; close: number; volume: number; prev_close: number | null }`
  - `freqToTimeframe(freq: string): string`
  - `getBars(symbol: string, timeframe: string, limit: number): Promise<MarketstoreBars>`
  - `getQuotes(symbols: string[], timeframe?: string): Promise<{ quotes: MarketstoreQuote[] }>`

- [ ] **Step 1: Add config keys**

Append to `.env.example`:

```bash

# MarketStore REST base URL consumed by react-native-config -> Config.MARKETSTORE_BASE_URL
# (src/marketstore.ts). Read-only market data (quotes + bars). Local dev: LAN IP + :5993.
MARKETSTORE_BASE_URL=https://marketstore.lab

# Optional auth header value sent verbatim as `Authorization` once MarketStore sits
# behind an authenticating reverse proxy. Unset -> no header (wide-open server).
# MARKETSTORE_AUTH_TOKEN=Bearer changeme
```

Append the same two `MARKETSTORE_BASE_URL=...` lines (real value) to `.env`.

- [ ] **Step 2: Add the config mock key**

In `jest.setup.js`, inside the `react-native-config` mock `default` object (currently holding `API_BASE_URL`), add:

```js
    MARKETSTORE_BASE_URL: 'https://ms.test',
```

- [ ] **Step 3: Write the failing tests**

Create `__tests__/marketstore.test.ts`:

```ts
import { getBars, getQuotes, freqToTimeframe } from '../src/marketstore';

afterEach(() => jest.restoreAllMocks());

test('freqToTimeframe maps app frequencies to MarketStore timeframes', () => {
  expect(freqToTimeframe('1min')).toBe('1Min');
  expect(freqToTimeframe('30min')).toBe('30Min');
  expect(freqToTimeframe('h')).toBe('1H');
  expect(freqToTimeframe('D')).toBe('1D');
  expect(freqToTimeframe('W')).toBe('1W');
});

test('freqToTimeframe throws on unknown frequency', () => {
  expect(() => freqToTimeframe('bogus')).toThrow(/Unknown frequency/);
});

test('getBars requests the bars endpoint with timeframe and limit', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ symbol: 'AAPL', timeframe: '1D', bars: [] }),
  } as unknown as Response);
  await getBars('AAPL', '1D', 50);
  const url = spy.mock.calls[0][0] as string;
  expect(url).toContain('https://ms.test/v1/bars/AAPL');
  expect(url).toContain('timeframe=1D');
  expect(url).toContain('limit=50');
});

test('getQuotes joins symbols and defaults timeframe to 1D', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ quotes: [] }),
  } as unknown as Response);
  await getQuotes(['AAPL', 'MSFT']);
  const url = spy.mock.calls[0][0] as string;
  expect(url).toContain('https://ms.test/v1/quotes');
  expect(url).toContain('symbols=AAPL%2CMSFT');
  expect(url).toContain('timeframe=1D');
});

test('non-2xx surfaces the server error message', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({ error: 'symbol not found' }),
  } as unknown as Response);
  await expect(getBars('NOPE', '1D', 10)).rejects.toThrow('symbol not found');
});

test('network failure surfaces a friendly message', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
  await expect(getQuotes(['AAPL'])).rejects.toThrow(/Can't reach market data/);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test -- marketstore`
Expected: FAIL — `Cannot find module '../src/marketstore'`.

- [ ] **Step 5: Write the implementation**

Create `src/marketstore.ts`:

```ts
import Config from 'react-native-config';

const BASE = Config.MARKETSTORE_BASE_URL!;
const AUTH = Config.MARKETSTORE_AUTH_TOKEN;

export type MarketstoreBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketstoreBars = {
  symbol: string;
  timeframe: string;
  bars: MarketstoreBar[];
};

export type MarketstoreQuote = {
  symbol: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prev_close: number | null;
};

// App frequency (fin.enums.Freq values) -> MarketStore timeframe
// (pymarketstore.Freq strings).
const FREQ_TIMEFRAME: Record<string, string> = {
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

export function freqToTimeframe(freq: string): string {
  const tf = FREQ_TIMEFRAME[freq];
  if (!tf) {
    throw new Error(`Unknown frequency: ${freq}`);
  }
  return tf;
}

async function msGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: AUTH ? { Authorization: AUTH } : undefined,
    });
  } catch {
    throw new Error("Can't reach market data — check your connection.");
  }
  if (!response.ok) {
    let message = `Market data error: ${response.status}`;
    try {
      const body = await response.json();
      if (body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // no JSON body; keep the status message
    }
    throw new Error(message);
  }
  return response.json();
}

export function getBars(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<MarketstoreBars> {
  const params = new URLSearchParams({ timeframe, limit: String(limit) });
  return msGet<MarketstoreBars>(
    `/v1/bars/${encodeURIComponent(symbol)}?${params}`,
  );
}

export function getQuotes(
  symbols: string[],
  timeframe = '1D',
): Promise<{ quotes: MarketstoreQuote[] }> {
  const params = new URLSearchParams({ symbols: symbols.join(','), timeframe });
  return msGet<{ quotes: MarketstoreQuote[] }>(`/v1/quotes?${params}`);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- marketstore`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/marketstore.ts __tests__/marketstore.test.ts .env.example jest.setup.js
git commit -m "feat: MarketStore REST client with auth seam and freq mapping"
```

### Task 2: Client-side indicators module

**Files:**
- Create: `src/indicators.ts`
- Create: `__tests__/indicators.test.ts`
- Modify: `package.json` (add `trading-signals` dependency)
- Modify: `jest.config.js:14-16` (allow `trading-signals` ESM through `transformIgnorePatterns`)

**Interfaces:**
- Consumes: `trading-signals@8.3.0` (`SMA`, `EMA`, `MACD`, `RSI`, `BollingerBands`).
- Produces:
  - `INDICATOR_COLUMNS: readonly string[]` — `['sma20','sma100','sma200','bbands_upper','bbands_lower','macd','macd_signal','macd_difference','rsi']`
  - `type IndicatorRow = Record<(typeof INDICATOR_COLUMNS)[number], number | null>`
  - `computeIndicators(closes: number[]): IndicatorRow[]` — one row per close, warmup positions hold `null`.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add trading-signals@8.3.0`

- [ ] **Step 2: Allow the ESM package through Jest**

In `jest.config.js`, the `transformIgnorePatterns` negative-lookahead allowlist currently ends with `react-native-libsodium`. Add `trading-signals` to it:

```js
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-gesture-handler|react-native-reanimated|react-native-drawer-layout|react-native-worklets|react-native-config|react-native-webview|react-native-libsodium|trading-signals)/)',
```

- [ ] **Step 3: Write the failing tests**

Create `__tests__/indicators.test.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test -- indicators`
Expected: FAIL — `Cannot find module '../src/indicators'`.

- [ ] **Step 5: Write the implementation**

Create `src/indicators.ts`:

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- indicators`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/indicators.ts __tests__/indicators.test.ts jest.config.js package.json pnpm-lock.yaml
git commit -m "feat: client-side indicators (SMA/BBands/MACD/RSI) via trading-signals"
```

### Task 3: Rewire `fetchHistory` to MarketStore + indicators

**Files:**
- Modify: `src/api.ts:47-68` (replace `fetchHistory` body; add imports and constants)
- Create: `__tests__/apiHistory.test.ts`

**Interfaces:**
- Consumes: `getBars`, `freqToTimeframe` (Task 1); `computeIndicators`, `INDICATOR_COLUMNS` (Task 2).
- Produces: `fetchHistory(symbol: string, frequency?: string, limit?: number): Promise<HistoryResponse>` — unchanged signature; now returns MarketStore-derived columnar data. `HistoryResponse` type is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/apiHistory.test.ts`:

```ts
import { fetchHistory } from '../src/api';

afterEach(() => jest.restoreAllMocks());

function barsResponse(bars: unknown[]) {
  return {
    ok: true,
    json: async () => ({ symbol: 'AAPL', timeframe: '1D', bars }),
  } as unknown as Response;
}

test('maps app frequency to the MarketStore timeframe and over-fetches warmup', async () => {
  const spy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(barsResponse([]));
  await fetchHistory('AAPL', '5min', 100);
  const url = spy.mock.calls[0][0] as string;
  expect(url).toContain('/v1/bars/AAPL');
  expect(url).toContain('timeframe=5Min');
  expect(url).toContain('limit=300'); // 100 + 200 warmup
});

test('returns empty columnar response when there are no bars', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse([]));
  const res = await fetchHistory('AAPL', 'D', 100);
  expect(res).toEqual({ columns: [], index: [], data: [] });
});

test('builds columnar HistoryResponse with ms index and indicator columns', async () => {
  const bars = [
    { time: '2024-01-12T00:00:00Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000 },
    { time: '2024-01-15T00:00:00Z', open: 1.5, high: 2.5, low: 1, close: 2, volume: 1200 },
  ];
  jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse(bars));
  const res = await fetchHistory('AAPL', 'D', 2);

  expect(res.columns).toEqual([
    'open', 'high', 'low', 'close', 'volume',
    'sma20', 'sma100', 'sma200',
    'bbands_upper', 'bbands_lower',
    'macd', 'macd_signal', 'macd_difference', 'rsi',
  ]);
  // index is epoch milliseconds (ChartScreen divides by 1000).
  expect(res.index).toEqual([
    Date.parse('2024-01-12T00:00:00Z'),
    Date.parse('2024-01-15T00:00:00Z'),
  ]);
  // First five values of each row are raw OHLCV.
  expect(res.data[0].slice(0, 5)).toEqual([1, 2, 0.5, 1.5, 1000]);
  expect(res.data[1].slice(0, 5)).toEqual([1.5, 2.5, 1, 2, 1200]);
  // Indicators are null this early in the warmup (period not filled).
  expect(res.data[0][res.columns.indexOf('sma200')]).toBeNull();
});

test('slices off the warmup prefix so returned length is at most limit', async () => {
  const bars = Array.from({ length: 250 }, (_, i) => ({
    time: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(),
    open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 10,
  }));
  jest.spyOn(global, 'fetch').mockResolvedValue(barsResponse(bars));
  const res = await fetchHistory('AAPL', 'D', 50);
  expect(res.index).toHaveLength(50);
  // sma200 is warm on the tail because indicators ran over the full 250 bars.
  expect(res.data[49][res.columns.indexOf('sma200')]).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- apiHistory`
Expected: FAIL — current `fetchHistory` hits `${API_BASE}/finance/history` (mock URL won't match `/v1/bars`; column set won't match).

- [ ] **Step 3: Update imports and add constants in `src/api.ts`**

At the top of `src/api.ts`, below the existing `import Config from 'react-native-config';`, add:

```ts
import { getBars, getQuotes, freqToTimeframe } from './marketstore';
import { computeIndicators, INDICATOR_COLUMNS } from './indicators';

const OHLCV_COLUMNS = ['open', 'high', 'low', 'close', 'volume'] as const;
const HISTORY_COLUMNS = [...OHLCV_COLUMNS, ...INDICATOR_COLUMNS];
// Longest indicator period (sma200); over-fetch this many extra bars so
// indicators are warm across the returned window, matching fa-techan which
// computes TA on the full series before slicing.
const HISTORY_WARMUP = 200;
```

(`getQuotes` is imported now; it is used in Task 4.)

- [ ] **Step 4: Replace the `fetchHistory` implementation**

Replace the entire existing `fetchHistory` function (`src/api.ts:47-68`) with:

```ts
export async function fetchHistory(
  symbol: string,
  frequency?: string,
  limit?: number,
): Promise<HistoryResponse> {
  const timeframe = freqToTimeframe(frequency ?? 'D');
  const want = limit ?? 1500;
  const { bars } = await getBars(symbol, timeframe, want + HISTORY_WARMUP);
  if (bars.length === 0) {
    return { columns: [], index: [], data: [] };
  }

  const indicators = computeIndicators(bars.map(b => b.close));
  const startIdx = Math.max(0, bars.length - want);

  const index: number[] = [];
  const data: (number | null)[][] = [];
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    const ind = indicators[i];
    index.push(Date.parse(b.time));
    data.push([
      b.open,
      b.high,
      b.low,
      b.close,
      b.volume,
      ind.sma20,
      ind.sma100,
      ind.sma200,
      ind.bbands_upper,
      ind.bbands_lower,
      ind.macd,
      ind.macd_signal,
      ind.macd_difference,
      ind.rsi,
    ]);
  }

  return { columns: HISTORY_COLUMNS, index, data };
}
```

Note: `HistoryResponse.data` is typed `number[][]`. Widen it to accept nulls — in the `HistoryResponse` type declaration (`src/api.ts:27-31`), change `data: number[][];` to `data: (number | null)[][];`. `ChartScreen` already treats cell values as possibly null (`ChartScreen.tsx:265` guards `null`/`undefined`/`NaN`), so this is a safe widening.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- apiHistory`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the chart screen test to confirm no consumer regression**

Run: `pnpm test -- chartScreen`
Expected: PASS. `__tests__/chartScreen.test.tsx:11` does `jest.mock('../src/api')` and stubs `fetchHistory` directly (`chartScreen.test.tsx:21`), so it never exercises the rewired internals — it must stay green with zero edits.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts __tests__/apiHistory.test.ts
git commit -m "feat: fetchHistory pulls bars from MarketStore + client-side indicators"
```

### Task 4: Rewire `fetchQuotes` to MarketStore

**Files:**
- Modify: `src/api.ts:35-45` (replace `fetchQuotes` body)
- Create: `__tests__/apiQuotes.test.ts`

**Interfaces:**
- Consumes: `getQuotes` (Task 1, already imported in Task 3).
- Produces: `fetchQuotes(tickers: string[]): Promise<ApiQuote[]>` — unchanged signature and `ApiQuote` return type.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/apiQuotes.test.ts`:

```ts
import { fetchQuotes } from '../src/api';

afterEach(() => jest.restoreAllMocks());

test('returns [] without calling the network for an empty ticker list', async () => {
  const spy = jest.spyOn(global, 'fetch');
  const res = await fetchQuotes([]);
  expect(res).toEqual([]);
  expect(spy).not.toHaveBeenCalled();
});

test('maps MarketStore quotes to ApiQuote shape', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      quotes: [
        {
          symbol: 'AAPL',
          time: '2024-01-15T00:00:00Z',
          open: 1.5,
          high: 2.5,
          low: 1,
          close: 2,
          volume: 1200,
          prev_close: 1.5,
        },
      ],
    }),
  } as unknown as Response);

  const res = await fetchQuotes(['AAPL']);
  expect(res).toEqual([
    {
      ticker: 'AAPL',
      date: '2024-01-15T00:00:00Z',
      open: 1.5,
      high: 2.5,
      low: 1,
      close: 2,
      volume: 1200,
      prev_close: 1.5,
    },
  ]);
});

test('passes prev_close null through unchanged', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      quotes: [
        {
          symbol: 'NEW',
          time: '2024-01-15T00:00:00Z',
          open: 5,
          high: 5,
          low: 5,
          close: 5,
          volume: 1,
          prev_close: null,
        },
      ],
    }),
  } as unknown as Response);

  const res = await fetchQuotes(['NEW']);
  expect(res[0].prev_close).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- apiQuotes`
Expected: FAIL — current `fetchQuotes` hits `${API_BASE}/finance/quotes` and returns the raw JSON (no `symbol`→`ticker` / `time`→`date` mapping).

- [ ] **Step 3: Replace the `fetchQuotes` implementation**

Replace the entire existing `fetchQuotes` function (`src/api.ts:35-45`) with:

```ts
export async function fetchQuotes(tickers: string[]): Promise<ApiQuote[]> {
  if (tickers.length === 0) {
    return [];
  }
  const { quotes } = await getQuotes(tickers, '1D');
  return quotes.map(q => ({
    ticker: q.symbol,
    date: q.time,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    volume: q.volume,
    prev_close: q.prev_close,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- apiQuotes`
Expected: PASS (3 tests).

- [ ] **Step 5: Confirm no consumer regression**

Run: `pnpm test -- watchlistsScreen`
Expected: PASS. `__tests__/watchlistsScreen.test.tsx:11` does `jest.mock('../src/api')` and stubs `fetchQuotes` (`watchlistsScreen.test.tsx:23`), so it is unaffected — must stay green with zero edits.

- [ ] **Step 6: Full suite + typecheck**

Run: `pnpm test`
Expected: PASS (whole suite).
Run: `pnpm tsc --noEmit` (or the repo's typecheck script if different)
Expected: no type errors — confirms the `HistoryResponse.data` null-widening from Task 3 is consistent across `ChartScreen`.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts __tests__/apiQuotes.test.ts
git commit -m "feat: fetchQuotes reads MarketStore /v1/quotes"
```

### Task 5: Indicator calibration against fa-techan

Goal: prove the client-side indicators match fa-techan's TA-Lib output within tolerance on a real series, and document any residual. This is the "tuning knob" — if one indicator diverges beyond tolerance, hand-roll only that one.

**Files:**
- Create: `__tests__/fixtures/faTechanHistory.json` (recorded fa-techan response)
- Create: `__tests__/indicatorCalibration.test.ts`

**Interfaces:**
- Consumes: `computeIndicators` (Task 2). Reads the columnar fixture directly (no app code imports it).

- [ ] **Step 1: Capture a real fa-techan history response as a fixture**

With fa-techan reachable, pick a liquid symbol with a long daily history (≥ 400 bars so `sma200` and MACD are well past warmup) and save the raw response:

```bash
mkdir -p __tests__/fixtures
curl -s "$API_BASE_URL/finance/history/AAPL?frequency=D&limit=400" \
  > __tests__/fixtures/faTechanHistory.json
```

The file is columnar: `{ "columns": [...], "index": [...ms...], "data": [[...], ...] }`, and its `columns` include `close`, `sma20`, `sma100`, `sma200`, `bbands_upper`, `bbands_lower`, `macd`, `macd_signal`, `macd_difference`, `rsi`. Commit it as a checked-in fixture so the test runs offline.

- [ ] **Step 2: Write the calibration test**

Create `__tests__/indicatorCalibration.test.ts`:

```ts
import { computeIndicators } from '../src/indicators';
import fixture from './fixtures/faTechanHistory.json';

type Columnar = { columns: string[]; index: number[]; data: (number | null)[][] };

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

function assertColumnClose(
  name: keyof (typeof ours)[number],
  tol: number,
) {
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
```

- [ ] **Step 3: Run the calibration test**

Run: `pnpm test -- indicatorCalibration`
Expected: PASS. Read the `calibration ... maxRel=` lines in the output.

- [ ] **Step 4: Document residuals (and hand-roll only if needed)**

Record the observed `maxRel` per indicator as a `ponytail:` comment at the top of `src/indicators.ts`, e.g.:

```ts
// ponytail: calibrated vs fa-techan/TA-Lib on AAPL 400d — maxRel sma<0.001,
// bbands<0.003, rsi<0.006, macd<0.012. trading-signals uses population sigma
// (matches TA-Lib) and first-value EMA seeding (source of the small MACD
// residual, decays past warmup). Upgrade path: hand-roll the offending
// indicator with TA-Lib seeding if a tighter match is ever required.
```

If any `assertColumnClose` fails, do NOT loosen the tolerance. Replace only that indicator's computation in `src/indicators.ts` with a hand-rolled version matching TA-Lib's convention (population σ for BBands; SMA-seeded EMA for MACD), keeping the same `IndicatorRow` output, then re-run until green.

- [ ] **Step 5: Commit**

```bash
git add __tests__/fixtures/faTechanHistory.json __tests__/indicatorCalibration.test.ts src/indicators.ts
git commit -m "test: calibrate client-side indicators against fa-techan output"
```

---

## Self-Review

**Spec coverage:**
- Marketstore REST client + auth seam + error mapping → Task 1.
- Freq→timeframe map → Task 1 (`freqToTimeframe`).
- Config keys (`MARKETSTORE_BASE_URL`, `MARKETSTORE_AUTH_TOKEN`) → Task 1. (`BackendSettingsScreen` display was optional/low-priority in the spec and is intentionally deferred — pure debug convenience, no functional need.)
- Client-side indicators with fa-techan params → Task 2.
- `fetchHistory` adapter: warmup over-fetch, columnar assembly, ms index, slice → Task 3.
- `fetchQuotes` adapter: symbol→ticker/time→date mapping, prev_close passthrough, empty short-circuit → Task 4.
- Consumers untouched (ChartScreen/WatchlistsScreen/techan) → verified in Task 3 Step 6, Task 4 Step 5.
- Calibration test + per-indicator hand-roll fallback → Task 5.
- Testing: golden (Task 2), adapter (Tasks 3–4), freq-map (Task 1), calibration (Task 5).

**Placeholder scan:** No TBD/TODO; all code blocks are complete and runnable.

**Type consistency:** `MarketstoreBar/Bars/Quote`, `freqToTimeframe`, `getBars`, `getQuotes` (Task 1) are consumed with matching signatures in Tasks 3–4. `INDICATOR_COLUMNS`/`IndicatorRow`/`computeIndicators` (Task 2) match their use in Task 3. `HISTORY_COLUMNS` order matches the row-push order in `fetchHistory` and the asserted column list in Task 3's test. `HistoryResponse.data` widened to `(number|null)[][]` in Task 3, consistent with Task 4's typecheck step.

**Deferred (out of scope, noted in spec):** `BackendSettingsScreen` MarketStore URL display; real nginx auth scheme (only the header seam is built).

