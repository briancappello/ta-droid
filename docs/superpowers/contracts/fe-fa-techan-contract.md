# FE ↔ fa-techan Backend Contract

**Status:** Proposed — none of these endpoints exist in `fa-techan` yet.
**FE client:** `src/techan.ts`.
**BE work:** all four routes below must be added to `fa-techan` (`app/api/v1/…`).

> **Pending FE change (broker-first-class effort):** this contract reflects the
> agreed target. Two changes land with the broker-first-class implementation
> (`docs/superpowers/specs/2026-07-19-broker-first-class-design.md`), not yet in
> shipped code: (1) `/strategies/positions` gains `broker_id` and the join key
> becomes `(broker_id, account_id, symbol)`; (2) the previously-specified
> `POST /exits` endpoint and its `postExitSuppress` client are **removed** —
> exits are just Alpaca orders (see §6). Until that effort ships, `src/techan.ts`
> still contains `postExitSuppress`; treat it as deprecated.

This document is the single source of truth for the HTTP contract between the
mobile app (FE, this repo) and the `fa-techan` FastAPI service (BE). The FE
side is built to this contract; the BE must match it (or this document is
updated by mutual agreement before the BE diverges).

---

## 1. Governing principles

These are not style preferences — the FE is architected around them and will
behave incorrectly if the BE violates them.

1. **The backend is enrichment, never a dependency.** All position/order reads
   and writes go **device → broker (Alpaca) directly**. `fa-techan` supplies
   *strategy tags*, *watchlists*, and *health* — all optional read overlays.
   `fa-techan` is **never in the order/write path**: placing orders and going
   flat are Alpaca `createOrder` calls and tell the backend nothing. The app is
   fully usable (view positions/orders, place orders, flatten) with the backend
   completely down.

2. **The FE never throws on a backend failure.** Every client function resolves
   to a safe fallback (`[]` / `false`) on any non-2xx status, network error, or
   malformed body. A 500, a timeout, and a connection refusal are all treated
   identically: *enrichment unavailable*. The BE cannot cause an FE crash, and
   the FE will not retry aggressively or surface backend error text to the user.

3. **The only user-visible degraded-mode signal is the red "BE" chip.** No
   banners, no error copy, no toasts. If the BE is down, the chip goes red,
   strategies read `Unattributed`, and Watchlists shows "Watchlists
   unavailable." — nothing more.

4. **Secrets never cross this boundary.** The FE **must never** send broker API
   keys/secrets to `fa-techan`. None of the request shapes below contain
   credentials, and none may be added. Account identity is conveyed only by
   `(broker_id, account_id)`, where `account_id` is the **broker's own account
   number** (Alpaca `account_number`) — a stable, non-secret id known to both
   sides (see §6).

---

## 2. Base URL & versioning

- The FE reads the base URL from `Config.API_BASE_URL` (`react-native-config`),
  exposed as `API_BASE` in `src/api.ts`.
- `API_BASE` is assumed to **already include** any version prefix. Existing
  market-data calls hit `${API_BASE}/finance/quotes`, so if the router is
  mounted at `/api/v1`, then `API_BASE` = `https://host[:port]/api/v1`.
- **All paths in this document are appended to `API_BASE` verbatim.** E.g. the
  health path `/health` resolves to `${API_BASE}/health`
  (= `https://host/api/v1/health` under the assumption above).
- No custom auth headers are sent by the FE today (all four endpoints are GETs
  with no body). If the BE requires auth, that is a contract change to negotiate
  here first (see §6).

---

## 3. Conventions

- **Encoding:** JSON request and response bodies, UTF-8.
- **Wire casing:** `snake_case` field names on the wire (`broker_id`,
  `account_id`). The FE maps these to its internal camelCase.
- **Success:** any `2xx` is "ok". The FE inspects `res.ok` only — it does **not**
  distinguish 200 vs 201 vs 204.
- **Failure:** any non-2xx (or transport error) → FE fallback. Response *bodies*
  on error are ignored by the FE; return whatever is convenient.
- **Path params** are `encodeURIComponent`-escaped by the FE before sending
  (e.g. watchlist id).

---

## 4. Endpoints

### 4.1 `GET /health` — backend liveness (drives the BE chip)

