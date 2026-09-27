## Purpose

Supply bars, quotes, watchlists, and live updates from the active profile's MarketStore, with clear errors when the data can't be loaded.

## ADDED Requirements

### Requirement: Frequency mapping
The app SHALL map chart frequencies to MarketStore timeframes: `1min`→`1Min`, `2min`→`2Min`, `5min`→`5Min`, `10min`→`10Min`, `15min`→`15Min`, `30min`→`30Min`, `h`→`1H`, `D`→`1D`, `W`→`1W`, `M`→`1M`. An unknown frequency SHALL be an error.

#### Scenario: Unknown frequency
- **WHEN** history is requested with an unmapped frequency
- **THEN** the request fails with an "Unknown frequency" error and no network call is made

### Requirement: History with indicator warmup
A history request for `limit` bars (default 1500) SHALL fetch `limit + 200` bars from `GET /v1/bars/{symbol}?timeframe&limit`. It SHALL compute the indicators over the full series and return only the last `limit` rows. The result SHALL be columnar: the columns `open, high, low, close, volume` followed by the indicator columns, epoch-millisecond timestamps, and a data matrix. No bars SHALL give empty columns, index, and data.

#### Scenario: Warmup rows dropped
- **WHEN** 1500 bars are requested and MarketStore returns 1700
- **THEN** the result has 1500 rows and the indicators in the last rows are not null

### Requirement: Quotes
Quotes SHALL come from `GET /v1/quotes?symbols=<csv>&timeframe=1D`. An empty symbol list SHALL return an empty result without a network call. `prev_close` MAY be null.

#### Scenario: Empty symbol list
- **WHEN** quotes are requested for no symbols
- **THEN** an empty result is returned and no request is sent

### Requirement: MarketStore errors
MarketStore data requests SHALL fail with user-facing messages. A network failure SHALL give "Can't reach market data — check your connection." A non-2xx response SHALL give the server's `error` text, or "Market data error: <status>" if there is none.

#### Scenario: Server error text
- **WHEN** MarketStore answers 400 with `{"error":"bad symbol"}`
- **THEN** the message shown is "bad symbol"

### Requirement: Watchlists
The app SHALL list watchlists from `GET /v1/watchlists` and show friendly labels for known names (for example `PCT_CHANGE_UP` → "Top Gainers"). Unknown names SHALL be shown as they are. The first watchlist SHALL be selected automatically, and its entries SHALL come from `GET /v1/watchlists/{name}`. Each row SHALL show:
- the price, green when it is at or above the prior close, otherwise red;
- the change percent from the open, `(price − open) / open × 100`, or empty if the open is missing or zero;
- `avg_pct_change` for aggregate rows;
- `--` when there is no data.

Money SHALL use 2 decimals, or 4 below $1. Percent SHALL use 2 decimals with a `+` sign for non-negative values. If listing fails or returns nothing, the screen SHALL show "Watchlists unavailable." A failed entries fetch SHALL be ignored. Tapping a row SHALL open the chart for that symbol.

#### Scenario: Watchlists unavailable
- **WHEN** `GET /v1/watchlists` fails
- **THEN** the screen shows "Watchlists unavailable."

#### Scenario: Change from open
- **WHEN** a row has open 100 and price 102
- **THEN** it shows "+2.00%"

### Requirement: Live stream
The app SHALL keep one shared WebSocket to the active profile's MarketStore at the base URL with `http` replaced by `ws` and `/ws` appended, using the `json` subprotocol. It SHALL open the socket on the first subscription. Subscriptions SHALL be reference-counted. On every change the app SHALL send the full set as `{"action":"subscribe","tbks":[...]}`, including an empty set after the last unsubscribe. Unsubscribing SHALL be idempotent. Messages without a `key`, messages with an `action`, and malformed messages SHALL be dropped. Other messages SHALL go to the subscribers of that exact key.

#### Scenario: Refcounted subscribe
- **WHEN** two views subscribe to the same key and one unsubscribes
- **THEN** the key stays in the subscribed set until the second view unsubscribes

### Requirement: Stream reconnect
The stream SHALL reconnect after a close, an error, or a failed connection attempt. The delay SHALL be `min(1000 × 2^n, 15000)` ms, and it SHALL reset after a successful open. After reconnecting, the app SHALL resend the full subscription set. A connection failure SHALL NOT raise an error to the UI.

#### Scenario: Server restart
- **WHEN** the socket closes and the server comes back
- **THEN** the app reconnects with backoff and resends the subscriptions

### Requirement: Watchlist streaming
The watchlist screen SHALL subscribe to `WATCHLISTS/1Min/{name}`. Each `watchlist_update` message SHALL replace all rows with `payload.symbols`. The screen SHALL unsubscribe when the selected watchlist changes or the screen is closed.

#### Scenario: Watchlist update
- **WHEN** a `watchlist_update` arrives for the selected list
- **THEN** the rows are replaced with the message's symbols
