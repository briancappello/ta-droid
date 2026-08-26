# Live Streaming (WebSocket) — Design

**Date:** 2026-08-26
**Status:** Approved (brainstorm), pending implementation plan
**Repos:** `ta-droid` (app) + `marketstore` (watchlist plugin)

## Goal

Show live, streaming prices in the app instead of one-shot snapshots:

1. **Watchlists** re-rank live and show live **prices** (premarket top gainers /
   relative volume actually move).
2. **Charts** update the in-progress candle in realtime and pop a new candle
   each period at the selected timeframe.

Both ride MarketStore's existing `/ws` WebSocket.

## Motivation

The app currently calls `fetchQuotes`/`fetchHistory` once and never updates.
MarketStore already streams live data over `/ws`; the app just doesn't consume
it. Watchlist rows and charts are therefore frozen even when the feed is live.

## MarketStore `/ws` protocol (verified against the live server)

- Connect `ws(s)://<host>/ws`, negotiate the **`json`** subprotocol
  (`wscodec.Subprotocols`).
- **Subscribe** (client→server): `{"action":"subscribe","tbks":[<TBK>,...]}`.
  A TBK is `Symbol/Timeframe/AttributeGroup` (three `/`-segments, glob wildcards
  allowed). **Subscribe replaces the whole set** — every subscribe message must
  carry the complete desired list. Server acks `{"action":"subscribed","tbks":[...]}`
  or replies `{"error":"..."}`.
- **Push** (server→client): `{"key":"<TBK>","data":{"msg_type":<type>,"payload":<obj>}}`.
  Observed `msg_type`s:
  - `bar` — key `SYMBOL/1Sec/OHLCV` and `SYMBOL/1Min/OHLCV`. Payload
    `{symbol,open,high,low,close,volume,epoch}`. For a given timeframe the
    **forming bar** is pushed repeatedly with a constant `epoch` (period start)
    and rising `close`/`volume`; at the period boundary a new `epoch` appears.
  - `watchlist_update` — key `WATCHLISTS/1Min/{NAME}`. Payload
    `{name, timeframe, symbols:[{symbol,rank,<fields...>,sector?}]}`. The full
    re-ranked list. Screener fields vary: `pct_change`, `gap_pct`,
    `momentum_score`, `volume_multiple`, `volume`; aggregates use
    `avg_pct_change`, `gainers`, `losers`, `symbol_count`, `total_volume` and a
    non-tradeable `symbol` (e.g. "Industrials").
  - `curation_change` — key `CURATION/1Min/CHANGES`. Not consumed by the app.
- Server sends WS pings every ~54s; React Native's WebSocket auto-pongs.

## Global Constraints

- **JSON subprotocol only.** RN WebSocket sends the subprotocol in the handshake.
- **Subscribe is a full replace** — the client owns the union of active TBKs and
  resends it whenever it changes or after a reconnect.
- **Config**: derive the WS URL from `MARKETSTORE_BASE_URL` (`http`→`ws`,
  `https`→`wss`) + `/ws`. If `MARKETSTORE_AUTH_TOKEN` is set, send it as an
  `Authorization` header on the handshake. No new env var.
- **Prices for aggregates are omitted** (sector/industry rollups have no
  tradeable price); rows fall back to their aggregate field.
- **Consumers keep working if the socket is down** — streaming is additive on
  top of the existing REST initial paint; a dead socket degrades to a static
  (but populated) screen, never a blank one.

## Architecture

```
                         MarketStore /ws  (json)
                                  ▲
                                  │ one shared socket
                     src/marketstoreStream.ts
              (connect, json subprotocol, reconnect+backoff,
               subscription registry -> union tbks -> resubscribe)
                    ▲                         ▲
      subscribe(WATCHLISTS/1Min/NAME)   subscribe(SYMBOL/tf/OHLCV)
                    │                         │
            WatchlistsScreen             ChartScreen (WebView)
        (rows: price + pct_change)   (series.update: forming + new bar)
```

### Part 1 — MarketStore: include latest price in watchlist rankings

