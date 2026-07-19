# Strategy-Oriented Information Hierarchy — Design

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation plan

## Problem & Perspective

The app currently presents equities through a long-term-investor lens: a
"Portfolio" screen with Quotes / Holdings / Details tabs. That framing does not
fit the actual use case.

**Target perspective:** short-term **swing trading**, driven both by manual
discretionary entries (through this mobile app) and by external algorithmic
strategies running in the `fa-techan` backend. In this view:

- "Portfolio" and "Holdings" are not meaningful concepts.
- The atomic unit is a **position**.
- Positions are conceptually grouped by the **strategy** that opened them
  (an explicit algo strategy, or `Discretionary`).
- There is **one user and one pool of money.** Accounts and strategies are not
  containers — they are **informational scope filters** over the single unified
  book of positions and orders.

**Dual operational priority (unchanged, foundational):**

1. **Failsafe first.** The app talks **directly to the Alpaca Trading REST API**
   for all position/order management. It must keep working when the `fa-techan`
   backend is unavailable.
2. **Backend coordination is enrichment.** `fa-techan` provides a window into
   the algo engine (which strategy opened which position) and curated
   watchlists. These are nice-to-haves that **degrade silently** when the
   backend is down — they never block a failsafe action.

The sole user is the engineer building the system. The UI therefore favors
**minimal chrome and no explanatory copy** — no onboarding text, no
"curated by…" attributions, no helper banners. Signal, not hand-holding.

## Data Model: Scope Filters Over One Book

There is one unified book of open positions and one book of orders, both sourced
directly from Alpaca (per-account, aggregated in the app). Two **independent**
filter/grouping dimensions are layered on top:

- **Account** — the *structural grouping*. Positions/orders are always rendered
  in **account buckets**. Always available (comes from Alpaca).
- **Strategy** — a *filter* applied on top. Comes from `fa-techan` enrichment.
  When present, it narrows the visible set; **account buckets persist within the
  filtered set**. When absent (backend down, or a position the algo never
  tagged), those positions fall into an **`Unattributed`** bucket/value.

Strategy attribution is an overlay the backend supplies; it is never required
for the app to function. `Discretionary` is a first-class strategy value for
manually-entered positions.

### Strategy attribution source (open implementation question)

The design treats strategy as "data the app reads and displays." *Where* the
position→strategy mapping is authoritatively stored (backend-owned vs.
`client_order_id`-encoded vs. app-local) is deferred to the implementation plan.
The UI contract is fixed regardless: each position may carry an optional
strategy label; missing → `Unattributed`.

## Navigation Structure

Top-level drawer destinations:

```
Positions      ← home
Orders
Watchlists
──────────
Settings       ← Accounts nests under here
```

`Portfolio` and `Holdings` are removed. `Accounts` is demoted from a top-level
destination to a **subpage of Settings**.

### Global header (every screen)

A shared header component used across all screens:

```
[☰]  Title  ............  [● BE]  [↻]
```

- **☰** — opens the drawer.
- **Title** — screen name.
- **BE chip** — **always visible** live backend-connectivity indicator: a
  subdued pill labeled `BE` with a colored dot — **green = connected**,
  **red = disconnected**. Driven by a global backend-health signal.
  **Tapping the chip navigates to Settings → Backend.**
- **↻** — refresh (where applicable).

The BE chip is the *only* indication of failsafe/degraded mode. There is no
amber banner or explanatory text when the backend is down — the red dot is the
signal.

## Screens

### Positions (home)

The unified book. Layout:

```
[☰] Positions           [● BE] [↻]
Strategy: All ▾
─── IRA (live)        + $1,840 ───
AAPL   100 @ 189.20        +1,240
NVDA    30 @ 610.00          +600
─── Paper             − $310 ───
TSLA    20 @ 395.00          −310
```

- Positions grouped into **account buckets** (bucket header shows account name,
  paper/live, and rolled-up P/L).
- **Strategy dropdown** filters the set; buckets persist within the filter.
- Tapping any position row → **Chart** for that symbol.

#### Strategy dropdown (also reused on Orders)

- Single button `Strategy: <label> ▾`, reusing the existing `Modal`-overlay
  dropdown pattern (`FreqDropdown` in `ChartScreen`).
- **Multi-select** checkbox list. **Defaults to `All`** (nothing filtered).
- Top row **"All strategies"** = select-all / clear-all toggle.
- Options: each known strategy + `Discretionary` + `Unattributed`.
- Selecting every item ≡ `All`. **Deselecting everything falls back to `All`**
  (never show an empty book).
- **Collapsed button label:** name if exactly one selected
  (`Strategy: Momentum`); count if two or more (`Strategy: 2 strategies`);
  `Strategy: All` when all/none.

### Orders

Working + recent orders, same unified-book treatment as Positions:

- Grouped into **account buckets**.
- Same **Strategy dropdown** scope filter.
- Rows show side/qty/type/price and status (working / filled / etc.).
- Tapping an order's symbol → **Chart** (consistent with "symbol tap → chart").