Polled by the FE every **20 seconds** while the app is foregrounded
(`BackendProvider poll`), and on demand when the user taps refresh.

| | |
|---|---|
| Method / path | `GET ${API_BASE}/health` |
| Request body | none |
| Success | `2xx`, **any body** (body is ignored) |
| FE consumes | `res.ok` → boolean → BE chip: `up` (green) / `down` (red) |
| FE fallback | non-2xx or error → `down` (red chip) |
| FE fn | `pingHealth()` |

**BE notes:** keep this cheap and dependency-light — it is polled continuously.
It should reflect *the backend's own* ability to serve the data endpoints, not
the health of Alpaca or any upstream. A 200 with an empty body is fine.

---

### 4.2 `GET /strategies/positions` — position → strategy map

Fetched when Positions/Orders screens load. Used to tag each Alpaca
position/order row with the strategy that opened it.

| | |
|---|---|
| Method / path | `GET ${API_BASE}/strategies/positions` |
| Request body | none |
| Success body | `StrategyPosition[]` (see below) |
| FE consumes | joins rows to positions/orders by **`(broker_id, account_id, symbol)`** |
| FE fallback | `[]` → every row tagged `Unattributed` |
| FE fn | `fetchStrategyPositions()` → `loadTagger()` |

```jsonc
// StrategyPosition[]
[
  { "broker_id": "alpaca", "account_id": "PA3XXXXXXXX", "symbol": "AAPL", "strategy": "Momentum" },
  { "broker_id": "alpaca", "account_id": "PA3XXXXXXXX", "symbol": "NVDA", "strategy": "MeanRev" }
]
```

| Field | Type | Notes |
|---|---|---|
| `broker_id` | `string` | Broker identifier, e.g. `"alpaca"`. Part of the join key. |
| `account_id` | `string` | The **broker's** account number (Alpaca `account_number`) — see §6. |
| `symbol` | `string` | Broker symbol, exact case (`AAPL`). Join is case-sensitive. |
| `strategy` | `string` | Free-form label shown verbatim in the strategy filter. |

**Join semantics (FE side, `src/strategyTagger.ts`):** the FE builds a map
keyed `` `${broker_id}:${account_id}:${symbol}` ``. Any position/order whose
`(account.broker, account.id, symbol)` is **not** present in the response is
labeled `Unattributed`. So:
- Return one row per `(broker, account, symbol)` the backend has attribution for.
- Rows for symbols the user no longer holds are harmless (ignored).
- Missing rows are not an error — they degrade to `Unattributed`.
- `Unattributed` is a reserved FE label; avoid emitting it as a `strategy` value
  unless you specifically mean "no attribution" (it sorts last in the filter).

---

### 4.3 `GET /watchlists` — list of watchlists

Fetched on the Watchlists screen mount / refresh.

| | |
|---|---|
| Method / path | `GET ${API_BASE}/watchlists` |
| Request body | none |
| Success body | `Watchlist[]` |
| FE consumes | populates the single-select watchlist dropdown; **first item is auto-selected** |
| FE fallback | `[]` → screen shows "Watchlists unavailable." |
| FE fn | `fetchWatchlists()` |

```jsonc
// Watchlist[]
[
  { "id": "wl-breakouts", "name": "Breakouts" },
  { "id": "wl-oversold",  "name": "Oversold" }
]
```

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Opaque id; passed back verbatim to §4.4 (FE `encodeURIComponent`s it). |
| `name` | `string` | Display label shown in the dropdown. |

