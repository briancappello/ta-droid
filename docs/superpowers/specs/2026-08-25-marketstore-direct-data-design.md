# Marketstore Direct Data — Design

**Date:** 2026-08-25
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Point the mobile app's market-data layer (quotes + chart history) directly at
MarketStore's new read-only REST API instead of proxying through the fa-techan
backend. Market data becomes independent of fa-techan (lower latency, survives
a fa-techan outage). fa-techan keeps only strategy tagging, health, and
watchlists.

## Motivation

1. **Lower latency** — fa-techan currently just proxies MarketStore for
   quotes/history; cutting the hop speeds up chart and watchlist loads.
2. **Decouple** — quotes and charts should keep working when fa-techan is down.

## Scope

**In scope:** `fetchQuotes` and `fetchHistory` in `src/api.ts` move to
MarketStore. Indicators the chart needs are computed client-side.

**Out of scope (stays on fa-techan, `src/techan.ts`):** health chip, strategy
tagging, strategy watchlists. No changes to trading/broker layer.

## Global Constraints

- **No new consumer changes.** `ChartScreen.tsx` (~850 lines) and
  `WatchlistsScreen.tsx` must remain untouched. The adapter preserves their
  existing input types (`HistoryResponse` columnar, `ApiQuote[]`).
- **Auth seam only.** MarketStore is wide open today; it will sit behind an
  nginx reverse proxy adding TLS + auth later. The client sends an optional
  `Authorization` header from config; the exact auth scheme is a follow-up.
- **Indicator parity.** Client-side indicators must visually match fa-techan's
  TA-Lib output within tolerance. Divergence sources (BBands population σ, EMA
  seeding) are known and covered by a calibration test.

## Endpoints

MarketStore REST (`../marketstore/docs/rest-api.md`), read-only row JSON:

- `GET /v1/quotes?symbols=<csv>&timeframe=1D`
  → `{"quotes":[{time,open,high,low,close,volume,symbol,prev_close}, ...]}`
  sorted by symbol. Symbols with no data are omitted. `prev_close` is `null`
  when only one bar exists.
- `GET /v1/bars/{symbol}?timeframe=<tf>&limit=<n>&start=&end=`
  → `{"symbol","timeframe","bars":[{time,open,high,low,close,volume}, ...]}`.
  One symbol only. `limit` max 10000. With no `start`/`end`, returns the most
  recent `limit` bars.

Conventions: timestamps are RFC3339 under `time`; `NaN`/`inf` render as `null`;
errors are `{"error":"..."}` with status `400`/`404`/`503`.

## Architecture

```
ChartScreen ──fetchHistory(ticker,freq,bars)──┐
WatchlistsScreen ──fetchQuotes(symbols)────────┤
                                               ▼
                                          src/api.ts  (adapter — unchanged signatures)
                                          │        │
                        src/marketstore.ts│        │src/indicators.ts
                        (REST client)     │        │(trading-signals TA)
                                          ▼        ▼
                                     MarketStore /v1/*
```

### `src/marketstore.ts` (new)

Thin fetch client. Responsibilities:

- Read `MARKETSTORE_BASE_URL` and optional `MARKETSTORE_AUTH_TOKEN` from
  `react-native-config`.
- `getBars(symbol, timeframe, limit)` → native `{symbol,timeframe,bars[]}`.
- `getQuotes(symbols, timeframe)` → native `quotes[]`.
- Attach `Authorization` header when the token is set.
- Map HTTP failures to a thrown `Error` carrying status + message
  (`400`→bad param, `404`→unknown symbol, `503`→starting, network→friendly
  "Can't reach market data" message). Reuse existing error style; no new class
  unless one earns its keep.

### `src/indicators.ts` (new)

Pure functions over parallel OHLCV arrays, using `trading-signals` `Faster*`
numeric variants. Produces exactly the columns `ChartScreen` reads. Params
match fa-techan/TA-Lib (`../fa-techan/app/api/v1/finance/history.py:48`):

| Column | Source | Params |
|---|---|---|
| `sma100` | `FasterSMA` | period 100 |
| `sma200` | `FasterSMA` | period 200 |
| `sma20` | `FasterBollingerBands` middle | period 20, ±2σ |
| `bbands_upper` / `bbands_lower` | `FasterBollingerBands` | period 20, ±2σ |
| `macd` / `macd_signal` / `macd_difference` | `FasterMACD` | 12 / 26 / 9 |
| `rsi` | `FasterRSI` | period 14 (Wilder) |

Warmup NaN/undefined during an indicator's ramp render as `null` in the
column; `ChartScreen.buildLineSeries` already skips null/NaN. Columns the chart
does not read (`sma500`, `sma1000`, `stoch_k`, `stoch_d`) are not computed.

### `src/api.ts` (edit — internals only)

`fetchQuotes` / `fetchHistory` keep signatures and return types.

