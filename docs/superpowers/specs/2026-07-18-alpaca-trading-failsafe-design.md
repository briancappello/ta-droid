# Alpaca Trading Failsafe — Design

**Date:** 2026-07-18
**Status:** Approved (design phase)

## Purpose

Add a device-resident failsafe to monitor and manage Alpaca orders and positions
directly from the app. This is an emergency tool used when the primary backend
(which normally manages all orders and positions) is unavailable. Because it must
work when the backend is down, the app talks **directly to Alpaca's Trading REST
API** — never through the existing `api/v1` backend proxy.

Scope is full CRUD: monitor positions and open orders, cancel orders, modify
orders, create new orders, and close positions.

## Architecture

### Direct-to-Alpaca client

A new `src/alpaca.ts` module mirrors the existing `src/api.ts` style: typed
functions over `fetch`, no SDK. The official Node SDK
(`@alpacahq/alpaca-trade-api`) is Node-oriented and pulls in dependencies that do
not fit React Native, so we call the REST API directly.

Every call takes the active account and:

- Sends auth headers `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`.
- Chooses the host from the account's `env`:
  - `paper` → `https://paper-api.alpaca.markets`
  - `live` → `https://api.alpaca.markets`

### Endpoints (Trading API v2)

| Action | Method + path |
|--------|---------------|
| List positions | `GET /v2/positions` |
| Close / flatten a position | `DELETE /v2/positions/{symbol}` |
| List open orders | `GET /v2/orders?status=open` |
| Create order | `POST /v2/orders` |
| Modify (replace) order | `PATCH /v2/orders/{id}` |
| Cancel order | `DELETE /v2/orders/{id}` |

### Data flow

Screen → `alpaca.ts` function (active account) → Alpaca REST → typed result →
screen state.

Freshness: pull-to-refresh + a manual refresh button + refetch on screen focus.
No polling and no WebSocket streaming in the MVP.

## Account storage & security

### Model

An account is:

```ts
type Account = {
  id: string;
  name: string;
  key: string;
  secret: string;
  env: 'paper' | 'live';
};
```

Accounts are an arbitrary named list (e.g. "Paper", "Traditional IRA"). In
practice there is exactly one paper account, but nothing enforces that.

### Encrypted at rest

Secrets are stored in OS-backed secure storage via **`react-native-keychain`**,
which uses the Android Keystore (hardware-backed where available) rather than
plaintext `AsyncStorage`. We do not roll our own crypto. This is one new native
dependency and requires an Android rebuild.

Storage is split so secrets never sit in general app state:

- **Secrets** (`key`, `secret`) → keychain, one entry per account `id`.
- **Non-secret metadata** (`id`, `name`, `env`, ordering) → a small JSON blob
  (keychain or `AsyncStorage`). Secrets must never appear in this blob.

A single `src/accounts.ts` module owns load / save / add / edit / delete and is
the only code that touches the keychain.

### Active account

The selected account `id` is held in React state and persisted so it survives
restarts. The account dropdown on the Trading screen and the account dropdown on
the New Order form both read and write this.

## Screens & navigation

Drawer navigation (`@react-navigation/drawer`) becomes the top-level navigator,
wrapping the existing native stack. The decorative `☰` in the Portfolio header
(currently inert, `PortfolioScreen.tsx:53`) is wired to open the drawer.

Drawer entries:

- **Portfolio** — existing quotes screen, unchanged.
- **Trading** — Positions + Open Orders.
- **Accounts** — manage the account list.

### TradingScreen (`src/screens/TradingScreen.tsx`)

- Header: `☰` + account dropdown (shows name and paper/live label).
- Top tabs **POSITIONS / OPEN ORDERS**, reusing the tab-bar pattern from
  `PortfolioScreen`.
- **Positions tab:** symbol, qty, avg entry, market value, unrealized P/L
  (green/red like the existing `StockRow`). Tap a row → action sheet:
  **Close position** / **New order for this symbol**.
- **Open Orders tab:** symbol, side, type, qty, limit/stop price, status. Tap a
  row → **Modify** / **Cancel**.
- Pull-to-refresh + refresh button; refetch on focus.
- Floating **＋ New Order** button.

### OrderEntryScreen (`src/screens/OrderEntryScreen.tsx`)

Full form, reused for create and modify, and launchable pre-filled from
`ChartScreen`.

- **Account dropdown** — its own selector, defaults to the active account, so an
  order can be fired at any account from anywhere (including the chart).
- Fields: Symbol; Side (Buy/Sell); Qty **or** Notional; Type (Market / Limit /
  Stop / Stop-Limit / Trailing); Limit price / Stop price / trail params shown
  conditionally by type; Time-in-force (Day / GTC / IOC / FOK / OPG / CLS);
  Extended-hours toggle.
- Client-side validation before submit (required price for limit/stop, positive
  qty, type/price consistency).
- **Review & Submit** confirmation screen showing exactly what will be sent
  (symbol, side, qty, type, price, TIF, target account) before firing.
- **Modify mode:** pre-filled from the existing order; submits `PATCH` (replace)
  instead of `POST`. Alpaca's replace accepts only `qty`, `time_in_force`,
  `limit_price`, `stop_price`, and `trail` — so in modify mode symbol, side, and
  type are shown read-only and only those fields are editable.

### AccountsScreen (`src/screens/AccountsScreen.tsx`)

List existing accounts; add / edit / delete with fields name, key, secret, and
env toggle. Secret is shown masked. Deleting removes the keychain entry.

### ChartScreen

Add a "Trade" affordance that opens `OrderEntryScreen` pre-filled with the
current ticker.

### Shared components

- `AccountPicker` — used by the Trading header and OrderEntry form.
- A reusable action-sheet / confirm modal following the existing `Modal` styling.
- Styles remain inline per-screen per current convention; the dark palette
  (`#1a1a2e` / `#16213e` / `#2196f3`) is reused.

## Error handling

- `alpaca.ts` maps HTTP status to a typed error:
  - 401 / 403 → "Check API keys for this account"
  - 422 → surface Alpaca's validation message
  - 429 → "Rate limited, retry shortly"
  - network error → "Can't reach Alpaca — check connection"
- No silent `console.warn`-only failures on write paths (unlike the current
  Portfolio fetch).
- Write actions (create / modify / cancel / close) show a pending state, then
  success or the mapped error inline; lists refetch after a successful write.
- Empty account list → screens prompt "Add an account" instead of firing empty
  requests.

## Testing

Jest, matching the existing `__tests__/` and `jest.config.js`.

- **`alpaca.ts`** (highest coverage — money/security path): mocked `fetch`;
  verify correct host per `env`, correct auth headers, request bodies for each
  order type, and status→error mapping.
- **`accounts.ts`**: add / edit / delete round-trips with `react-native-keychain`
  mocked; assert secrets never land in the plaintext metadata blob.
- **Order form validation**: pure validation function tested directly (required
  prices, positive qty, type/price consistency) — no UI rendering.
- **Screens**: light smoke render only; keep logic in testable pure functions.

## New dependencies

- `react-native-keychain` — encrypted secret storage (native, requires rebuild).
- `@react-navigation/drawer` (+ its peer deps, e.g. gesture-handler /
  reanimated as required) — top-level drawer navigation.

## Out of scope (MVP)

- Backend proxying of Alpaca (defeats the failsafe purpose).
- Auto-polling and WebSocket streaming.
- Market-data via Alpaca (quotes/history still come from the existing backend).
- Enforcing a single-paper-account rule.
- Multi-leg / bracket / OCO order classes beyond the listed types.
