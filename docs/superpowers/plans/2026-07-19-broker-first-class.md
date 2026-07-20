# Broker as a First-Class Concept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **broker** a first-class object the app is built around, key accounts by the broker's own account id (Alpaca `account_number`), route all broker I/O through a pluggable driver interface, move account config to build time with passphrase-encrypted credentials provisioned into the Keystore, and remove the mis-modeled exit-suppress backend call.

**Architecture:** A `Broker` object owns its accounts, host config, and a `BrokerClient` driver. The hand-rolled Alpaca `fetch` client becomes the first driver (audited against — but not depending on — the official `@alpacahq/alpaca-trade-api` SDK), with full-fidelity `Position`/`Order`/`NewOrderRequest` types. Consumers resolve a driver via `driverFor(account)`. Accounts are authored at build time (non-secret) with credentials shipped as a libsodium-encrypted blob and provisioned into the Android Keystore on first launch / when the credentials fingerprint changes. `fa-techan` stays read-only enrichment; exits are just Alpaca orders.

**Tech Stack:** React Native 0.84, TypeScript, Hermes, `fetch`, Jest (`preset: react-native`), `react-native-keychain@^10`, `react-native-config@^1.6`, `react-native-libsodium` (new), `@react-navigation/*`.

**Design spec:** `docs/superpowers/specs/2026-07-19-broker-first-class-design.md`. Read it before starting.

## Global Constraints

- **Failsafe first.** All position/order reads and writes go **device → broker (Alpaca) directly** through the driver. They MUST work when the `fa-techan` backend is down. Never gate a broker action on backend availability. `fa-techan` is **read-only enrichment** (health, strategies, watchlists) and is **never in the order/write path**.
- **Secrets never in plaintext.** Broker key/secret live only in `react-native-keychain` at rest, and (build-time) in a **libsodium-encrypted** blob (ciphertext + salt + nonce) — never in git, never in plaintext in the APK, never in `AsyncStorage`, logs, or metadata. In `catch` blocks log only `e.message` / `AlpacaError.status` — never the `Account`, credentials, request `init`, or headers.
- **Broker owns paper/live.** `env: 'paper' | 'live'` is removed from the shared model. Paper/live is `account.is_paper` (boolean), consumed inside the driver for host + credential routing. The UI surfaces it as a **"paper" badge when `is_paper === true`; live shows no badge** (unflagged default).
- **Primary key = broker account id.** `Account.id` is the broker's own account number (Alpaca `account_number`), which is also the fa-techan join key. Join key is `(broker_id, account_id, symbol)`; the tagger keys on `` `${broker}:${account.id}:${symbol}` ``.
- **SDK is a reference, not a dependency.** Do NOT install `@alpacahq/alpaca-trade-api`. The Alpaca driver is hand-rolled `fetch`; its API contract (endpoints, params, payload shapes) is audited against the SDK's Alpaca models, and it implements standard REST hygiene (redirect-guard, per-request timeout, idempotent-only retry, `clientOrderId` on orders, never replay order POSTs).
- **Alpaca wire shape.** Alpaca returns numerics as **strings** (`qty`, `avg_entry_price`, `limit_price`, etc.). Types model this: numeric fields are `string` (nullable → `string | null`), timestamps `string | null`, enums as string-literal unions.
- **Alpaca hosts:** paper → `https://paper-api.alpaca.markets`, live → `https://api.alpaca.markets`. Trading API v2. Auth headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`.
- **fa-techan base URL:** `Config.API_BASE_URL` via `src/api.ts` (`API_BASE`). Market data (quotes/history) continues to use this backend.
- **Style conventions (match existing code):** functional components, inline `StyleSheet.create`, dark palette `#1a1a2e` (bg) / `#16213e` (panel) / `#2196f3` (accent) / `#4caf50` (up) / `#f44336` (down). Prettier: single quotes, trailing commas, 2-space indent.
- **Node:** >= 22.11.0. Tests: `npx jest`. Lint: `npx eslint .` (0 errors; pre-existing inline-style / no-bitwise / no-shadow warnings acceptable — do not add new errors).
- **React 19 test caveat:** a render-time throw is NOT rethrown from `ReactTestRenderer.create()`; assert render throws via an error-boundary that captures through `componentDidCatch` (see `__tests__/backendContext.test.tsx`).
- **Commit discipline:** stage only the files a task names (`git add <paths>`), never `git add -A` — the working tree carries unrelated uncommitted files.

## Phase Overview

Three sequenced phases; each ends with the app compiling, tested, and runnable.

- **Phase A — Broker model + types + driver (Tasks A1–A3):** `src/broker.ts` (registry, driver interface, full-fidelity types), the reshaped `Account`, and the Alpaca `fetch` client refactored into `alpacaDriver` with SDK-audited hygiene. Old `alpaca.ts` named exports remain as thin wrappers so consumers keep compiling until Phase B.
- **Phase B — Consumer repoint + suppress removal + rekey (Tasks B1–B6):** route `flatten.ts` and every screen through `driverFor`; remove `postExitSuppress` / the `finishExit` suppress seam; swap `env` UI for the `is_paper` badge; rekey the strategy tagger to `(broker, account, symbol)`; update the contract doc; delete the old `alpaca.ts` wrappers.
- **Phase C — Build-time config + encrypted secrets + provisioning (Tasks C1–C6):** the build-side libsodium encrypt script, `src/provisioning.ts` (fingerprint compare + decrypt→Keystore), `accounts.ts` build-time config load, the `AccountContext` provisioning gate, read-only `AccountsScreen`, and full-suite verification.

## File Structure

**New files:**
- `src/broker.ts` — `BrokerId`, `Broker`, `BrokerClient`, `OrderFilter`, `OrderStatus`, the registry + `driverFor`, and full-fidelity `Position`/`Order`/`NewOrderRequest` types + enums.
- `src/provisioning.ts` — pure fingerprint-compare (`provisioningAction`) + the decrypt→Keystore effect (`runProvisioning`).
- `scripts/encrypt-credentials.mjs` — build-side Node script: reads local plaintext creds + passphrase → libsodium Argon2id + secretbox → emits ciphertext/salt/nonce + fingerprint.
- `__tests__/broker.test.ts`, `__tests__/alpacaDriver.test.ts`, `__tests__/provisioning.test.ts` — new suites.

**Modified files:**
- `src/alpaca.ts` — becomes the Alpaca driver (`alpacaDriver: BrokerClient`) + `AlpacaError`; `env`/`alpacaBaseUrl(env)` reworked; SDK-audited hygiene. Phase B deletes its transitional named-export wrappers.
- `src/accounts.ts` — build-time config load (Phase C); drops runtime add/edit/delete + on-device `newId()`.
- `src/AccountContext.tsx` — `Account` import from `broker.ts`; provisioning gate (Phase C).
- `src/flatten.ts` — driver via `driverFor`; `finishExit` suppress seam removed.
- `src/techan.ts` — `postExitSuppress` removed.
- `src/strategyTagger.ts` — join key rekeyed to `(broker, account, symbol)`.
- `src/screens/{PositionsScreen,OrdersScreen,OrderEntryScreen,ChartScreen,ExitScreen,AccountsScreen}.tsx` — driver repoint, `is_paper` badge, suppress-wiring removal, read-only accounts.
- `src/components/AccountPicker.tsx` — `is_paper` label, `Account` import from `broker.ts`.
- `docs/superpowers/contracts/fe-fa-techan-contract.md` — already reflects the target; verify/adjust with the rekey.
- Test fixtures across `__tests__/*` — accounts gain `broker`/`is_paper`, drop `env`; `../alpaca` fn mocks repoint to the driver.

---

## Phase A — Broker model + types + driver

### Task A1: `src/broker.ts` — driver interface, registry, full-fidelity payload types

**Files:**
- Create: `src/broker.ts`
- Test: `__tests__/broker.test.ts`

**Interfaces:**
- Consumes: `Account` (defined in Task A2, but A1 only needs a forward reference — see note). To avoid a circular dependency, `broker.ts` defines `Account` itself is NOT here; `Account` lives in `src/alpaca.ts` (Task A2) and `broker.ts` imports the `Account` type from `./alpaca`. `alpaca.ts` imports `BrokerClient`/payload types from `./broker`. This is a type-only cycle (safe in TS).
- Produces (all exported):
  - `type BrokerId = 'alpaca'`
  - Enums (string-literal unions): `OrderSide`, `OrderType`, `TimeInForce`, `OrderClass`, `PositionIntent`, `OrderStatus`, `AssetClass`, `PositionSide`
  - `interface Position`, `interface Order`, `interface OrderLeg`, `interface NewOrderRequest` (+ `TakeProfit`, `StopLoss`)
  - `type OrderQueryStatus = 'open' | 'closed' | 'all'`, `interface OrderFilter`
  - `interface BrokerClient`
  - `interface Broker`
  - `const brokers: Record<BrokerId, Broker>`
  - `function driverFor(account: Account): BrokerClient`

**Note on the type cycle:** `broker.ts` needs `Account` (for `BrokerClient` method signatures) and `alpaca.ts` needs `BrokerClient`/`Position`/`Order`/`NewOrderRequest`. Use `import type` in both directions — TypeScript erases type-only imports so there is no runtime cycle. `broker.ts`: `import type { Account } from './alpaca';`. `alpaca.ts`: `import type { BrokerClient, Position, Order, NewOrderRequest, OrderFilter } from './broker';`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/broker.test.ts
import { driverFor, brokers } from '../src/broker';
import type { Account } from '../src/alpaca';

const paperAcct: Account = {
  id: 'PA123', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S',
};

test('brokers registry has an alpaca entry with hosts', () => {
  expect(brokers.alpaca).toBeDefined();
  expect(brokers.alpaca.id).toBe('alpaca');
  expect(brokers.alpaca.hosts.paper).toBe('https://paper-api.alpaca.markets');
  expect(brokers.alpaca.hosts.live).toBe('https://api.alpaca.markets');
});