The watchlist plugin already holds `SymbolState.LastPrice` (most recent price)
and `SymbolState.PriorClose` (yesterday's close), and the ranking worker has the
`curated map[string]*SymbolState` when it calls `PushWatchlistUpdate`.

- In the worker, after `strategy.Rank(curated)` returns `[]RankedSymbol`, inject
  each symbol's `price` (`LastPrice`) and `prior_close` (`PriorClose`) — looked
  up from `curated[sym]` — into the pushed payload. Do this centrally so no
  strategy changes.
- `PushWatchlistUpdate` adds `price` and `prior_close` to each symbol map, only
  when the state lookup succeeds (aggregate "symbols" like "Industrials" have no
  state → omitted).
- The REST `/v1/watchlists` and `/v1/watchlists/{name}` responses include the
  same `price`/`prior_close` so the app's initial paint already has prices.
- Files: `contrib/watchlist/framework/worker.go` (inject), `.../push.go`
  (`PushWatchlistUpdate` payload), the REST watchlist handler
  (`frontend/rest_handlers.go` / `rest_render.go`), plus tests.

### Part 2 — App WebSocket client (`src/marketstoreStream.ts`)

A single shared client managing all subscriptions.

- `wsUrl()` derives `ws(s)://…/ws` from `Config.MARKETSTORE_BASE_URL`.
- Opens one `WebSocket(url, ['json'])`. On open, sends the current union of
  subscribed TBKs. On message, dispatches `{key,data}` to handlers registered
  for that key (exact match; the app subscribes to concrete keys, no wildcards).
- **Subscription registry**: `subscribe(tbks: string[], onMessage): () => void`.
  Ref-counts TBKs; whenever the union changes it sends a fresh `subscribe`. The
  returned function unsubscribes (decrements, resends union).
- **Reconnect**: on close/error, reconnect with capped exponential backoff
  (e.g. 1s→2s→…→15s), and resend the union on reopen. A `status` signal
  (`connecting|open|closed`) feeds the health chip if wanted (optional).
- Pure module, testable by injecting a WebSocket factory / mock socket.

Produced API:
```ts
export type StreamMessage = { key: string; data: { msg_type: string; payload: any } };
export function subscribe(tbks: string[], onMessage: (m: StreamMessage) => void): () => void;
export function wsUrl(): string; // exported for tests
```

### Part 3 — Watchlists live

- Keep the initial `fetchWatchlists` + REST rows for instant paint (now with
  `price` from Part 1).
- When a watchlist is selected, `subscribe(['WATCHLISTS/1Min/' + selectedId], ...)`.
  On `watchlist_update`, replace rows from `payload.symbols` (already ranked):
  each row shows the **price** and a colored **pct_change%** (or the aggregate
  field for SECTOR/INDUSTRY). Missing price (aggregates) → show the field only.
- Changing the selected watchlist swaps the subscription; leaving the screen
  (blur) unsubscribes. A red MS dot / closed socket leaves the last REST rows
  visible.
- Row model shifts from `StockQuote` to the streamed ranked entry
  `{symbol, rank, price?, prior_close?, pct_change?/field}`; `WatchlistsScreen`
  maps that to display. `formatMoney`/`formatPercent` (existing) format it.

### Part 4 — Chart live

- History still loads via REST `fetchHistory` for the selected timeframe.
- Subscribe to `SYMBOL/{marketstoreTF}/OHLCV` where `marketstoreTF =
  freqToTimeframe(freq)`. On each `bar` push, post the bar into the WebView; the
  chart calls `candleSeries.update({time: epoch, open, high, low, close})` and
  `volumeSeries.update(...)`. lightweight-charts updates the in-progress candle
  (same `time`) or appends a new one (newer `time`) automatically — giving the
  "building" bar and the per-period new candle. The latest `close` also drives
  the current-price line.
- Bridge: RN → WebView via `webviewRef.injectJavaScript(...)` calling a small
  `window.__pushBar(bar)` hook added to the chart HTML.
- Changing timeframe/ticker re-subscribes; leaving the chart unsubscribes.
- Timeframe coverage: MarketStore streams `1Sec` and `1Min` (verified). For
  higher timeframes it may not stream a forming bar; the plan verifies coverage
  and, where a TF isn't streamed, either subscribes to `1Min` and updates the
  current higher-TF candle's close, or leaves that TF static (daily charts don't
  need tick updates). Decided during implementation against the live server.

## Error handling & lifecycle

- Socket open failure / close → backoff reconnect; screens keep last data.
- Malformed message → logged and skipped (never throws into React).
- Screen blur / unmount → unsubscribe (ref-count to zero closes nothing else).
- App background → RN may suspend the socket; on foreground the reconnect path
  re-establishes and resubscribes.

## Testing

- `marketstoreStream.ts`: unit tests with a mock WebSocket — subscribe sends the
  union, ack handling, message dispatch to the right handler, unsubscribe
  updates the union, reconnect resends on reopen, `wsUrl` derivation
  (http→ws/https→wss).
- Watchlists: given a `watchlist_update` payload, rows render price + pct_change;
  aggregate payload (no price) falls back to the field.
- Chart: given a `bar` message, the injected JS calls `update()` with the mapped
  bar (assert the bridge payload).
- MarketStore Part 1: worker injects price/prior_close; `PushWatchlistUpdate`
  payload carries them; REST watchlist response includes them; aggregates omit
  price. Go tests in `contrib/watchlist/...` + `frontend/`.
- Manual: against the live feed, confirm watchlist rows move and re-rank and the
  1Min chart's last candle builds then rolls.

## Risks

1. **Higher-timeframe streaming coverage** unknown beyond 1Sec/1Min — resolved
   in the plan against the live server (fallback: drive the current candle from
   the 1Min stream).
2. **Subscribe-replace semantics** — a bug in the union registry could drop a
   screen's subscription; covered by unit tests.
3. **WebView bridge cost** — high-frequency `injectJavaScript` on 1Sec ticks;
   throttle to animation frames or coalesce to the latest bar if needed.
4. **Reconnect storms** — capped backoff + single shared socket bound this.
5. **nginx `wss` + auth** — handshake header seam only; real proxy config is
   infra follow-up (same as the REST auth seam).

## Files

**ta-droid**
- `src/marketstoreStream.ts` — new shared WS client + subscription registry.
- `src/screens/WatchlistsScreen.tsx` — subscribe to the ranking stream; row model.
- `src/screens/ChartScreen.tsx` + chart HTML — subscribe to `SYMBOL/tf/OHLCV`,
  `window.__pushBar` bridge, `series.update`.
- `src/marketstore.ts` — `MarketstoreWatchlist` entry type gains `price?`,
  `prior_close?`; add `wsUrl` helper if not in the stream module.
- Tests: `__tests__/marketstoreStream.test.ts`, updates to watchlists/chart tests.

**marketstore**
- `contrib/watchlist/framework/worker.go`, `.../push.go` — inject price.
- `frontend/rest_handlers.go` / `rest_render.go` — REST watchlist price.
- Go tests alongside.