**BE notes:** order matters — the FE auto-selects `list[0]`. Return the default
/ most useful watchlist first. An empty array is a valid response (means "no
watchlists"), rendered identically to a backend-down state.

---

### 4.4 `GET /watchlists/{id}` — symbols in a watchlist

Fetched when a watchlist is selected. The FE then calls its *own* quote endpoint
(`GET ${API_BASE}/finance/quotes`) for the returned symbols — that quote call is
existing, not part of this contract.

| | |
|---|---|
| Method / path | `GET ${API_BASE}/watchlists/{id}` |
| Path param | `id` — a `Watchlist.id` from §4.3 (`encodeURIComponent`d by FE) |
| Request body | none |
| Success body | `{ symbol: string }[]` |
| FE consumes | maps to `symbol[]`, then fetches quotes for them |
| FE fallback | `[]` → empty watchlist (no rows) |
| FE fn | `fetchWatchlistSymbols(id)` |

```jsonc
// { symbol: string }[]
[{ "symbol": "SMCI" }, { "symbol": "TSLA" }]
```

**BE notes:** the FE extracts only `.symbol` from each row — extra fields are
ignored, so it's safe to return richer objects. An unknown `id` should return
`[]` (or any non-2xx); either degrades to an empty list, not an error.

---

### 4.5 (removed) — there is no exit endpoint

An earlier draft specified `POST /exits` (an "exit-suppression" signal). **It is
removed.** Going flat is just placing market-close orders via the broker
(Alpaca `createOrder`); to `fa-techan` an exit is not a distinct event and the
FE sends nothing. `fa-techan` stays read-only enrichment and is never in the
order/write path. The concern that endpoint gestured at — "don't let a strategy
act on this symbol" — is superseded by the deferred **strategy-override**
resource (§7).

---

## 5. Failure-mode matrix (FE behavior)

| Scenario | FE result |
|---|---|
| `/health` non-2xx / timeout | BE chip red; all other features keep working via Alpaca |
| `/strategies/positions` fails | every row `Unattributed`; strategy filter shows only `All` + `Unattributed` |
| `/watchlists` fails or `[]` | "Watchlists unavailable." |
| `/watchlists/{id}` fails | selected watchlist shows no rows |
| malformed JSON on any GET | treated as failure → the fallback above |

---

## 6. Open coordination questions (resolve before BE build)

1. **`account_id` — RESOLVED.** The join key is `(broker_id, account_id)` where
   `account_id` is the **broker's own account number** (Alpaca `account_number`)
   — stable, non-secret, and independently known to both sides. This lands with
   the broker-first-class effort
   (`docs/superpowers/specs/2026-07-19-broker-first-class-design.md`), which
   makes the broker account number the FE's primary key and rekeys the tagger to
   `` `${broker_id}:${account_id}:${symbol}` ``.

2. **Auth.** No auth header is sent today. If `fa-techan` needs to authenticate
   the device, specify the scheme (bearer token in `Config`? mTLS?) here; it's a
   contract change on both sides.

3. **`/health` semantics.** Confirm it reflects the backend's readiness to serve
   the data endpoints, and is cheap enough for 20s polling.

4. **Symbol normalization.** The `(broker_id, account_id, symbol)` join is case-
   and format-sensitive. Confirm both sides use the broker's canonical symbol
   form (e.g. equities `AAPL`; crypto pairs like `BTC/USD` if ever in scope).

---

## 7. Deferred: strategy-override resource (future, not built)

The removed `/exits` endpoint (§4.5) was really trying to solve a broader
concern: **"don't let the strategy engine act on this symbol."** That belongs to
a future **strategy-override** resource — its own design + contract, not part of
the current work:

- A per-**`(strategy, symbol, date)`** rule telling the strategy engine to **not
  act** on a symbol. Covers both "don't re-enter after a manual flatten" and
  "never enter this symbol today."
- **Date semantics: effective for a single calendar date** (day-scoped).
- It is `fa-techan` **config/enrichment** the strategy engine consults — NOT part
  of the broker order path, so the failsafe model still holds.
- Endpoints, verbs, and the FE client/UI are TBD in that future design. Recorded
  here so the concern is tracked, not lost.

---

## 8. Reference — FE client surface

All in `src/techan.ts`; consumed as noted. (`postExitSuppress` is removed by the
broker-first-class effort — see the pending-change note at the top.)

| FE function | Endpoint | Consumer |
|---|---|---|
| `pingHealth()` | `GET /health` | `BackendContext` (20s poll) → BE chip |
| `fetchStrategyPositions()` | `GET /strategies/positions` | `strategyTagger.loadTagger()` → Positions/Orders |
| `fetchWatchlists()` | `GET /watchlists` | `WatchlistsScreen` |
| `fetchWatchlistSymbols(id)` | `GET /watchlists/{id}` | `WatchlistsScreen` |