test('driverFor resolves the account broker driver', () => {
  const driver = driverFor(paperAcct);
  expect(driver).toBe(brokers.alpaca.driver);
  expect(typeof driver.listPositions).toBe('function');
  expect(typeof driver.listOrders).toBe('function');
  expect(typeof driver.createOrder).toBe('function');
  expect(typeof driver.closePosition).toBe('function');
});

test('driverFor throws for an unknown broker', () => {
  const bad = { ...paperAcct, broker: 'nope' } as unknown as Account;
  expect(() => driverFor(bad)).toThrow(/unknown broker/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest broker.test.ts`
Expected: FAIL — cannot find module `../src/broker` (and `../src/alpaca` `Account` shape from Task A2 not yet updated; if A2 is not done, temporarily inline the `Account` type in the test — but A2 lands first in execution order, so prefer running A2 then A1's test. See execution note below).

> **Execution note:** A1 and A2 are mutually type-dependent. Implement A2's `Account` reshape and A1's `broker.ts` together (they compile as a pair), then run both tests. Commit A1's `broker.ts` first if you prefer smaller commits, but the suite only goes green once both exist. The driver *implementation* (`brokers.alpaca.driver`) comes from Task A3; for A1, register a **placeholder driver** whose four methods are present but throw `new Error('alpaca driver not wired')` — Task A3 replaces it. The A1 test only checks the methods exist (`typeof … === 'function'`), not that they work.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/broker.ts
import type { Account } from './alpaca';

export type BrokerId = 'alpaca';

// --- Enums (Alpaca wire values) ---
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type TimeInForce = 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
export type OrderClass = 'simple' | 'bracket' | 'oco' | 'oto' | 'mleg' | '';
export type PositionIntent =
  | 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
export type OrderStatus =
  | 'new' | 'partially_filled' | 'filled' | 'done_for_day' | 'canceled'
  | 'expired' | 'replaced' | 'pending_cancel' | 'pending_replace' | 'accepted'
  | 'pending_new' | 'accepted_for_bidding' | 'stopped' | 'rejected'
  | 'suspended' | 'calculated' | 'held';
export type AssetClass =
  | 'us_equity' | 'us_option' | 'crypto' | 'crypto_perp' | 'treasury'
  | 'corporate' | 'global_equity' | 'us_index' | 'us_equity_chain' | 'ipo' | '';
export type PositionSide = 'long' | 'short';

// --- Position (GET /v2/positions element); Alpaca numerics are strings ---
export interface Position {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: AssetClass;
  avg_entry_price: string;
  qty: string;
  qty_available?: string;
  side: PositionSide;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
  asset_marginable: boolean;
}

// --- Order (GET /v2/orders element / POST /v2/orders response) ---
export interface OrderLeg {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string | null;
  submitted_at: string | null;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  replaces: string | null;
  asset_id: string;
  symbol: string;
  asset_class: AssetClass;
  notional: string | null;
  qty: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: OrderClass;
  type: OrderType;
  side: OrderSide;
  position_intent: PositionIntent;
  time_in_force: TimeInForce;
  limit_price: string | null;
  stop_price: string | null;
  status: OrderStatus;
  extended_hours: boolean;
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
  ratio_qty: string | null;
}

export interface Order extends OrderLeg {
  expires_at: string;
  legs: OrderLeg[] | null;
  // `order_type` is Alpaca's deprecated alias of `type`; keep for fidelity.
  order_type: string;
}

// --- Order-placement request (POST /v2/orders body) ---
export interface TakeProfit {
  limit_price: string;
}
export interface StopLoss {
  stop_price: string;
  limit_price?: string;
}
export interface NewOrderRequest {
  type: OrderType;
  time_in_force: TimeInForce;
  symbol?: string;
  side?: OrderSide;
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  trail_price?: string;
  trail_percent?: string;
  extended_hours?: boolean;
  client_order_id?: string;
  order_class?: OrderClass;
  position_intent?: PositionIntent;
  take_profit?: TakeProfit;
  stop_loss?: StopLoss;
}

// --- listOrders filter (maps to GET /v2/orders query params) ---
export type OrderQueryStatus = 'open' | 'closed' | 'all';
export interface OrderFilter {
  status?: OrderQueryStatus; // default 'open'
  after?: string; // ISO 8601
  until?: string; // ISO 8601
  limit?: number;
  direction?: 'asc' | 'desc';
}

// --- Driver interface ---
export interface BrokerClient {
  listPositions(account: Account): Promise<Position[]>;
  listOrders(account: Account, filter?: OrderFilter): Promise<Order[]>;
  createOrder(account: Account, req: NewOrderRequest): Promise<Order>;
  closePosition(account: Account, symbol: string): Promise<void>;
}

// --- Broker (owns accounts, hosts, driver) ---
export interface Broker {
  id: BrokerId;
  name: string;
  hosts: { paper: string; live: string };
  driver: BrokerClient;
}

// Placeholder driver — Task A3 replaces this with the real Alpaca fetch driver.
// ponytail: intentional stub so A1 lands before A3; throws if called.
const notWired = (): never => {
  throw new Error('alpaca driver not wired');
};
const placeholderDriver: BrokerClient = {
  listPositions: notWired,
  listOrders: notWired,
  createOrder: notWired,
  closePosition: notWired,
};

export const brokers: Record<BrokerId, Broker> = {
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    hosts: {
      paper: 'https://paper-api.alpaca.markets',
      live: 'https://api.alpaca.markets',
    },
    driver: placeholderDriver,
  },
};

export function driverFor(account: Account): BrokerClient {
  const broker = brokers[account.broker];
  if (!broker) {
    throw new Error(`unknown broker: ${account.broker}`);
  }
  return broker.driver;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest broker.test.ts` (after Task A2's `Account` reshape exists)
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/broker.ts __tests__/broker.test.ts
git commit -m "feat: add broker layer — driver interface, registry, full-fidelity types"
```

---

### Task A2: Reshape `Account` — `broker` + `is_paper`, drop `env`

**Files:**
- Modify: `src/alpaca.ts:1-10` (the `AlpacaEnv` + `Account` definitions)
- Test: covered by `__tests__/broker.test.ts` (A1) + the existing `__tests__/alpaca.test.ts` once its fixtures are updated (this task updates that fixture).

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type Account = { id: string; name: string; broker: BrokerId; is_paper: boolean; key: string; secret: string }`
  - REMOVES `export type AlpacaEnv` and `env` from `Account`.

**Design notes:**
- `id` is now the broker's account number (Alpaca `account_number`) — a doc comment says so; no runtime change to the field type.
- `key`/`secret` remain on `Account` for now (Phase C moves their *source* to Keystore-provisioned config, but the in-memory `Account` still carries them for the driver). The driver reads `account.is_paper` to pick host + (later) keychain-resolved creds.
- Import `BrokerId` as a type: `import type { BrokerId } from './broker';`.

- [ ] **Step 1: Update the `Account` type + remove `AlpacaEnv`**

Replace `src/alpaca.ts` lines 1-10 (the current `AlpacaEnv`/`Account`):

```ts
// src/alpaca.ts
import type { BrokerId } from './broker';

export type Account = {
  id: string; // the broker's account number (Alpaca account_number); primary key + fa-techan join key
  name: string;
  broker: BrokerId;
  is_paper: boolean;
  key: string;
  secret: string;
};
```

- [ ] **Step 2: Update `alpaca.test.ts` fixture + host expectation**

In `__tests__/alpaca.test.ts`, the account fixture currently uses `env: 'paper'`/`'live'`. Change every account literal from `env: 'paper'` → `is_paper: true, broker: 'alpaca'` and `env: 'live'` → `is_paper: false, broker: 'alpaca'`. Any assertion that referenced `alpacaBaseUrl(account.env)` or a host derived from `env` is updated in Task A3 (host now from `is_paper`); for A2, only fix the fixtures so the file typechecks. If a test directly imports `AlpacaEnv`, remove that import.

- [ ] **Step 3: Run the affected tests**

Run: `npx jest alpaca.test.ts broker.test.ts`
Expected: `broker.test.ts` PASS; `alpaca.test.ts` — passes except any test asserting env-based host behavior, which Task A3 finalizes. If a host test fails here, mark it and finish it in A3 (note in the commit). Prefer implementing A2 + A3 back-to-back.

- [ ] **Step 4: Typecheck the consumers compile**

Run: `npx tsc --noEmit 2>&1 | grep -v "Cannot find name 'global'" | grep "error" | head`
Expected: consumers referencing `account.env` (`PositionsScreen`, `OrdersScreen`, `AccountsScreen`, `AccountPicker`, `accounts.ts`) will show type errors — these are EXPECTED and fixed in Phase B. Note them; do not fix here. (The pre-existing `global` errors in test files are filtered out above.)

- [ ] **Step 5: Commit**

```bash
git add src/alpaca.ts __tests__/alpaca.test.ts
git commit -m "feat: reshape Account — broker + is_paper, drop env/AlpacaEnv"
```

---

### Task A3: Alpaca driver — `alpacaDriver: BrokerClient` with SDK-audited hygiene

**Files:**
- Modify: `src/alpaca.ts` (the request core + exported functions)
- Test: `__tests__/alpacaDriver.test.ts` (new)

**Interfaces:**
- Consumes (Task A1): `BrokerClient`, `Position`, `Order`, `NewOrderRequest`, `OrderFilter`, `brokers`.
- Produces:
  - `export const alpacaDriver: BrokerClient`
  - Transitional named exports (thin wrappers over the driver, deleted in Task B6) so existing consumers compile through Phase A: `listPositions`, `listOrders`, `createOrder`, `closePosition`, `replaceOrder`, `cancelOrder`.
  - `AlpacaError` stays exported.
- Wires `brokers.alpaca.driver = alpacaDriver` (replace the A1 placeholder). Do this by constructing `alpacaDriver` in `alpaca.ts` and assigning it, OR (cleaner) export `alpacaDriver` from `alpaca.ts` and set the registry entry in `broker.ts` — but that reintroduces a runtime cycle. **Chosen approach:** `alpaca.ts` imports the `brokers` object and does `brokers.alpaca.driver = alpacaDriver;` at module load (runtime value import of `brokers` from `broker.ts`; `broker.ts`'s import of `Account` from `alpaca.ts` is type-only, so the runtime cycle is one-directional and safe — `broker.ts` fully initializes `brokers` before `alpaca.ts` mutates it).

**Audit-adopted hygiene (spec §2.6 Tier 2):**
1. **Redirect guard:** pass `redirect: 'error'` to `fetch` so a 3xx never follows off-host with `APCA-API-*` headers.
2. **Per-request timeout:** wrap each request in an `AbortController` with a 30000ms deadline; on abort throw `new AlpacaError(0, "Alpaca request timed out.")`.
3. **`clientOrderId`:** `createOrder` sets `client_order_id` if the caller didn't, using a stable unique value (`` `ta-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` ``). Never auto-retry the POST.
4. **No retry on writes:** the client does not retry at all today — keep it that way. (Idempotent-GET retry is optional and NOT required by this plan; do not add it.)

**Contract (Tier 1):** `listOrders(account, filter)` maps to `GET /v2/orders` with query params `status` (default `open`), `after`, `until`, `limit`, `direction`. `closePosition` → `DELETE /v2/positions/{symbol}`. Host from `brokers.alpaca.hosts[account.is_paper ? 'paper' : 'live']`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/alpacaDriver.test.ts
import { alpacaDriver, AlpacaError } from '../src/alpaca';
import type { Account } from '../src/alpaca';

const acct: Account = {
  id: 'PA1', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S',
};
const live: Account = { ...acct, id: 'A1', name: 'Live', is_paper: false };

afterEach(() => jest.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
  } as Response);
}

test('listPositions GETs /v2/positions on the paper host', async () => {
  const spy = mockFetch(200, [{ symbol: 'AAPL', qty: '10' }]);
  await alpacaDriver.listPositions(acct);
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('https://paper-api.alpaca.markets/v2/positions');
  expect(init?.method).toBe('GET');
  expect((init?.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('K');
  expect(init?.redirect).toBe('error');
});

test('live account uses the live host', async () => {
  const spy = mockFetch(200, []);
  await alpacaDriver.listPositions(live);
  expect(spy.mock.calls[0][0]).toBe('https://api.alpaca.markets/v2/positions');
});

test('listOrders maps the filter to query params (default open)', async () => {
  const spy = mockFetch(200, []);
  await alpacaDriver.listOrders(acct);
  expect(spy.mock.calls[0][0]).toBe(
    'https://paper-api.alpaca.markets/v2/orders?status=open',
  );
  spy.mockClear();
  await alpacaDriver.listOrders(acct, { status: 'closed', limit: 5, after: '2026-01-01' });
  const url = String(spy.mock.calls[0][0]);
  expect(url).toContain('status=closed');
  expect(url).toContain('limit=5');
  expect(url).toContain('after=2026-01-01');
});

test('createOrder POSTs with an auto client_order_id and is not retried', async () => {
  const spy = mockFetch(200, { id: 'o1' });
  await alpacaDriver.createOrder(acct, {
    symbol: 'AAPL', side: 'buy', type: 'market', time_in_force: 'day', qty: '1',
  });
  expect(spy).toHaveBeenCalledTimes(1);
  const [, init] = spy.mock.calls[0];
  expect(init?.method).toBe('POST');
  const body = JSON.parse(String(init?.body));
  expect(body.client_order_id).toMatch(/^ta-/);
});

test('closePosition DELETEs the symbol', async () => {
  const spy = mockFetch(204, null);
  await alpacaDriver.closePosition(acct, 'AAPL');
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('https://paper-api.alpaca.markets/v2/positions/AAPL');
  expect(init?.method).toBe('DELETE');
});

test('non-ok response throws AlpacaError with status', async () => {
  mockFetch(422, { message: 'bad' });
  await expect(alpacaDriver.listPositions(acct)).rejects.toBeInstanceOf(AlpacaError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest alpacaDriver.test.ts`
Expected: FAIL — `alpacaDriver` not exported yet.

- [ ] **Step 3: Refactor `src/alpaca.ts`**

Keep `AlpacaError` and `messageForStatus` as-is. Replace `alpacaBaseUrl(env)` with a host resolver from the registry + `is_paper`, rewrite `alpacaRequest` to take an `Account` and add the redirect guard + timeout, build `alpacaDriver`, wire the registry, and keep transitional wrappers. Full new module body below (preserve the existing `AlpacaError`/`messageForStatus`/`alpacaHeaders`, shown for completeness):

```ts
// src/alpaca.ts
import type { BrokerId } from './broker';
import {
  brokers,
  type BrokerClient,
  type Order,
  type OrderFilter,
  type NewOrderRequest,
  type Position,
} from './broker';

export type Account = {
  id: string; // broker's account number (Alpaca account_number); primary key + fa-techan join key
  name: string;
  broker: BrokerId;
  is_paper: boolean;
  key: string;
  secret: string;
};

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AlpacaError';
    this.status = status;
  }
}

function hostFor(account: Account): string {
  const broker = brokers[account.broker];
  return account.is_paper ? broker.hosts.paper : broker.hosts.live;
}

export function alpacaHeaders(account: Account): Record<string, string> {
  return {
    'APCA-API-KEY-ID': account.key,
    'APCA-API-SECRET-KEY': account.secret,
    'Content-Type': 'application/json',
  };
}

function messageForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return 'Check the API keys for this account.';
  }
  if (status === 429) {
    return 'Rate limited by Alpaca, retry shortly.';
  }
  if (status === 422) {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) {
        return String(parsed.message);
      }
    } catch {}
    return 'Alpaca rejected the request (validation error).';
  }
  return `Alpaca error (${status}).`;
}

const TIMEOUT_MS = 30000;

async function alpacaRequest<T>(
  account: Account,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  // ponytail: path callers must encodeURIComponent any dynamic segment.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${hostFor(account)}${path}`, {
      method: init.method,
      headers: alpacaHeaders(account),
      body: init.body != null ? JSON.stringify(init.body) : undefined,
      redirect: 'error', // never follow a 3xx off-host with the secret headers
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AlpacaError(0, 'Alpaca request timed out.');
    }
    throw new AlpacaError(0, "Can't reach Alpaca — check your connection.");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AlpacaError(response.status, messageForStatus(response.status, text));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function newClientOrderId(): string {
  return `ta-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ordersQuery(filter?: OrderFilter): string {
  const params = new URLSearchParams();
  params.set('status', filter?.status ?? 'open');
  if (filter?.after) {
    params.set('after', filter.after);
  }
  if (filter?.until) {
    params.set('until', filter.until);
  }
  if (filter?.limit != null) {
    params.set('limit', String(filter.limit));
  }
  if (filter?.direction) {
    params.set('direction', filter.direction);
  }
  return params.toString();
}

export const alpacaDriver: BrokerClient = {
  listPositions(account) {
    return alpacaRequest<Position[]>(account, '/v2/positions');
  },
  listOrders(account, filter) {
    return alpacaRequest<Order[]>(account, `/v2/orders?${ordersQuery(filter)}`);
  },
  createOrder(account, req) {
    // Never auto-retried; stable client_order_id for auditability.
    const body: NewOrderRequest = {
      ...req,
      client_order_id: req.client_order_id ?? newClientOrderId(),
    };
    return alpacaRequest<Order>(account, '/v2/orders', { method: 'POST', body });
  },
  async closePosition(account, symbol) {
    await alpacaRequest<void>(
      account,
      `/v2/positions/${encodeURIComponent(symbol)}`,
      { method: 'DELETE' },
    );
  },
};

// Wire the registry (broker.ts fully initialized `brokers` before this runs).
brokers.alpaca.driver = alpacaDriver;

// --- Transitional named exports (deleted in Task B6). Keep consumers compiling. ---
export const listPositions = alpacaDriver.listPositions;
export const listOrders = alpacaDriver.listOrders;
export const createOrder = alpacaDriver.createOrder;
export const closePosition = alpacaDriver.closePosition;

// listOpenOrders shim: old consumers call it with no filter → open orders.
export function listOpenOrders(account: Account): Promise<Order[]> {
  return alpacaDriver.listOrders(account, { status: 'open' });
}

// replaceOrder / cancelOrder retained for OrderEntryScreen until Phase B.
export type ReplaceOrderRequest = {
  qty?: string;
  time_in_force?: TimeInForce;
  limit_price?: string;
  stop_price?: string;
  trail?: string;
};
export async function replaceOrder(
  account: Account,
  id: string,
  req: ReplaceOrderRequest,
): Promise<Order> {
  return alpacaRequest<Order>(account, `/v2/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: req,
  });
}
export async function cancelOrder(account: Account, id: string): Promise<void> {
  await alpacaRequest<void>(account, `/v2/orders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
```

Add the missing type import for `ReplaceOrderRequest`: `import type { TimeInForce } from './broker';` (merge into the existing `broker` type import).

> **Note on removed old types:** the old `AlpacaPosition`/`AlpacaOrder`/`OrderSide`/`OrderType`/`TimeInForce` etc. that used to live in `alpaca.ts` are now in `broker.ts`. Consumers still importing `AlpacaPosition`/`AlpacaOrder`/`OrderType` from `../alpaca` (e.g. `flatten.ts`, `ExitScreen`, `book.ts` via `Tagged<AlpacaPosition>`) are repointed in Phase B. To keep them compiling through Phase A, add transitional type re-exports at the end of `alpaca.ts`: `export type { Position as AlpacaPosition, Order as AlpacaOrder, OrderType, OrderSide, TimeInForce, NewOrderRequest } from './broker';`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest alpacaDriver.test.ts alpaca.test.ts broker.test.ts`
Expected: PASS. If `alpaca.test.ts` had an env-host test, it now asserts the `is_paper` host — update its expectation to the paper/live host string.

- [ ] **Step 5: Full suite + lint (Phase A gate)**

Run: `npx jest && npx eslint src/alpaca.ts src/broker.ts`
Expected: All suites PASS (consumers still compile via transitional wrappers/re-exports); lint 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/alpaca.ts __tests__/alpacaDriver.test.ts __tests__/alpaca.test.ts
git commit -m "feat: Alpaca driver with redirect-guard, timeout, clientOrderId; wire registry"
```

**Phase A complete.** Broker layer + full-fidelity types + audited Alpaca driver exist; app compiles and all tests pass via transitional shims. Verify before Phase B.

---

## Phase B — Consumer repoint + suppress removal + rekey

### Task B1: `flatten.ts` — driver via `driverFor`; remove `finishExit` suppress seam

**Files:**
- Modify: `src/flatten.ts`
- Test: `__tests__/flatten.test.ts`

**Interfaces:**
- Consumes (Phase A): `driverFor` (`src/broker`), types `Account`/`Position`/`NewOrderRequest` (now via `broker.ts`).
- Produces: `holdingsForSymbol`, `flattenPlan`, `submitFlatten`, `finishExit` — same signatures EXCEPT `finishExit` loses its `suppress` param and `suppressed` return field.

**Changes:**
- Replace `import { AlpacaError, createOrder, listPositions, type Account, type AlpacaPosition, type NewOrderRequest } from './alpaca';` with:
  ```ts
  import { AlpacaError, type Account } from './alpaca';
  import { driverFor, type Position, type NewOrderRequest } from './broker';
  ```
- `SymbolHolding` uses `Position` instead of `AlpacaPosition`.
- `holdingsForSymbol`: `accounts.map(a => driverFor(a).listPositions(a))`.
- `submitFlatten`: `legs.map(l => driverFor(l.account).createOrder(l.account, l.req))`.
- `finishExit`: drop the `suppress` parameter, the `try/catch` suppress call, and `suppressed`. New body:
  ```ts
  export async function finishExit(
    legs: FlattenLeg[],
    submit: (l: FlattenLeg[]) => Promise<SubmitResult[]>,
  ): Promise<{ results: SubmitResult[]; allOk: boolean }> {
    const results = await submit(legs);
    const allOk = results.every(r => r.ok);
    return { results, allOk };
  }
  ```
  (Note: `symbol` param also removed — it was only used to build the suppress payload.)
- Update the comment above `finishExit` to drop the suppress/Task-19 language: `// Runs the "Exit all": submit the flatten legs and report per-leg + allOk.`

- [ ] **Step 1: Update `flatten.test.ts`**

The suppress-related tests are removed; the flatten tests are repointed to the driver. Rewrite `__tests__/flatten.test.ts`:

```ts
// __tests__/flatten.test.ts
import { flattenPlan, submitFlatten, finishExit, holdingsForSymbol, type SymbolHolding } from '../src/flatten';
import * as broker from '../src/broker';
import { AlpacaError, type Account } from '../src/alpaca';
import type { Position } from '../src/broker';

const ira: Account = { id: 'i', name: 'IRA', broker: 'alpaca', is_paper: false, key: 'K', secret: 'S' };
const paper: Account = { id: 'p', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S' };

function held(symbol: string, qty: string, side: 'long' | 'short' = 'long'): Position {
  return {
    asset_id: 'x', symbol, exchange: 'NASDAQ', asset_class: 'us_equity',
    avg_entry_price: '1', qty, side, market_value: '1', cost_basis: '1',
    unrealized_pl: '0', unrealized_plpc: '0', unrealized_intraday_pl: '0',
    unrealized_intraday_plpc: '0', current_price: '1', lastday_price: '1',
    change_today: '0', asset_marginable: true,
  };
}

function driverMock(over: Partial<broker.BrokerClient> = {}): broker.BrokerClient {
  return {
    listPositions: jest.fn().mockResolvedValue([]),
    listOrders: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: 'o1' }),
    closePosition: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

test('flattenPlan makes a market close per holding, opposite side', () => {
  const holdings: SymbolHolding[] = [
    { account: ira, position: held('AAPL', '100', 'long') },
    { account: paper, position: held('AAPL', '-20', 'short') },
  ];
  const legs = flattenPlan(holdings);
  expect(legs[0].req).toMatchObject({ symbol: 'AAPL', side: 'sell', type: 'market', qty: '100' });
  expect(legs[1].req).toMatchObject({ symbol: 'AAPL', side: 'buy', type: 'market', qty: '20' });
});

test('holdingsForSymbol isolates a rejecting account', async () => {
  jest.spyOn(broker, 'driverFor')
    .mockReturnValueOnce(driverMock({ listPositions: jest.fn().mockRejectedValue(new Error('down')) }))
    .mockReturnValueOnce(driverMock({ listPositions: jest.fn().mockResolvedValue([held('AAPL', '50')]) }));
  const out = await holdingsForSymbol([ira, paper], 'AAPL');
  expect(out).toHaveLength(1);
  expect(out[0].account.id).toBe('p');
});

test('submitFlatten fires each leg via its driver, reports per-leg', async () => {
  jest.spyOn(broker, 'driverFor')
    .mockReturnValueOnce(driverMock({ createOrder: jest.fn().mockResolvedValue({ id: 'o1' }) }))
    .mockReturnValueOnce(driverMock({ createOrder: jest.fn().mockRejectedValue(new AlpacaError(422, 'bad')) }));
  const legs = flattenPlan([
    { account: ira, position: held('AAPL', '100') },
    { account: paper, position: held('AAPL', '20') },
  ]);
  const results = await submitFlatten(legs);
  expect(results[0].ok).toBe(true);
  expect(results[1].ok).toBe(false);
  expect(results[1].error).toContain('bad');
});

test('finishExit returns results + allOk (no suppress)', async () => {
  const legs = flattenPlan([{ account: ira, position: held('AAPL', '100') }]);
  const submit = jest.fn().mockResolvedValue([{ leg: legs[0], ok: true }]);
  const out = await finishExit(legs, submit);
  expect(out.allOk).toBe(true);
  expect(out).not.toHaveProperty('suppressed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest flatten.test.ts`
Expected: FAIL — `finishExit` still takes 4 args / `driverFor` not used.

- [ ] **Step 3: Apply the `flatten.ts` changes** (per Changes above).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest flatten.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/flatten.ts __tests__/flatten.test.ts
git commit -m "refactor: flatten via broker driver; drop finishExit suppress seam"
```

---

### Task B2: Remove `postExitSuppress`; unwire it from `ExitScreen`

**Files:**
- Modify: `src/techan.ts`, `src/screens/ExitScreen.tsx`
- Test: `__tests__/techan.test.ts`, `__tests__/exitScreen.test.tsx`

**Interfaces:**
- `techan.ts` loses `postExitSuppress`; keeps `pingHealth`, `fetchStrategyPositions`, `fetchWatchlists`, `fetchWatchlistSymbols`.

**Changes:**
- `src/techan.ts`: delete the entire `postExitSuppress` function (the last export).
- `src/screens/ExitScreen.tsx`:
  - Delete line 25: `import { postExitSuppress } from '../techan';`
  - Update the `../flatten` import to drop nothing else (still uses `finishExit`, `submitFlatten`, `holdingsForSymbol`, `flattenPlan`, `FlattenLeg`).
  - Replace the `onExitAll` `finishExit(...)` call (lines 92-97) with the 2-arg form:
    ```ts
    const { results, allOk } = await finishExit(legs, submitFlatten);
    ```
- `__tests__/techan.test.ts`: delete the `postExitSuppress` test block (`test('postExitSuppress true on ok, false on failure, never throws', ...)`) and its import of `postExitSuppress`.
- `__tests__/exitScreen.test.tsx`: if it mocks `../src/techan` or references `postExitSuppress`, remove that. The Task-19 test `fires best-effort suppress after flatten...` (if present in this file) is deleted. The render smoke test stays; update the `flatten` mock so `finishExit` matches the new 2-arg shape if it's asserted (it's mocked, so arity isn't enforced — just ensure no `postExitSuppress` reference remains).

- [ ] **Step 1: Update the tests first (RED)**

Remove the `postExitSuppress` test from `techan.test.ts` and any suppress reference from `exitScreen.test.tsx`.

Run: `npx jest techan.test.ts exitScreen.test.tsx`
Expected: `techan.test.ts` still imports `postExitSuppress`? If you removed the import, it's fine; the point is the suite should be green AFTER Step 2's code deletion. Run again post-Step-2.

- [ ] **Step 2: Delete `postExitSuppress` + unwire ExitScreen** (per Changes).

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest techan.test.ts exitScreen.test.tsx`
Expected: PASS. `techan.test.ts` now has 3 tests (health, strategies, watchlists).

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "postExitSuppress" src __tests__ || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add src/techan.ts src/screens/ExitScreen.tsx __tests__/techan.test.ts __tests__/exitScreen.test.tsx
git commit -m "refactor: remove postExitSuppress — exits are just Alpaca orders"
```

---

### Task B3: Repoint Positions / Orders / OrderEntry / Chart to the driver; `is_paper` badge

**Files:**
- Modify: `src/screens/PositionsScreen.tsx`, `src/screens/OrdersScreen.tsx`, `src/screens/OrderEntryScreen.tsx`, `src/screens/ChartScreen.tsx`
- Test: `__tests__/positionsScreen.test.tsx`, `__tests__/ordersScreen.test.tsx`, `__tests__/orderEntryScreen.test.tsx`, `__tests__/chartScreen.test.tsx`

**Interfaces:** Consumes `driverFor` (`src/broker`); no longer imports `listPositions`/`listOpenOrders`/`createOrder`/`replaceOrder` from `../alpaca`.

**Changes:**

**PositionsScreen.tsx:**
- Import: drop `listPositions` from the `../alpaca` import; add `import { driverFor } from '../broker';`. Keep `AlpacaError`/`Account` from `../alpaca`; change `AlpacaPosition` type import to `Position` from `../broker`.
- In `load`: `accounts.map(a => driverFor(a).listPositions(a))`.
- Replace the env badge (lines ~145-146, `({bucket.account.env})`) with a paper badge:
  ```tsx
  {bucket.account.is_paper && <Text style={styles.paper}>paper</Text>}
  ```
  Rename the `env` style to `paper` (keep the same style values). When `is_paper` is false, nothing renders.

**OrdersScreen.tsx:**
- Same import swap; `driverFor(a).listOrders(a, { status: 'open' })` in `load`. `AlpacaOrder` type → `Order` from `../broker`.
- Replace the env badge (lines ~128-129) with the same `is_paper` paper badge + `paper` style rename.

**OrderEntryScreen.tsx:**
- Import: drop `createOrder`/`replaceOrder` from `../alpaca`; add `import { driverFor } from '../broker';`. Keep `Account` from `../alpaca`; move `OrderType`/`NewOrderRequest`/other order types to `../broker` imports.
- Lines ~147-149: `await driverFor(account).createOrder(...)` and for replace, since `BrokerClient` has no `replaceOrder`, keep using the transitional `replaceOrder` export from `../alpaca` for now **OR** (preferred) model replace as cancel+create is out of scope — **keep `replaceOrder` imported from `../alpaca`** (it survives as a non-driver Alpaca-specific helper; the `BrokerClient` interface intentionally omits replace). Add a one-line `ponytail:` note that replace stays Alpaca-specific until a broker needs it.

**ChartScreen.tsx:**
- It calls `holdingsForSymbol` (via `../flatten`, already repointed in B1) and navigates to OrderEntry — no direct `../alpaca` order calls. Only change: if it imports any `Alpaca*` type from `../alpaca`, repoint to `../broker`. Verify with grep; likely no change needed beyond the positions strip which reads `h.position.*` (now `Position`, same field names).

**Test fixtures (all four):** every account literal `env: 'live'` → `is_paper: false, broker: 'alpaca'`, `env: 'paper'` → `is_paper: true, broker: 'alpaca'`. Where a test mocks `alpaca.listPositions`/`listOpenOrders`/`createOrder` as `jest.Mock`, switch to mocking the driver: `jest.spyOn(require('../src/broker'), 'driverFor').mockReturnValue({ listPositions: jest.fn().mockResolvedValue([...]), listOrders: jest.fn()..., createOrder: jest.fn()..., closePosition: jest.fn() })`. Position/Order fixture objects must satisfy the full-fidelity types — use a `held()`/`order()` fixture helper (copy the `held()` from B1's test into each screen test, or a shared inline builder) so required fields are present. The smoke assertions (`toContain('AAPL')`, `'IRA'`, `'MSFT'`) stay.

- [ ] **Step 1: Update the four test files** to the driver-mock + `is_paper` fixtures + full-fidelity Position/Order builders (RED).

Run: `npx jest positionsScreen.test.tsx ordersScreen.test.tsx orderEntryScreen.test.tsx chartScreen.test.tsx`
Expected: FAIL (screens still import removed `../alpaca` fns / `env`).

- [ ] **Step 2: Apply the screen changes** (per Changes).

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest positionsScreen.test.tsx ordersScreen.test.tsx orderEntryScreen.test.tsx chartScreen.test.tsx`
Expected: PASS. Verify a paper account renders "paper" and a live account renders no badge (add one assertion per Positions/Orders test: `expect(json).toContain('paper')` with an `is_paper: true` fixture; and for a live-only fixture, `expect(json).not.toContain('paper')`).

- [ ] **Step 4: Commit**

```bash
git add src/screens/PositionsScreen.tsx src/screens/OrdersScreen.tsx src/screens/OrderEntryScreen.tsx src/screens/ChartScreen.tsx __tests__/positionsScreen.test.tsx __tests__/ordersScreen.test.tsx __tests__/orderEntryScreen.test.tsx __tests__/chartScreen.test.tsx
git commit -m "refactor: screens use broker driver; is_paper badge replaces env text"
```

---

### Task B4: `AccountPicker` + `AccountsScreen` — `is_paper` label, drop `env` UI

**Files:**
- Modify: `src/components/AccountPicker.tsx`, `src/screens/AccountsScreen.tsx`
- Test: `__tests__/accountPicker.test.tsx`, `__tests__/accountsScreen.test.tsx`

**Note:** `AccountsScreen` becomes read-only in Phase C (Task C4). In THIS task, only fix the `env` → `is_paper` compile breakage so Phase B stays green; do not yet remove the add/edit form (that's C4). Minimal changes:

**AccountPicker.tsx:**
- `import type { Account } from '../broker';` (was `../alpaca`) — or keep `../alpaca` (it re-exports `Account`); prefer `../alpaca` since `Account` is defined there. No change needed if it imports `Account` from `../alpaca`. It currently does `import type { Account } from '../alpaca';` — that still works.
- Line ~13 label: `` `${a.name} · ${a.env.toUpperCase()}` `` → `` `${a.name}${a.is_paper ? ' · PAPER' : ''}` ``.

**AccountsScreen.tsx:**
- Remove `import type { Account, AlpacaEnv } from '../alpaca';` → `import type { Account } from '../alpaca';`.
- The `Draft` type and add/edit form reference `env`. Since C4 removes the form, the minimal Phase-B fix: replace `env: AlpacaEnv` in `Draft` with `is_paper: boolean`; `EMPTY_DRAFT` `env: 'paper'` → `is_paper: true`; the env toggle UI (lines ~145-156, the `['paper','live'].map`) → a single paper/live toggle on `is_paper` (a two-button toggle: "Paper" sets `is_paper: true`, "Live" sets `false`); `item.env.toUpperCase()` (line ~104) → `item.is_paper ? 'PAPER' : 'LIVE'`; `env: draft.env` in the add/update calls → `is_paper: draft.is_paper`. Since `addAccount`/`updateAccount` in `accounts.ts` still take `env` in Phase B, ALSO update `accounts.ts` to accept `is_paper` — but `accounts.ts` is rewritten in C3. **To avoid churn, do the minimal `accounts.ts` field swap here** (`env: AlpacaEnv` → `is_paper: boolean` in `AccountMeta`, `addAccount` input, and the load/save mapping) so the app compiles; C3 then rewrites the module for build-time config.

**accounts.ts minimal swap (this task):**
- `import type { Account, AlpacaEnv }` → `import type { Account }`.
- `AccountMeta`: `env: AlpacaEnv` → `is_paper: boolean; broker: 'alpaca'`.
- `loadAccounts`: push `broker: m.broker, is_paper: m.is_paper` instead of `env: m.env`.
- `addAccount` input `env: AlpacaEnv` → `is_paper: boolean`; sets `broker: 'alpaca'`; returns `broker/is_paper`.
- `updateAccount`: `next` uses `is_paper`/`broker`.

**Test fixtures:** `accountPicker.test.tsx` + `accountsScreen.test.tsx` + `accounts.test.ts` + `accountContext.test.tsx` account literals: `env` → `is_paper`/`broker`. `accountPicker.test.tsx` label assertion updated to the new `· PAPER`/no-suffix form.

- [ ] **Step 1: Update the test fixtures + label/badge assertions** (RED).

Run: `npx jest accountPicker.test.tsx accountsScreen.test.tsx accounts.test.ts accountContext.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Apply the changes** (AccountPicker, AccountsScreen, accounts.ts minimal swap).

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest accountPicker.test.tsx accountsScreen.test.tsx accounts.test.ts accountContext.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AccountPicker.tsx src/screens/AccountsScreen.tsx src/accounts.ts __tests__/accountPicker.test.tsx __tests__/accountsScreen.test.tsx __tests__/accounts.test.ts __tests__/accountContext.test.tsx
git commit -m "refactor: is_paper replaces env in AccountPicker/AccountsScreen/accounts"
```

---

### Task B5: Rekey the strategy tagger to `(broker_id, account_id, symbol)`; update contract doc

**Files:**
- Modify: `src/strategyTagger.ts`, `src/techan.ts` (the `StrategyPosition` type), `docs/superpowers/contracts/fe-fa-techan-contract.md`
- Test: `__tests__/strategyTagger.test.ts`

**Interfaces:**
- `StrategyPosition` gains `broker_id`: `{ broker_id: string; account_id: string; symbol: string; strategy: string }` (in `techan.ts`).
- `taggerFromMap` keys on `` `${broker_id}:${account_id}:${symbol}` `` and looks up `` `${account.broker}:${account.id}:${symbol}` ``.

**Changes:**
- `src/techan.ts`: `StrategyPosition` type gains `broker_id: string` (first field).
- `src/strategyTagger.ts`:
  ```ts
  export function taggerFromMap(
    rows: StrategyPosition[],
  ): StrategyOf<{ symbol: string }> {
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(`${r.broker_id}:${r.account_id}:${r.symbol}`, r.strategy);
    }
    return (item: { symbol: string }, account: Account) =>
      map.get(`${account.broker}:${account.id}:${item.symbol}`) ?? 'Unattributed';
  }
  ```
  `Account` import stays from `./alpaca`.
- Contract doc `docs/superpowers/contracts/fe-fa-techan-contract.md`: it already documents the `(broker_id, account_id, symbol)` join and the `broker_id` field (updated in a prior commit). Verify §4.2's `StrategyPosition[]` example and field table include `broker_id`; if the "Pending FE change" banner at the top still says the rekey "lands with the broker-first-class implementation, not yet in shipped code," update that banner to past tense / remove it since this task ships it. Also remove the top-of-file note that `src/techan.ts` "still contains `postExitSuppress`" (removed in B2).

- [ ] **Step 1: Update `strategyTagger.test.ts`**

```ts
// __tests__/strategyTagger.test.ts
import { taggerFromMap } from '../src/strategyTagger';
import type { Account } from '../src/alpaca';

const ira: Account = { id: 'i', name: 'IRA', broker: 'alpaca', is_paper: false, key: 'K', secret: 'S' };
const paper: Account = { id: 'p', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S' };

test('tags by (broker, account, symbol), Unattributed otherwise', () => {
  const tag = taggerFromMap([
    { broker_id: 'alpaca', account_id: 'i', symbol: 'AAPL', strategy: 'Momentum' },
  ]);
  expect(tag({ symbol: 'AAPL' }, ira)).toBe('Momentum');
  expect(tag({ symbol: 'AAPL' }, paper)).toBe('Unattributed'); // different account
  expect(tag({ symbol: 'NVDA' }, ira)).toBe('Unattributed');   // different symbol
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest strategyTagger.test.ts`
Expected: FAIL — `broker_id` not in `StrategyPosition` / key mismatch.

- [ ] **Step 3: Apply the tagger + techan type + contract-doc changes.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest strategyTagger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategyTagger.ts src/techan.ts __tests__/strategyTagger.test.ts docs/superpowers/contracts/fe-fa-techan-contract.md
git commit -m "feat: rekey strategy tagger to (broker, account, symbol); finalize contract"
```

---

### Task B6: Delete transitional `alpaca.ts` wrappers; Phase B verification

**Files:**
- Modify: `src/alpaca.ts` (remove the transitional exports)
- Test: full suite

**Changes:**
- Remove the transitional named exports added in A3: `listPositions`, `listOrders`, `createOrder`, `closePosition`, `listOpenOrders`, and the `export type { … as AlpacaPosition, … as AlpacaOrder, … }` re-export block. KEEP: `alpacaDriver`, `AlpacaError`, `alpacaHeaders`, `Account`, `replaceOrder`, `cancelOrder` (the last two are Alpaca-specific helpers still used by OrderEntryScreen; keep until a broker abstraction needs them — add a `ponytail:` note).
- Before removing, grep to confirm nothing still imports the wrappers:

- [ ] **Step 1: Confirm no remaining consumers of the wrappers**

Run: `grep -rn "listPositions\|listOpenOrders\|closePosition\|AlpacaPosition\|AlpacaOrder" src --include="*.ts" --include="*.tsx" | grep "from '.*alpaca'\|import"`
Expected: no import of these from `../alpaca`/`./alpaca` outside `alpaca.ts` itself. (`createOrder` should also be gone from consumers — flatten uses `driverFor`, OrderEntry uses `driverFor`.) If any straggler remains, repoint it to `driverFor`/`../broker` first.

- [ ] **Step 2: Remove the transitional exports** from `src/alpaca.ts`.

- [ ] **Step 3: Full suite + lint + typecheck**

Run: `npx jest && npx eslint . && npx tsc --noEmit 2>&1 | grep -v "Cannot find name 'global'" | grep "error" || echo "tsc clean (except pre-existing global)"`
Expected: all suites PASS; eslint 0 errors; no NEW tsc errors (the pre-existing `global` errors in `alpaca.test.ts`/`techan.test.ts` remain and are filtered — do not fix here).

- [ ] **Step 4: Commit**

```bash
git add src/alpaca.ts
git commit -m "chore: remove transitional alpaca wrappers — consumers on broker driver"
```

**Phase B complete.** All consumers route through the broker driver; suppress removed; tagger rekeyed; contract finalized. App green. Verify before Phase C.

---

## Phase C — Build-time config + encrypted secrets + provisioning

> **Dependencies (pin exactly):** build-side `libsodium-wrappers-sumo@0.8.4` (dev dependency; `-sumo` is required — plain `libsodium-wrappers` lacks `crypto_pwhash`); device `react-native-libsodium@1.7.0`.
> **Platform prerequisites for `react-native-libsodium@1.7.0`:** requires RN **New Architecture** enabled (RN 0.84 defaults on), Android `minSdk >= 24`, iOS target 15.1. Android autolinks; iOS needs `pod install`. Works under Hermes (JSI/TurboModule).
> **Interop invariants (MUST hold on both sides or decryption fails):** identical `crypto_pwhash_OPSLIMIT_MODERATE` + `crypto_pwhash_MEMLIMIT_MODERATE` + `crypto_pwhash_ALG_ARGON2ID13`; key length `crypto_secretbox_KEYBYTES` (32); salt `crypto_pwhash_SALTBYTES` (16); nonce `crypto_secretbox_NONCEBYTES` (24); **base64 variant `base64_variants.ORIGINAL` explicitly on every to/from_base64** (the libsodium.js default is URLSAFE_NO_PADDING — do not rely on it).

### Task C1: Build-side credential-encrypt script

**Files:**
- Create: `scripts/encrypt-credentials.mjs`
- Create: `credentials.example.json` (git-committed template), and document `credentials.local.json` (git-IGNORED, the real creds)
- Modify: `.gitignore` (add `credentials.local.json`)
- Modify: `package.json` (add `libsodium-wrappers-sumo` devDependency + an `encrypt-creds` script)
- Test: `__tests__/encryptCredentials.test.mjs` (round-trip against the same libsodium primitives)

**Interfaces:**
- Produces a JSON artifact (written to a path consumed by build-time config in C3) with shape:
  ```jsonc
  {
    "salt": "<base64>",
    "nonce": "<base64>",
    "ciphertext": "<base64>",
    "fingerprint": "<hex sha256 of the ciphertext base64 string>"
  }
  ```
- The plaintext it encrypts is a JSON array of credential entries:
  ```jsonc
  [ { "broker": "alpaca", "id": "PA123", "key": "AK...", "secret": "..." } ]
  ```
  (Only `key`/`secret` are secret; `broker`/`id`/`name`/`is_paper` are ALSO carried in the non-secret build config per C3, but the encrypted blob keys creds by `broker`+`id` so provisioning can match them.)

- [ ] **Step 1: Add the dev dependency**

Run: `npm install --save-dev libsodium-wrappers-sumo@0.8.4`
Expected: added to `devDependencies`.

- [ ] **Step 2: Write the round-trip test**

```mjs
// __tests__/encryptCredentials.test.mjs
import sodium from 'libsodium-wrappers-sumo';
import { encryptCredentials } from '../scripts/encrypt-credentials.mjs';

test('encryptCredentials round-trips with the same primitives', async () => {
  await sodium.ready;
  const creds = [{ broker: 'alpaca', id: 'PA1', key: 'K', secret: 'S' }];
  const blob = await encryptCredentials('correct horse battery staple', creds);
  expect(blob.salt && blob.nonce && blob.ciphertext && blob.fingerprint).toBeTruthy();

  // decrypt with the same primitives (simulating the RN side)
  const V = sodium.base64_variants.ORIGINAL;
  const salt = sodium.from_base64(blob.salt, V);
  const nonce = sodium.from_base64(blob.nonce, V);
  const ct = sodium.from_base64(blob.ciphertext, V);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES, 'correct horse battery staple', salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const pt = sodium.crypto_secretbox_open_easy(ct, nonce, key);
  expect(JSON.parse(sodium.to_string(pt))).toEqual(creds);
});

test('wrong passphrase fails to decrypt', async () => {
  await sodium.ready;
  const blob = await encryptCredentials('right', [{ broker: 'alpaca', id: 'x', key: 'K', secret: 'S' }]);
  const V = sodium.base64_variants.ORIGINAL;
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES, 'wrong', sodium.from_base64(blob.salt, V),
    sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  expect(() =>
    sodium.crypto_secretbox_open_easy(
      sodium.from_base64(blob.ciphertext, V), sodium.from_base64(blob.nonce, V), key,
    ),
  ).toThrow();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest encryptCredentials.test.mjs`
Expected: FAIL — cannot find module `../scripts/encrypt-credentials.mjs`.

- [ ] **Step 4: Write the script**

```mjs
// scripts/encrypt-credentials.mjs
import sodium from 'libsodium-wrappers-sumo';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const V_ORIGINAL = () => sodium.base64_variants.ORIGINAL;

export async function encryptCredentials(passphrase, credsArray) {
  await sodium.ready;
  const V = V_ORIGINAL();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const plaintext = sodium.from_string(JSON.stringify(credsArray));
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const ciphertextB64 = sodium.to_base64(ciphertext, V);
  const fingerprint = createHash('sha256').update(ciphertextB64).digest('hex');
  return {
    salt: sodium.to_base64(salt, V),
    nonce: sodium.to_base64(nonce, V),
    ciphertext: ciphertextB64,
    fingerprint,
  };
}

// CLI: node scripts/encrypt-credentials.mjs <passphrase> [inPath] [outPath]
// Reads plaintext creds JSON array from inPath (default credentials.local.json),
// writes the blob JSON to outPath (default android/app/src/main/assets/credentials.enc.json
// — a path the build injects; final path settled in C3).
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , passphrase, inPath = 'credentials.local.json', outPath = 'credentials.enc.json'] = process.argv;
  if (!passphrase) {
    console.error('usage: node scripts/encrypt-credentials.mjs <passphrase> [in] [out]');
    process.exit(1);
  }
  const creds = JSON.parse(readFileSync(inPath, 'utf8'));
  const blob = await encryptCredentials(passphrase, creds);
  writeFileSync(outPath, JSON.stringify(blob, null, 2));
  // ponytail: never log the passphrase or plaintext creds.
  console.log(`wrote ${outPath} (fingerprint ${blob.fingerprint.slice(0, 12)}…)`);
}
```

- [ ] **Step 5: Template + gitignore + package script**

Create `credentials.example.json`:
```json
[{ "broker": "alpaca", "id": "PA_ACCOUNT_NUMBER", "name": "Paper", "is_paper": true, "key": "APCA_KEY", "secret": "APCA_SECRET" }]
```
Add to `.gitignore`: `credentials.local.json` and `credentials.enc.json` (the blob is injected at build; do not commit either). Add to `package.json` `scripts`: `"encrypt-creds": "node scripts/encrypt-credentials.mjs"`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest encryptCredentials.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/encrypt-credentials.mjs __tests__/encryptCredentials.test.mjs credentials.example.json .gitignore package.json package-lock.json
git commit -m "feat: build-side credential-encrypt script (libsodium Argon2id + secretbox)"
```

---

### Task C2: `src/provisioning.ts` — fingerprint compare (pure) + decrypt→Keystore

**Files:**
- Create: `src/provisioning.ts`
- Test: `__tests__/provisioning.test.ts`

**Interfaces:**
- Produces:
  - `type ProvisioningAction = 'skip' | 'provision'`
  - `function provisioningAction(shippedFingerprint: string, storedFingerprint: string | null): ProvisioningAction` — pure. `'provision'` if `storedFingerprint == null` (fresh) or `!== shippedFingerprint` (creds changed); else `'skip'`.
  - `type EncryptedBlob = { salt: string; nonce: string; ciphertext: string; fingerprint: string }`
  - `type ProvisionedCred = { broker: string; id: string; key: string; secret: string }`
  - `async function runProvisioning(blob: EncryptedBlob, passphrase: string, deps): Promise<{ ok: true } | { ok: false; reason: 'bad-passphrase' }>` — derives the key (Argon2id), decrypts, writes each cred to Keystore keyed `${broker}:${id}`, stores the fingerprint. `deps` is an injected seam for testability: `{ decrypt, saveCred, saveFingerprint }`.
- The libsodium calls live behind `deps.decrypt` so the pure logic is unit-tested without the native module.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/provisioning.test.ts
import { provisioningAction, runProvisioning, type EncryptedBlob } from '../src/provisioning';

const blob: EncryptedBlob = { salt: 's', nonce: 'n', ciphertext: 'c', fingerprint: 'fp-new' };

test('provisioningAction: fresh install provisions', () => {
  expect(provisioningAction('fp-new', null)).toBe('provision');
});
test('provisioningAction: changed fingerprint provisions', () => {
  expect(provisioningAction('fp-new', 'fp-old')).toBe('provision');
});
test('provisioningAction: unchanged skips', () => {
  expect(provisioningAction('fp-new', 'fp-new')).toBe('skip');
});

test('runProvisioning decrypts, saves creds keyed broker:id, stores fingerprint', async () => {
  const saved: Record<string, { key: string; secret: string }> = {};
  let savedFp: string | null = null;
  const res = await runProvisioning(blob, 'pass', {
    decrypt: async () => [{ broker: 'alpaca', id: 'PA1', key: 'K', secret: 'S' }],
    saveCred: async (k, key, secret) => { saved[k] = { key, secret }; },
    saveFingerprint: async fp => { savedFp = fp; },
  });
  expect(res).toEqual({ ok: true });
  expect(saved['alpaca:PA1']).toEqual({ key: 'K', secret: 'S' });
  expect(savedFp).toBe('fp-new');
});

test('runProvisioning reports bad-passphrase when decrypt throws', async () => {
  const res = await runProvisioning(blob, 'wrong', {
    decrypt: async () => { throw new Error('auth failed'); },
    saveCred: async () => {},
    saveFingerprint: async () => {},
  });
  expect(res).toEqual({ ok: false, reason: 'bad-passphrase' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest provisioning.test.ts`
Expected: FAIL — cannot find module `../src/provisioning`.

- [ ] **Step 3: Write the implementation**

```ts
// src/provisioning.ts
export type ProvisioningAction = 'skip' | 'provision';

export function provisioningAction(
  shippedFingerprint: string,
  storedFingerprint: string | null,
): ProvisioningAction {
  if (storedFingerprint == null || storedFingerprint !== shippedFingerprint) {
    return 'provision';
  }
  return 'skip';
}

export type EncryptedBlob = {
  salt: string;
  nonce: string;
  ciphertext: string;
  fingerprint: string;
};

export type ProvisionedCred = {
  broker: string;
  id: string;
  key: string;
  secret: string;
};

export type ProvisioningDeps = {
  decrypt: (blob: EncryptedBlob, passphrase: string) => Promise<ProvisionedCred[]>;
  saveCred: (serviceKey: string, key: string, secret: string) => Promise<void>;
  saveFingerprint: (fp: string) => Promise<void>;
};

export async function runProvisioning(
  blob: EncryptedBlob,
  passphrase: string,
  deps: ProvisioningDeps,
): Promise<{ ok: true } | { ok: false; reason: 'bad-passphrase' }> {
  let creds: ProvisionedCred[];
  try {
    creds = await deps.decrypt(blob, passphrase);
  } catch {
    // decryption failure = wrong passphrase (authenticated cipher throws).
    // ponytail: log nothing — never leak passphrase/creds.
    return { ok: false, reason: 'bad-passphrase' };
  }
  for (const c of creds) {
    await deps.saveCred(`${c.broker}:${c.id}`, c.key, c.secret);
  }
  await deps.saveFingerprint(blob.fingerprint);
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest provisioning.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/provisioning.ts __tests__/provisioning.test.ts
git commit -m "feat: provisioning core — fingerprint compare + decrypt→Keystore seam"
```

---

### Task C3: Wire real libsodium + Keychain; build-time config load; AccountContext gate

**Files:**
- Create: `src/secretsBackend.ts` — the concrete `ProvisioningDeps` (react-native-libsodium decrypt + react-native-keychain save) + Keystore cred/fingerprint readers.
- Modify: `src/accounts.ts` — load accounts from build-time config (non-secret) + Keystore (creds).
- Modify: `src/AccountContext.tsx` — provisioning gate.
- Modify: `package.json` (add `react-native-libsodium@1.7.0`).
- Test: `__tests__/accounts.test.ts`, `__tests__/accountContext.test.tsx` (updated), `__tests__/secretsBackend.test.ts` (thin).

**Install:**
- [ ] **Step 1: Add device dep** — `npm install react-native-libsodium@1.7.0` then (iOS) `cd ios && pod install` (Android autolinks). Note in the report: requires New Architecture (RN 0.84 default), Android minSdk ≥ 24. This is a native dependency; the Metro/Jest side is mocked (see Step 2).

**Non-secret build config (react-native-config):**
- Accounts' non-secret fields are authored in `.env` (git-ignored) as a JSON string, e.g. `ACCOUNTS_JSON=[{"broker":"alpaca","id":"PA1","name":"Paper","is_paper":true}]`, and the encrypted blob is bundled as an asset (path from C1's script output) read at provisioning time. `.env.example` documents `ACCOUNTS_JSON`.
- The blob is loaded on device. **Simplest bundling for single-user Android:** import the blob JSON directly (`import blob from '../credentials.enc.json'` won't work if git-ignored and absent in CI). Instead, read it via a bundled asset OR inline it into `.env` as `CREDENTIALS_BLOB_JSON`. **Chosen:** put the whole blob JSON in `.env` as `CREDENTIALS_BLOB_JSON` (it's ciphertext — safe to embed as config; the APK-plaintext concern is exactly what the encryption addresses). `Config.CREDENTIALS_BLOB_JSON` → `JSON.parse` → `EncryptedBlob`. Update C1's script docs to also print the one-line `.env` value.

- [ ] **Step 2: Mock the native module for tests + config keys**

`jest.setup.js` already exists (wired via `jest.config.js` `setupFiles: ['./jest.setup.js']`) and already mocks `react-native-config` (currently `default: { API_BASE_URL: 'https://example.test' }`), `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`, `react-native-webview`. Make three edits:

(a) **Extend** the existing `react-native-config` mock's `default` to add the new keys (so `Config.ACCOUNTS_JSON`/`CREDENTIALS_BLOB_JSON` are defined; default the blob to `undefined` so `AccountContext`'s `blob` is `null` and existing render tests take the no-provisioning path):
```js
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'https://example.test',
    ACCOUNTS_JSON: '[]',
    // CREDENTIALS_BLOB_JSON left undefined → provisioning gate resolves 'ready'
  },
}));
```

(b) **Add** a `react-native-libsodium` mock (append to `jest.setup.js`):
```js
jest.mock('react-native-libsodium', () => ({
  __esModule: true,
  ready: Promise.resolve(),
  crypto_pwhash: jest.fn(() => new Uint8Array(32)),
  crypto_secretbox_open_easy: jest.fn(() => new Uint8Array()),
  from_base64: jest.fn(() => new Uint8Array()),
  to_string: jest.fn(() => '[]'),
  base64_variants: { ORIGINAL: 1 },
  crypto_secretbox_KEYBYTES: 32,
  crypto_pwhash_SALTBYTES: 16,
  crypto_secretbox_NONCEBYTES: 24,
  crypto_pwhash_OPSLIMIT_MODERATE: 3,
  crypto_pwhash_MEMLIMIT_MODERATE: 268435456,
  crypto_pwhash_ALG_ARGON2ID13: 2,
}));
```

(c) **Add** `react-native-libsodium` to the `transformIgnorePatterns` regex in `jest.config.js` (the existing alternation list ends `…react-native-webview)/)` — insert `|react-native-libsodium` before the closing group).

Note: `react-native-keychain` is used by the existing `accountContext.test.tsx`, which already mocks it (`jest.mock('react-native-keychain', …)` per-file). `secretsBackend.test.ts` (Step 6) mocks it the same way. Do NOT add a global keychain mock unless a test needs it.

Verify existing tests still pass after these edits: `npx jest`.

- [ ] **Step 3: Write `secretsBackend.ts`** (the concrete deps + readers). Thin native glue — kept out of unit tests behind the C2 seam.

```ts
// src/secretsBackend.ts
import * as Keychain from 'react-native-keychain';
import {
  ready, crypto_pwhash, crypto_secretbox_open_easy, from_base64, to_string,
  base64_variants, crypto_secretbox_KEYBYTES,
  crypto_pwhash_OPSLIMIT_MODERATE, crypto_pwhash_MEMLIMIT_MODERATE,
  crypto_pwhash_ALG_ARGON2ID13,
} from 'react-native-libsodium';
import type { EncryptedBlob, ProvisionedCred, ProvisioningDeps } from './provisioning';

const FINGERPRINT_SERVICE = 'creds.fingerprint';
const credService = (serviceKey: string) => `cred.${serviceKey}`;

async function decrypt(blob: EncryptedBlob, passphrase: string): Promise<ProvisionedCred[]> {
  await ready;
  const V = base64_variants.ORIGINAL;
  const key = crypto_pwhash(
    crypto_secretbox_KEYBYTES, passphrase, from_base64(blob.salt, V),
    crypto_pwhash_OPSLIMIT_MODERATE, crypto_pwhash_MEMLIMIT_MODERATE,
    crypto_pwhash_ALG_ARGON2ID13,
  );
  const plaintext = crypto_secretbox_open_easy(
    from_base64(blob.ciphertext, V), from_base64(blob.nonce, V), key,
  ); // throws on wrong passphrase
  return JSON.parse(to_string(plaintext)) as ProvisionedCred[];
}

export const secretsDeps: ProvisioningDeps = {
  decrypt,
  saveCred: async (serviceKey, key, secret) => {
    await Keychain.setGenericPassword(key, secret, { service: credService(serviceKey) });
  },
  saveFingerprint: async fp => {
    await Keychain.setGenericPassword('fp', fp, { service: FINGERPRINT_SERVICE });
  },
};

export async function readFingerprint(): Promise<string | null> {
  const e = await Keychain.getGenericPassword({ service: FINGERPRINT_SERVICE });
  return e ? e.password : null;
}

export async function readCred(serviceKey: string): Promise<{ key: string; secret: string } | null> {
  const e = await Keychain.getGenericPassword({ service: credService(serviceKey) });
  return e ? { key: e.username, secret: e.password } : null;
}
```

- [ ] **Step 4: Rewrite `src/accounts.ts`** to load from build config + Keystore creds

```ts
// src/accounts.ts
import Config from 'react-native-config';
import type { Account } from './alpaca';
import type { BrokerId } from './broker';
import { readCred } from './secretsBackend';

type AccountConfig = { broker: BrokerId; id: string; name: string; is_paper: boolean };

function parseAccountsConfig(): AccountConfig[] {
  try {
    return JSON.parse(Config.ACCOUNTS_JSON ?? '[]') as AccountConfig[];
  } catch {
    return [];
  }
}

// Accounts = non-secret build config joined with Keystore-provisioned creds.
// An account with no provisioned cred is skipped (provisioning not yet run).
export async function loadAccounts(): Promise<Account[]> {
  const cfgs = parseAccountsConfig();
  const out: Account[] = [];
  for (const c of cfgs) {
    const cred = await readCred(`${c.broker}:${c.id}`);
    if (!cred) {
      continue;
    }
    out.push({ id: c.id, name: c.name, broker: c.broker, is_paper: c.is_paper, key: cred.key, secret: cred.secret });
  }
  return out;
}
```

(This REMOVES `addAccount`/`updateAccount`/`deleteAccount`/`AccountMeta`/`newId` — accounts are build-time now. Any test importing those is updated in Step 6.)

- [ ] **Step 5: Add the provisioning gate to `AccountContext.tsx`**

The provider, on mount, runs the fingerprint check and (if needed) provisioning before loading accounts. Add state `provisioning: 'checking' | 'need-passphrase' | 'ready'` and a `provision(passphrase)` action. Structure:
```tsx
// in AccountProvider, alongside existing state:
import Config from 'react-native-config';
import { provisioningAction, runProvisioning, type EncryptedBlob } from './provisioning';
import { secretsDeps, readFingerprint } from './secretsBackend';

const blob: EncryptedBlob | null = (() => {
  try { return JSON.parse(Config.CREDENTIALS_BLOB_JSON ?? 'null'); } catch { return null; }
})();

const [provStatus, setProvStatus] = useState<'checking' | 'need-passphrase' | 'ready'>('checking');

const checkProvisioning = useCallback(async () => {
  if (!blob) { setProvStatus('ready'); return; } // no blob → nothing to provision
  const stored = await readFingerprint();
  setProvStatus(provisioningAction(blob.fingerprint, stored) === 'provision' ? 'need-passphrase' : 'ready');
}, []);

const provision = useCallback(async (passphrase: string): Promise<boolean> => {
  if (!blob) { return true; }
  const res = await runProvisioning(blob, passphrase, secretsDeps);
  if (res.ok) { await reload(); setProvStatus('ready'); return true; }
  return false; // bad passphrase — caller re-prompts
}, [reload]);

useEffect(() => { checkProvisioning(); }, [checkProvisioning]);
```
Expose `provStatus` + `provision` from the context value (add them to the `Ctx` type and the provider `value`).

`App.tsx` currently nests `AccountProvider > BackendProvider poll > NavigationContainer > …` (lines ~78-105). Insert a `ProvisioningGate` component **inside `AccountProvider`, wrapping `BackendProvider`+everything below** (it must be inside the provider to call `useAccounts()`):
```tsx
function ProvisioningGate({ children }: { children: React.ReactNode }) {
  const { provStatus, provision } = useAccounts();
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);
  if (provStatus === 'checking') {
    return null; // brief; splash acceptable
  }
  if (provStatus === 'need-passphrase') {
    return (
      <View style={gateStyles.c}>
        <Text style={gateStyles.t}>Enter provisioning passphrase</Text>
        <TextInput
          style={gateStyles.input}
          secureTextEntry
          autoCapitalize="none"
          value={pass}
          onChangeText={setPass}
        />
        {error && <Text style={gateStyles.err}>Incorrect passphrase.</Text>}
        <TouchableOpacity
          style={gateStyles.btn}
          onPress={async () => {
            const ok = await provision(pass);
            if (!ok) { setError(true); setPass(''); }
          }}
        >
          <Text style={gateStyles.btnText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return <>{children}</>;
}
```
Wrap: `<AccountProvider><ProvisioningGate><BackendProvider poll>…</BackendProvider></ProvisioningGate></AccountProvider>`. Add `gateStyles` (dark palette). `useAccounts`/`useState`/`View`/`Text`/`TextInput`/`TouchableOpacity` imports as needed.

- [ ] **Step 6: Update tests**

- `__tests__/accounts.test.ts`: rewrite to test `loadAccounts` reading from mocked `Config.ACCOUNTS_JSON` + mocked `readCred`. Remove add/update/delete tests. Mock `./secretsBackend` `readCred`.
- `__tests__/accountContext.test.tsx`: account fixtures use `broker`/`is_paper`; mock `./provisioning`/`./secretsBackend` so `provStatus` resolves to `'ready'` (blob null path) for existing render tests. Add one test: with a blob whose fingerprint differs from stored, `provStatus` becomes `'need-passphrase'`.
- `__tests__/secretsBackend.test.ts` (new, thin): with the mocked `react-native-libsodium` + `react-native-keychain`, `secretsDeps.saveCred` calls `Keychain.setGenericPassword` with `service: 'cred.alpaca:PA1'`; `readFingerprint` returns the stored password.

- [ ] **Step 7: Run tests + lint**

Run: `npx jest && npx eslint src/accounts.ts src/secretsBackend.ts src/provisioning.ts src/AccountContext.tsx`
Expected: all PASS; lint 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/secretsBackend.ts src/accounts.ts src/AccountContext.tsx jest.setup.js package.json package-lock.json __tests__/accounts.test.ts __tests__/accountContext.test.tsx __tests__/secretsBackend.test.ts .env.example App.tsx
git commit -m "feat: build-time accounts + fingerprint-gated Keystore provisioning"
```

---

### Task C4: `AccountsScreen` — read-only

**Files:**
- Modify: `src/screens/AccountsScreen.tsx`
- Test: `__tests__/accountsScreen.test.tsx`

**Changes:** Remove the add/edit/delete form, the `Draft` state, the `＋` header button, `openAdd`, `addAccount`/`updateAccount`/`deleteAccount` imports (deleted in C3). The screen becomes a read-only list: each row shows `name`, a **paper badge iff `is_paper`**, and the account `id` (broker account number). Header keeps the back-nav (`navigation.goBack()` with `‹`) from the prior branch. Keep `useAccounts()` for the list.

- [ ] **Step 1: Update the test** — assert the list renders account names + a `paper` badge for a paper account, and that no add/edit affordance (`＋` / "Save") is present. Remove any test exercising the form.

Run: `npx jest accountsScreen.test.tsx`
Expected: FAIL (form still present / imports removed).

- [ ] **Step 2: Rewrite `AccountsScreen` as read-only** per Changes.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx jest accountsScreen.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/screens/AccountsScreen.tsx __tests__/accountsScreen.test.tsx
git commit -m "feat: AccountsScreen read-only (accounts are build-time config)"
```

---

### Task C5: Full-suite + lint + typecheck verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npx jest`
Expected: all suites PASS (broker, alpacaDriver, alpaca, flatten, techan, exitScreen, positionsScreen, ordersScreen, orderEntryScreen, chartScreen, accountPicker, accountsScreen, accounts, accountContext, strategyTagger, provisioning, encryptCredentials, secretsBackend, book, backendContext, appHeader, settingsScreen, watchlistsScreen, strategyFilter, App).

- [ ] **Step 2: Lint**

Run: `npx eslint .`
Expected: 0 errors (pre-existing inline-style/no-bitwise/no-shadow warnings acceptable; no new errors).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error" | grep -v "Cannot find name 'global'"`
Expected: empty (no new type errors; the pre-existing `global` errors in `alpaca.test.ts`/`techan.test.ts`/`encryptCredentials` are filtered — do not fix here).

- [ ] **Step 4: Grep guards**

Run: `grep -rn "\.env\b\|AlpacaEnv\|postExitSuppress\|listOpenOrders" src --include="*.ts" --include="*.tsx" | grep -v "process.env" || echo "clean"`
Expected: `clean` (no `env`/`AlpacaEnv`, no `postExitSuppress`, no `listOpenOrders`).

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "chore: Phase C verification fixes"
```

---

### Task C6: Emulator smoke + docs (manual verification)

**Files:** none (manual + docs note).

- [ ] **Step 1: Author local creds + encrypt**

Copy `credentials.example.json` → `credentials.local.json`, fill in a real paper account (`id` = the Alpaca `account_number` from `GET /v2/account`, or the paper account number visible in the Alpaca dashboard). Run `npm run encrypt-creds -- <passphrase>`; put `ACCOUNTS_JSON` (non-secret) and `CREDENTIALS_BLOB_JSON` (the blob) into `.env`.

- [ ] **Step 2: Build/run on emulator**

Confirm: first launch prompts for the passphrase → correct passphrase provisions → Positions/Orders load via Alpaca (paper) with a "paper" badge and NO `env` text; strategy dropdown shows `All`+`Unattributed` (backend down) or real strategies (backend up); Exit a held symbol flattens via Alpaca and does NOT call the backend; wrong passphrase re-prompts; relaunch (same blob) does NOT re-prompt. Re-encrypt with a changed cred → relaunch re-prompts (fingerprint changed).

- [ ] **Step 3: Commit any fixes; done.**

**Phase C complete. Broker-first-class restructure done.**

> **Reminder:** the fa-techan `broker_id` join-key change (Task B5) requires `../fa-techan`'s `/strategies/positions` to emit `broker_id`. Until then, strategies degrade to `Unattributed` (failsafe). The deferred **strategy-override** resource (design spec §6.3 / contract §7) remains future work.