### Watchlists

Server-curated lists from `fa-techan` (not user-created). Read-only.

- **Single-select dropdown** to choose the active list. Reuses the dropdown
  pattern but is **single-select with no `All`** — exactly one list active at a
  time; the first list is selected by default.
- Rows show symbol + quote/change. Tapping a symbol → **Chart**.
- **Backend-dependent.** When BE is down, Watchlists shows a plain unavailable
  state (no data to show; the red BE chip explains why — no extra copy).

### Settings

```
[☰] Settings            [● BE]
Accounts            2 linked   ›
Backend         host·port·auth ›
Default account         IRA    ›
Appearance                     ›
About                          ›
```

- **Accounts** — subpage; the existing add/edit/delete account management
  (unchanged behavior, re-parented under Settings).
- **Backend** — host / port / auth configuration for `fa-techan`. This is the
  *config*; live connectivity is the header BE chip. The BE chip taps here.
- Other rows (default account, appearance, about) are minor.

### Chart

Reached by **tapping any symbol anywhere** in the app (Positions, Orders,
Watchlists). Layout:

```
[‹] AAPL      [● BE]  [Exit] [Trade]
IRA · 100 @ 189.20  +1,240
Paper · 20 @ 190.10   −15
[══════ price chart ══════]
```

- **Positions strip** (per-account pills for this symbol) sits **between the
  header and the chart**. Shown only when the symbol has open position(s).
- Header always has a **Trade** button → Order Entry (confirmation flow).
- Header has an **Exit** button **only when the symbol has an open position**.
  Its absence is the "no position" signal — no explanatory text.

### Order actions → confirmation page (Trade and Exit)

**All order actions go through a confirmation page** (not an inline sheet).

**Trade** (→ Order Entry → confirmation): the existing create/modify order flow,
ending on a confirmation page listing the resulting order(s) per account, each
row editable, then Submit.

**Exit — flatten across accounts:**

- Opens an **Exit confirmation page** titled "Go flat — N accounts".
- One **editable row per account** holding the symbol. Each row **defaults to a
  market order** for the full position quantity in that account.
- Tapping a row expands it to customize that account's order: type
  (Market / Limit / Stop), quantity, price.
- Confirm ("Exit all") fires the orders.

#### Exit execution semantics (best-effort notify, flatten never blocks)

The Exit does two things with **different reliability requirements**:

1. **Flatten via Alpaca** — the per-account orders are fired **directly to
   Alpaca, independently**. This is failsafe-critical and **must run regardless
   of backend state.** Its success/failure is reported on its own.
2. **Suppress signal to `fa-techan`** — a **fire-and-forget** POST telling the
   algo engine *"exited XYZ, don't re-enter."* This is best-effort:
   - It never blocks or gates the flatten.
   - If the backend is down, it is **skipped silently** (you are already flat;
     re-entry suppression simply is not active until the backend returns).
   - The **only trace** of a skipped/failed suppress is a small ⚠ marker on the
     chart's position badge (e.g. "suppress didn't reach backend"). No retry
     queue, no Settings ledger — consistent with the minimal-chrome, single-user
     principle.

## Failsafe Behavior Summary

| Concern | Backend up | Backend down (red BE) |
|---|---|---|
| Positions / Orders (Alpaca) | Live | **Live** (unchanged) |
| Trade / Exit order execution | Direct to Alpaca | **Direct to Alpaca** (unchanged) |
| Strategy attribution / filter | Shown | Silently → `Unattributed`; filter still usable |
| Watchlists | Shown | Unavailable (red BE chip is the explanation) |
| Exit "don't re-enter" suppress | Sent | Skipped; ⚠ on chart badge |

## Reused / Existing Patterns

- **Dropdown**: `Modal`-overlay pattern from `ChartScreen`'s `FreqDropdown`
  (strategy multi-select, watchlist single-select).
- **Account buckets / rows**: `PortfolioScreen`'s `StockRow` + section styling.
- **Dark palette:** `#1a1a2e` bg / `#16213e` panel / `#2196f3` accent /
  `#4caf50` up / `#f44336` down (unchanged).
- **Drawer + global header**: extend the existing drawer nav; introduce a shared
  header component carrying the BE chip.
- **Order Entry / confirmation**: extend the existing `OrderEntryScreen` and its
  review step; the Exit confirmation is a multi-account variant of the same
  confirmation page.

## Out of Scope / Deferred

- **Authoritative strategy-mapping storage** (backend vs. client_order_id vs.
  app-local) — decided in the implementation plan; UI contract is fixed here.
- **Strategy-level overview screen** (rolled-up P/L per strategy) — considered
  (nav option D) but not adopted now; can be added later without disturbing this
  hierarchy.
- Pull-to-refresh on lists (existing `ponytail` deferral) — unchanged.
- The specific `fa-techan` API shapes for strategy tags, watchlists, and the
  suppress endpoint — to be defined during planning.