**`fetchHistory(symbol, frequency, limit)`:**
1. Map app freq → MarketStore timeframe (table below).
2. Over-fetch `limit + WARMUP` bars (`WARMUP = 200`, the longest period used
   by `sma200`) so indicators are warm across the returned window — mirrors
   fa-techan computing TA on the full series then slicing (`history.py:25-30`).
3. Compute indicator columns on the full fetched series via `indicators.ts`.
4. Assemble columnar `HistoryResponse`:
   - `columns`: `["open","high","low","close","volume","sma20","sma100",
     "sma200","bbands_upper","bbands_lower","macd","macd_signal",
     "macd_difference","rsi"]`
   - `index`: RFC3339 `time` → epoch **milliseconds** (`Date.parse`). Confirmed
     ms because `ChartScreen.tsx:233` divides `index` by 1000 to reach seconds.
   - `data`: row-per-bar aligned to `columns`; `NaN`/absent → `null`.
5. Slice off the warmup prefix so returned length ≈ `limit`.

**`fetchQuotes(symbols)`:**
1. `GET /v1/quotes?symbols=<csv>&timeframe=1D`.
2. Map each quote → `ApiQuote`: `symbol`→`ticker`, `time`→`date`, pass through
   `open/high/low/close/volume/prev_close`.
3. No-data symbols already omitted by MarketStore — no client filtering needed.

`apiQuoteToStockQuote` is unchanged; `new Date(q.date)` parses RFC3339 fine.

### Frequency → timeframe mapping

Derived from `fin.enums.Freq` (app values) and `pymarketstore.Freq`
(MarketStore strings):

| App `frequency` | MarketStore `timeframe` |
|---|---|
| `1min` | `1Min` |
| `2min` | `2Min` |
| `5min` | `5Min` |
| `10min` | `10Min` |
| `15min` | `15Min` |
| `30min` | `30Min` |
| `h` | `1H` |
| `D` | `1D` |
| `W` | `1W` |
| `M` | `1M` |

Unknown/unmapped freq → throw (fail loud), matching a bad-param `400`.

## Config

- New `.env` keys: `MARKETSTORE_BASE_URL` (required),
  `MARKETSTORE_AUTH_TOKEN` (optional; unset = no header, works against the
  wide-open server today).
- Add to `.env.example` and the `react-native-config` type declaration.
- Display only (optional, low priority): surface the MarketStore URL in
  `BackendSettingsScreen` next to the existing API base for debugging.

## Error Handling

- `marketstore.ts` throws on non-2xx and on network failure; `api.ts`
  propagates. `ChartScreen` and `WatchlistsScreen` already catch thrown errors
  from `fetchHistory`/`fetchQuotes` and show their existing error states.
- Empty result (`bars: []` / no quotes) maps to the existing empty-state paths
  (`ChartScreen.tsx:626` handles `data.data.length === 0`).
- `NaN`/infinite values from MarketStore already arrive as `null`; indicator
  warmup gaps are `null`. Both render as no-op points.

## Testing & Calibration

- **Indicator golden tests** (`__tests__/indicators.test.ts`): fixed OHLCV
  input → expected SMA/BBands/MACD/RSI values within a small tolerance.
- **Adapter tests** (`__tests__/api.test.ts` or new): MarketStore JSON
  fixtures → assert `HistoryResponse` (columns order, ms index, null handling)
  and `ApiQuote` mapping.
- **Freq-map test**: every app freq maps to the expected timeframe; unknown
  throws.
- **Calibration test** (the tuning knob): compare `indicators.ts` output
  against a recorded fa-techan `/finance/history` response for one real symbol
  (checked-in fixture). Assert per-indicator closeness within tolerance;
  document any residual delta in a `ponytail:` note. If one indicator diverges
  beyond tolerance (BBands σ convention or MACD EMA seeding), replace *only
  that indicator* with a hand-rolled TA-Lib-matched version.

## Risks

1. **TA-Lib bit-parity.** No JS lib matches TA-Lib exactly (population σ, EMA
   seeding). Mitigated by the calibration test + per-indicator hand-roll
   fallback.
2. **Timestamp units.** RFC3339 → epoch-ms handled in the adapter; covered by
   an adapter test asserting a known timestamp.
3. **nginx auth scheme unknown.** Only a header seam is built now; wiring the
   real token/scheme is a follow-up once infra lands.
4. **Over-fetch cost.** `limit + 200` bars per chart load; trivial against the
   10000 cap and one network round trip.

## Files

- `src/marketstore.ts` — new REST client + auth seam.
- `src/indicators.ts` — new client-side TA (trading-signals).
- `src/api.ts` — rewire internals; signatures/types preserved.
- `__tests__/indicators.test.ts`, adapter/freq tests — new.
- `.env.example`, `react-native-config` typings — new config keys.
- `package.json` — add `trading-signals`.
- Unchanged: `src/screens/ChartScreen.tsx`, `src/screens/WatchlistsScreen.tsx`,
  `src/techan.ts`.
