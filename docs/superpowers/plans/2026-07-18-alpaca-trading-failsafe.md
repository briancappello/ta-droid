# Alpaca Trading Failsafe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a device-resident failsafe to monitor and manage Alpaca orders and positions directly from the app, for use when the primary backend is down.

**Architecture:** The app calls the Alpaca Trading REST API directly (never through the existing `api/v1` backend), so it keeps working during a backend outage. A `fetch`-based `src/alpaca.ts` client sends per-account auth headers and selects the paper/live host from each account's `env`. Accounts (name/key/secret/env) are stored with secrets encrypted at rest via `react-native-keychain`. A drawer navigator adds Trading and Accounts screens alongside the existing Portfolio/Chart stack.

**Tech Stack:** React Native 0.84, TypeScript, `fetch`, Jest (`preset: react-native`), `@react-navigation/drawer`, `react-native-keychain`.

## Global Constraints

- **No backend proxy for Alpaca.** All Alpaca calls go device→Alpaca directly. Market data (quotes/history) still uses the existing backend; do not route it through Alpaca.
- **Secrets never in plaintext.** API key/secret live only in `react-native-keychain`. They must never be written to `AsyncStorage`, logs, or the non-secret metadata blob.
- **Hosts:** `paper` → `https://paper-api.alpaca.markets`, `live` → `https://api.alpaca.markets`. Trading API is v2 (`/v2/...`).
- **Auth headers:** `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`.
- **Style conventions (match existing code):** functional components, inline `StyleSheet.create`, dark palette `#1a1a2e` (bg) / `#16213e` (panel) / `#2196f3` (accent) / `#4caf50` (up) / `#f44336` (down). Dropdowns use the `Modal`-overlay pattern from `ChartScreen`'s `FreqDropdown`. Prettier config: single quotes, trailing commas, 2-space indent.
- **Node:** >= 22.11.0. Tests run with `npm test`; lint with `npm run lint`.

---

### Task 1: Alpaca client foundation — types, host/header resolution, `listPositions`

**Files:**
- Create: `src/alpaca.ts`
- Test: `__tests__/alpaca.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type AlpacaEnv = 'paper' | 'live'`
  - `type Account = { id: string; name: string; key: string; secret: string; env: AlpacaEnv }`
  - `type AlpacaPosition = { symbol: string; qty: string; avg_entry_price: string; market_value: string; unrealized_pl: string; side: string; current_price: string }`
  - `class AlpacaError extends Error { status: number }` — thrown on non-OK responses, `message` is a user-facing string.
  - `function alpacaBaseUrl(env: AlpacaEnv): string`
  - `function alpacaHeaders(account: Account): Record<string, string>`
  - `async function listPositions(account: Account): Promise<AlpacaPosition[]>`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/alpaca.test.ts
import {
  alpacaBaseUrl,
  alpacaHeaders,
  listPositions,
  AlpacaError,
  type Account,
} from '../src/alpaca';

const paperAccount: Account = {
  id: '1',
  name: 'Paper',
  key: 'PKEY',
  secret: 'PSECRET',
  env: 'paper',
};
const liveAccount: Account = { ...paperAccount, id: '2', name: 'IRA', env: 'live' };

afterEach(() => {
  jest.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

test('alpacaBaseUrl picks host by env', () => {
  expect(alpacaBaseUrl('paper')).toBe('https://paper-api.alpaca.markets');
  expect(alpacaBaseUrl('live')).toBe('https://api.alpaca.markets');
});

test('alpacaHeaders sets auth headers from account', () => {
  expect(alpacaHeaders(paperAccount)).toEqual({
    'APCA-API-KEY-ID': 'PKEY',
    'APCA-API-SECRET-KEY': 'PSECRET',
    'Content-Type': 'application/json',
  });
});

test('listPositions calls the env host with auth headers and returns parsed positions', async () => {
  const spy = mockFetch(200, [
    { symbol: 'AAPL', qty: '100', avg_entry_price: '189.20' },
  ]);
  const result = await listPositions(liveAccount);
  expect(spy).toHaveBeenCalledWith(
    'https://api.alpaca.markets/v2/positions',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ 'APCA-API-KEY-ID': 'PKEY' }),
    }),
  );
  expect(result[0].symbol).toBe('AAPL');
});

test('listPositions throws AlpacaError with a friendly message on 401', async () => {
  mockFetch(401, { message: 'unauthorized' });
  await expect(listPositions(paperAccount)).rejects.toMatchObject({
    status: 401,
    message: expect.stringContaining('API keys'),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- alpaca.test.ts`
Expected: FAIL — cannot find module `../src/alpaca`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/alpaca.ts
export type AlpacaEnv = 'paper' | 'live';

export type Account = {
  id: string;
  name: string;
  key: string;
  secret: string;
  env: AlpacaEnv;
};

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  side: string;
  current_price: string;
};

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AlpacaError';
    this.status = status;
  }
}

export function alpacaBaseUrl(env: AlpacaEnv): string {
  return env === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
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

async function alpacaRequest<T>(
  account: Account,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${alpacaBaseUrl(account.env)}${path}`, {
      method: init.method,
      headers: alpacaHeaders(account),
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new AlpacaError(0, "Can't reach Alpaca — check your connection.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AlpacaError(response.status, messageForStatus(response.status, text));
  }
  return response.json() as Promise<T>;
}

export async function listPositions(account: Account): Promise<AlpacaPosition[]> {
  return alpacaRequest<AlpacaPosition[]>(account, '/v2/positions');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- alpaca.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/alpaca.ts __tests__/alpaca.test.ts
git commit -m "feat: add Alpaca client foundation with listPositions"
```

---

### Task 2: Alpaca orders + close-position endpoints

**Files:**
- Modify: `src/alpaca.ts`
- Test: `__tests__/alpaca.test.ts`

**Interfaces:**
- Consumes (from Task 1): `Account`, `alpacaRequest`, `AlpacaError`.
- Produces:
  - `type OrderSide = 'buy' | 'sell'`
  - `type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop'`
  - `type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'opg' | 'cls'`
  - `type AlpacaOrder = { id: string; symbol: string; qty: string | null; notional: string | null; side: OrderSide; type: OrderType; time_in_force: TimeInForce; limit_price: string | null; stop_price: string | null; trail_percent: string | null; status: string }`
  - `type NewOrderRequest = { symbol: string; side: OrderSide; type: OrderType; time_in_force: TimeInForce; qty?: string; notional?: string; limit_price?: string; stop_price?: string; trail_percent?: string; extended_hours?: boolean }`
  - `type ReplaceOrderRequest = { qty?: string; time_in_force?: TimeInForce; limit_price?: string; stop_price?: string; trail?: string }`
  - `async function listOpenOrders(account: Account): Promise<AlpacaOrder[]>`
  - `async function createOrder(account: Account, req: NewOrderRequest): Promise<AlpacaOrder>`
  - `async function replaceOrder(account: Account, id: string, req: ReplaceOrderRequest): Promise<AlpacaOrder>`
  - `async function cancelOrder(account: Account, id: string): Promise<void>`
  - `async function closePosition(account: Account, symbol: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** (append to `__tests__/alpaca.test.ts`)

```ts
import {
  listOpenOrders,
  createOrder,
  replaceOrder,
  cancelOrder,
  closePosition,
} from '../src/alpaca';

test('listOpenOrders requests only open orders', async () => {
  const spy = mockFetch(200, []);
  await listOpenOrders(paperAccount);
  expect(spy).toHaveBeenCalledWith(
    'https://paper-api.alpaca.markets/v2/orders?status=open',
    expect.objectContaining({ method: 'GET' }),
  );
});

test('createOrder POSTs the order body', async () => {
  const spy = mockFetch(200, { id: 'o1', symbol: 'AAPL' });
  await createOrder(liveAccount, {
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    time_in_force: 'day',
    qty: '10',
    limit_price: '190',
  });
  const [, init] = spy.mock.calls[0];
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toMatchObject({
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    qty: '10',
    limit_price: '190',
  });
});

test('replaceOrder PATCHes to the order id', async () => {
  const spy = mockFetch(200, { id: 'o1' });
  await replaceOrder(paperAccount, 'o1', { qty: '5' });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('https://paper-api.alpaca.markets/v2/orders/o1');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body as string)).toEqual({ qty: '5' });
});

test('cancelOrder DELETEs the order id', async () => {
  const spy = mockFetch(204, {});
  await cancelOrder(paperAccount, 'o1');
  expect(spy).toHaveBeenCalledWith(
    'https://paper-api.alpaca.markets/v2/orders/o1',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

test('closePosition DELETEs the position symbol', async () => {
  const spy = mockFetch(200, { id: 'o2' });
  await closePosition(liveAccount, 'TSLA');
  expect(spy).toHaveBeenCalledWith(
    'https://api.alpaca.markets/v2/positions/TSLA',
    expect.objectContaining({ method: 'DELETE' }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- alpaca.test.ts`
Expected: FAIL — `listOpenOrders`/`createOrder`/etc. are not exported.

- [ ] **Step 3: Write minimal implementation**

First, make `alpacaRequest` tolerate empty (204 / no-body) responses so `cancelOrder`/`closePosition` don't choke on `.json()`. Update the end of `alpacaRequest` in `src/alpaca.ts`:

```ts
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AlpacaError(response.status, messageForStatus(response.status, text));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
```

(Remove the old `return response.json() as Promise<T>;` line.)

Then append the new types and functions to `src/alpaca.ts`:

```ts
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'opg' | 'cls';

export type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string | null;
  notional: string | null;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price: string | null;
  stop_price: string | null;
  trail_percent: string | null;
  status: string;
};

export type NewOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  trail_percent?: string;
  extended_hours?: boolean;
};

export type ReplaceOrderRequest = {
  qty?: string;
  time_in_force?: TimeInForce;
  limit_price?: string;
  stop_price?: string;
  trail?: string;
};

export async function listOpenOrders(account: Account): Promise<AlpacaOrder[]> {
  return alpacaRequest<AlpacaOrder[]>(account, '/v2/orders?status=open');
}

export async function createOrder(
  account: Account,
  req: NewOrderRequest,
): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>(account, '/v2/orders', {
    method: 'POST',
    body: req,
  });
}

export async function replaceOrder(
  account: Account,
  id: string,
  req: ReplaceOrderRequest,
): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>(account, `/v2/orders/${id}`, {
    method: 'PATCH',
    body: req,
  });
}

export async function cancelOrder(account: Account, id: string): Promise<void> {
  await alpacaRequest<void>(account, `/v2/orders/${id}`, { method: 'DELETE' });
}

export async function closePosition(
  account: Account,
  symbol: string,
): Promise<void> {
  await alpacaRequest<void>(account, `/v2/positions/${symbol}`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- alpaca.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/alpaca.ts __tests__/alpaca.test.ts
git commit -m "feat: add Alpaca orders and close-position endpoints"
```

---

### Task 3: Encrypted account store (`src/accounts.ts`)

**Files:**
- Create: `src/accounts.ts`
- Test: `__tests__/accounts.test.ts`
- Modify: `package.json` (add `react-native-keychain`)

**Interfaces:**
- Consumes (from Task 1): `Account`, `AlpacaEnv`.
- Produces:
  - `type AccountMeta = { id: string; name: string; env: AlpacaEnv }` — non-secret.
  - `async function loadAccounts(): Promise<Account[]>` — full accounts (meta + secrets), ordered.
  - `async function addAccount(input: { name: string; key: string; secret: string; env: AlpacaEnv }): Promise<Account>` — generates `id`, persists, returns the new account.
  - `async function updateAccount(account: Account): Promise<void>`
  - `async function deleteAccount(id: string): Promise<void>`

**Design notes:**
- Non-secret metadata (`AccountMeta[]`, in order) is stored as one JSON blob under keychain service `alpaca.accounts.meta`. Secrets are stored one keychain entry per account under service `alpaca.account.<id>`, with `username=key`, `password=secret`. The metadata blob MUST NOT contain `key` or `secret`.
- `react-native-keychain` API used: `setGenericPassword(username, password, { service })`, `getGenericPassword({ service })` (returns `{ username, password } | false`), `resetGenericPassword({ service })`.
- `id` generation: `Date.now().toString(36) + Math.random().toString(36).slice(2, 8)` (no new dep needed).

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install react-native-keychain
```
Expected: `react-native-keychain` added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/accounts.test.ts
import {
  loadAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
} from '../src/accounts';
import * as Keychain from 'react-native-keychain';

jest.mock('react-native-keychain');

// In-memory fake keychain keyed by service.
let store: Record<string, { username: string; password: string }>;

beforeEach(() => {
  store = {};
  (Keychain.setGenericPassword as jest.Mock).mockImplementation(
    async (username: string, password: string, opts: { service: string }) => {
      store[opts.service] = { username, password };
      return true;
    },
  );
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    async (opts: { service: string }) => store[opts.service] ?? false,
  );
  (Keychain.resetGenericPassword as jest.Mock).mockImplementation(
    async (opts: { service: string }) => {
      delete store[opts.service];
      return true;
    },
  );
});

test('addAccount persists and loadAccounts returns it with secrets', async () => {
  const created = await addAccount({
    name: 'Paper',
    key: 'PKEY',
    secret: 'PSECRET',
    env: 'paper',
  });
  expect(created.id).toBeTruthy();
  const loaded = await loadAccounts();
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({
    name: 'Paper',
    key: 'PKEY',
    secret: 'PSECRET',
    env: 'paper',
  });
});

test('the metadata blob never contains secrets', async () => {
  await addAccount({ name: 'IRA', key: 'LKEY', secret: 'LSECRET', env: 'live' });
  const metaBlob = store['alpaca.accounts.meta'].password;
  expect(metaBlob).not.toContain('LKEY');
  expect(metaBlob).not.toContain('LSECRET');
});

test('updateAccount changes name/env and secrets', async () => {
  const a = await addAccount({
    name: 'Old',
    key: 'K',
    secret: 'S',
    env: 'paper',
  });
  await updateAccount({ ...a, name: 'New', env: 'live', secret: 'S2' });
  const loaded = await loadAccounts();
  expect(loaded[0]).toMatchObject({ name: 'New', env: 'live', secret: 'S2' });
});

test('deleteAccount removes meta and secret entry', async () => {
  const a = await addAccount({
    name: 'Temp',
    key: 'K',
    secret: 'S',
    env: 'paper',
  });
  await deleteAccount(a.id);
  expect(await loadAccounts()).toHaveLength(0);
  expect(store[`alpaca.account.${a.id}`]).toBeUndefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- accounts.test.ts`
Expected: FAIL — cannot find module `../src/accounts`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/accounts.ts
import * as Keychain from 'react-native-keychain';
import type { Account, AlpacaEnv } from './alpaca';

export type AccountMeta = { id: string; name: string; env: AlpacaEnv };

const META_SERVICE = 'alpaca.accounts.meta';
const secretService = (id: string) => `alpaca.account.${id}`;

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function loadMeta(): Promise<AccountMeta[]> {
  const entry = await Keychain.getGenericPassword({ service: META_SERVICE });
  if (!entry) {
    return [];
  }
  try {
    return JSON.parse(entry.password) as AccountMeta[];
  } catch {
    return [];
  }
}

async function saveMeta(meta: AccountMeta[]): Promise<void> {
  await Keychain.setGenericPassword('meta', JSON.stringify(meta), {
    service: META_SERVICE,
  });
}

export async function loadAccounts(): Promise<Account[]> {
  const meta = await loadMeta();
  const accounts: Account[] = [];
  for (const m of meta) {
    const secret = await Keychain.getGenericPassword({
      service: secretService(m.id),
    });
    if (!secret) {
      continue;
    }
    accounts.push({
      id: m.id,
      name: m.name,
      env: m.env,
      key: secret.username,
      secret: secret.password,
    });
  }
  return accounts;
}

export async function addAccount(input: {
  name: string;
  key: string;
  secret: string;
  env: AlpacaEnv;
}): Promise<Account> {
  const id = newId();
  await Keychain.setGenericPassword(input.key, input.secret, {
    service: secretService(id),
  });
  const meta = await loadMeta();
  meta.push({ id, name: input.name, env: input.env });
  await saveMeta(meta);
  return { id, name: input.name, env: input.env, key: input.key, secret: input.secret };
}

export async function updateAccount(account: Account): Promise<void> {
  await Keychain.setGenericPassword(account.key, account.secret, {
    service: secretService(account.id),
  });
  const meta = await loadMeta();
  const idx = meta.findIndex(m => m.id === account.id);
  const next = { id: account.id, name: account.name, env: account.env };
  if (idx >= 0) {
    meta[idx] = next;
  } else {
    meta.push(next);
  }
  await saveMeta(meta);
}

export async function deleteAccount(id: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: secretService(id) });
  const meta = (await loadMeta()).filter(m => m.id !== id);
  await saveMeta(meta);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- accounts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/accounts.ts __tests__/accounts.test.ts package.json package-lock.json
git commit -m "feat: add encrypted account store via react-native-keychain"
```

---

### Task 4: Order form validation (pure function)

**Files:**
- Create: `src/orderValidation.ts`
- Test: `__tests__/orderValidation.test.ts`

**Interfaces:**
- Consumes (from Task 1/2): `OrderType`, `OrderSide`, `TimeInForce`, `NewOrderRequest`.
- Produces:
  - `type OrderFormValues = { symbol: string; side: OrderSide; type: OrderType; time_in_force: TimeInForce; qty: string; notional: string; limit_price: string; stop_price: string; trail_percent: string; extended_hours: boolean; useNotional: boolean }`
  - `function validateOrderForm(v: OrderFormValues): string[]` — returns list of human-readable error strings; empty means valid.
  - `function toNewOrderRequest(v: OrderFormValues): NewOrderRequest` — assumes validated; builds the request, omitting price fields not relevant to the type and choosing qty vs notional.

**Rules:**
- `symbol` required (non-empty after trim).
- Exactly one of qty/notional per `useNotional`; the chosen one must parse to a positive number.
- `limit` and `stop_limit` require a positive `limit_price`.
- `stop` and `stop_limit` require a positive `stop_price`.
- `trailing_stop` requires a positive `trail_percent`.
- `market` requires neither price.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/orderValidation.test.ts
import {
  validateOrderForm,
  toNewOrderRequest,
  type OrderFormValues,
} from '../src/orderValidation';

const base: OrderFormValues = {
  symbol: 'AAPL',
  side: 'buy',
  type: 'market',
  time_in_force: 'day',
  qty: '10',
  notional: '',
  limit_price: '',
  stop_price: '',
  trail_percent: '',
  extended_hours: false,
  useNotional: false,
};

test('valid market order has no errors', () => {
  expect(validateOrderForm(base)).toEqual([]);
});

test('missing symbol is an error', () => {
  expect(validateOrderForm({ ...base, symbol: '  ' })).toContain(
    'Symbol is required.',
  );
});

test('non-positive qty is an error', () => {
  expect(validateOrderForm({ ...base, qty: '0' })).toContain(
    'Quantity must be a positive number.',
  );
});

test('limit order requires a limit price', () => {
  const errs = validateOrderForm({ ...base, type: 'limit', limit_price: '' });
  expect(errs).toContain('Limit price is required for limit orders.');
});

test('stop_limit requires both prices', () => {
  const errs = validateOrderForm({
    ...base,
    type: 'stop_limit',
    limit_price: '',
    stop_price: '',
  });
  expect(errs.length).toBeGreaterThanOrEqual(2);
});

test('trailing_stop requires trail percent', () => {
  expect(
    validateOrderForm({ ...base, type: 'trailing_stop', trail_percent: '' }),
  ).toContain('Trail percent is required for trailing stop orders.');
});

test('toNewOrderRequest builds a limit request with qty and omits stop', () => {
  const req = toNewOrderRequest({
    ...base,
    type: 'limit',
    limit_price: '190',
  });
  expect(req).toEqual({
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    time_in_force: 'day',
    qty: '10',
    limit_price: '190',
    extended_hours: false,
  });
});

test('toNewOrderRequest uses notional when useNotional is set', () => {
  const req = toNewOrderRequest({
    ...base,
    useNotional: true,
    qty: '',
    notional: '500',
  });
  expect(req.notional).toBe('500');
  expect(req.qty).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orderValidation.test.ts`
Expected: FAIL — cannot find module `../src/orderValidation`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/orderValidation.ts
import type {
  NewOrderRequest,
  OrderSide,
  OrderType,
  TimeInForce,
} from './alpaca';

export type OrderFormValues = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  qty: string;
  notional: string;
  limit_price: string;
  stop_price: string;
  trail_percent: string;
  extended_hours: boolean;
  useNotional: boolean;
};

function isPositive(s: string): boolean {
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
}

const needsLimit = (t: OrderType) => t === 'limit' || t === 'stop_limit';
const needsStop = (t: OrderType) => t === 'stop' || t === 'stop_limit';
const needsTrail = (t: OrderType) => t === 'trailing_stop';

export function validateOrderForm(v: OrderFormValues): string[] {
  const errors: string[] = [];
  if (!v.symbol.trim()) {
    errors.push('Symbol is required.');
  }
  if (v.useNotional) {
    if (!isPositive(v.notional)) {
      errors.push('Notional must be a positive number.');
    }
  } else if (!isPositive(v.qty)) {
    errors.push('Quantity must be a positive number.');
  }
  if (needsLimit(v.type) && !isPositive(v.limit_price)) {
    errors.push('Limit price is required for limit orders.');
  }
  if (needsStop(v.type) && !isPositive(v.stop_price)) {
    errors.push('Stop price is required for stop orders.');
  }
  if (needsTrail(v.type) && !isPositive(v.trail_percent)) {
    errors.push('Trail percent is required for trailing stop orders.');
  }
  return errors;
}

export function toNewOrderRequest(v: OrderFormValues): NewOrderRequest {
  const req: NewOrderRequest = {
    symbol: v.symbol.trim().toUpperCase(),
    side: v.side,
    type: v.type,
    time_in_force: v.time_in_force,
    extended_hours: v.extended_hours,
  };
  if (v.useNotional) {
    req.notional = v.notional;
  } else {
    req.qty = v.qty;
  }
  if (needsLimit(v.type)) {
    req.limit_price = v.limit_price;
  }
  if (needsStop(v.type)) {
    req.stop_price = v.stop_price;
  }
  if (needsTrail(v.type)) {
    req.trail_percent = v.trail_percent;
  }
  return req;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- orderValidation.test.ts`
Expected: PASS.

Note: the `market`-with-qty test expects `toNewOrderRequest(base)` to equal an object with `qty` and no price fields — verify the base market case too if you extend the tests.

- [ ] **Step 5: Commit**

```bash
git add src/orderValidation.ts __tests__/orderValidation.test.ts
git commit -m "feat: add order form validation and request builder"
```

---

### Task 5: Active-account context + persistence

**Files:**
- Create: `src/AccountContext.tsx`
- Test: `__tests__/accountContext.test.tsx`

**Interfaces:**
- Consumes (from Task 1/3): `Account`, `loadAccounts`.
- Produces:
  - `function AccountProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `function useAccounts(): { accounts: Account[]; activeId: string | null; activeAccount: Account | null; setActiveId: (id: string) => void; reload: () => Promise<void>; loading: boolean }`
- The provider loads accounts on mount via `loadAccounts()`, tracks `activeId` (defaults to the first account), and persists the active id under keychain service `alpaca.active` so it survives restarts. `reload()` re-reads accounts (called after add/edit/delete).

**Design notes:**
- Reuse `react-native-keychain` for the active-id persistence (`setGenericPassword('active', id, { service: 'alpaca.active' })`) to avoid adding `AsyncStorage`. This is not a secret, but keychain is already available.
- If the persisted `activeId` no longer matches any loaded account, fall back to the first account (or `null` if none).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/accountContext.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { AccountProvider, useAccounts } from '../src/AccountContext';
import * as accounts from '../src/accounts';
import * as Keychain from 'react-native-keychain';

jest.mock('react-native-keychain');
jest.mock('../src/accounts');

const A = { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' as const };
const B = { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', env: 'live' as const };

function Probe({ onReady }: { onReady: (v: ReturnType<typeof useAccounts>) => void }) {
  const v = useAccounts();
  onReady(v);
  return <Text>{v.activeAccount?.name ?? 'none'}</Text>;
}

beforeEach(() => {
  (accounts.loadAccounts as jest.Mock).mockResolvedValue([A, B]);
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
});

test('provider loads accounts and defaults active to the first', async () => {
  let latest: ReturnType<typeof useAccounts> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <AccountProvider>
        <Probe onReady={v => (latest = v)} />
      </AccountProvider>,
    );
  });
  expect(latest!.accounts).toHaveLength(2);
  expect(latest!.activeAccount?.id).toBe('a');
});

test('setActiveId switches the active account', async () => {
  let latest: ReturnType<typeof useAccounts> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <AccountProvider>
        <Probe onReady={v => (latest = v)} />
      </AccountProvider>,
    );
  });
  await act(async () => {
    latest!.setActiveId('b');
  });
  expect(latest!.activeAccount?.id).toBe('b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- accountContext.test.tsx`
Expected: FAIL — cannot find module `../src/AccountContext`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/AccountContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as Keychain from 'react-native-keychain';
import type { Account } from './alpaca';
import { loadAccounts } from './accounts';

const ACTIVE_SERVICE = 'alpaca.active';

type Ctx = {
  accounts: Account[];
  activeId: string | null;
  activeAccount: Account | null;
  setActiveId: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
};

const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const loaded = await loadAccounts();
    setAccounts(loaded);
    const persisted = await Keychain.getGenericPassword({
      service: ACTIVE_SERVICE,
    });
    const persistedId = persisted ? persisted.password : null;
    const valid = loaded.find(a => a.id === persistedId);
    setActiveIdState(valid ? valid.id : loaded[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    Keychain.setGenericPassword('active', id, {
      service: ACTIVE_SERVICE,
    }).catch(() => {});
  }, []);

  const activeAccount = accounts.find(a => a.id === activeId) ?? null;

  return (
    <AccountCtx.Provider
      value={{ accounts, activeId, activeAccount, setActiveId, reload, loading }}
    >
      {children}
    </AccountCtx.Provider>
  );
}

export function useAccounts(): Ctx {
  const ctx = useContext(AccountCtx);
  if (!ctx) {
    throw new Error('useAccounts must be used within AccountProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- accountContext.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/AccountContext.tsx __tests__/accountContext.test.tsx
git commit -m "feat: add active-account context with persistence"
```

---

### Task 6: `AccountPicker` dropdown component

**Files:**
- Create: `src/components/AccountPicker.tsx`
- Test: `__tests__/accountPicker.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `Account`.
- Produces:
  - `function AccountPicker({ accounts, selectedId, onSelect }: { accounts: Account[]; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element`
- Renders a button showing the selected account's `name` + env label (`· PAPER` / `· LIVE`) and a `▼`. Tapping opens a `Modal` overlay list (reuse the `FreqDropdown` pattern from `ChartScreen.tsx:527-584`). Selecting an item calls `onSelect(id)` and closes. Shows `Select account ▼` when `selectedId` is null.

**Design notes:** Copy the `Modal` + overlay + item styles from `ChartScreen`'s `FreqDropdown`/`dropdownOverlay`/`dropdownMenu`/`dropdownItem` styles. Keep styles inline in this file.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/accountPicker.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccountPicker } from '../src/components/AccountPicker';

const accounts = [
  { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' as const },
  { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', env: 'live' as const },
];

test('renders the selected account name and env', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountPicker accounts={accounts} selectedId="b" onSelect={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('IRA');
  expect(json).toContain('LIVE');
});

test('shows a placeholder when nothing is selected', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountPicker accounts={accounts} selectedId={null} onSelect={() => {}} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Select account');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- accountPicker.test.tsx`
Expected: FAIL — cannot find module `../src/components/AccountPicker`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/AccountPicker.tsx
import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Account } from '../alpaca';

function label(a: Account): string {
  return `${a.name} · ${a.env.toUpperCase()}`;
}

export function AccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: Account[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find(a => a.id === selectedId) ?? null;

  return (
    <View>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText}>
          {selected ? label(selected) : 'Select account'} ▼
        </Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.menu}>
            {accounts.map(a => (
              <TouchableOpacity
                key={a.id}
                style={[styles.item, a.id === selectedId && styles.itemActive]}
                onPress={() => {
                  onSelect(a.id);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.itemText,
                    a.id === selectedId && styles.itemTextActive,
                  ]}
                >
                  {label(a)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#1a1a2e',
  },
  buttonText: { color: '#2196f3', fontSize: 13, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 200,
    overflow: 'hidden',
  },
  item: { paddingVertical: 12, paddingHorizontal: 20 },
  itemActive: { backgroundColor: '#2196f3' },
  itemText: { color: '#ccc', fontSize: 14 },
  itemTextActive: { color: '#ffffff', fontWeight: 'bold' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- accountPicker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AccountPicker.tsx __tests__/accountPicker.test.tsx
git commit -m "feat: add AccountPicker dropdown component"
```

---

### Task 7: Drawer navigation + wire up the hamburger

**Files:**
- Modify: `App.tsx`
- Modify: `src/screens/PortfolioScreen.tsx` (wire the `☰` to open the drawer)
- Modify: `package.json` (add `@react-navigation/drawer`, `react-native-gesture-handler`, `react-native-reanimated`)
- Modify: `index.js` (import `react-native-gesture-handler` at the very top — required by the drawer)
- Modify: `babel.config.js` (add `react-native-reanimated/plugin` as the last plugin)
- Test: none new (covered by the existing `__tests__/App.test.tsx` smoke render).

**Interfaces:**
- Consumes (from Task 5): `AccountProvider`.
- Produces:
  - `type RootDrawerParamList = { PortfolioStack: undefined; Trading: undefined; Accounts: undefined }` exported from `App.tsx`.
  - The existing `RootStackParamList` gains: `OrderEntry: { accountId?: string; symbol?: string; order?: import('./src/alpaca').AlpacaOrder }`.
- Existing stack (Portfolio + Chart + OrderEntry) becomes a nested stack navigator (`PortfolioStack`) rendered as one drawer screen. `Trading` and `Accounts` are the other drawer screens (created in Tasks 8-10 — until then, stub components so the app compiles).

**Design notes:**
- Wrap everything in `<AccountProvider>` inside `SafeAreaProvider`.
- The drawer is the top-level navigator inside `NavigationContainer`.
- `react-native-gesture-handler` and `react-native-reanimated` are peer deps of the drawer; the reanimated Babel plugin and the gesture-handler top-of-`index.js` import are mandatory setup steps.
- For the drawer to open from Portfolio, pass navigation down: Portfolio's `HeaderBar` menu icon calls `navigation.getParent()?.openDrawer()` (or `navigation.openDrawer()` if typed for the drawer). Add an `onMenuPress` prop to `HeaderBar` and wire the existing `☰` (`PortfolioScreen.tsx:53`).

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install @react-navigation/drawer react-native-gesture-handler react-native-reanimated
```
Expected: three packages added to `dependencies`.

- [ ] **Step 2: Wire required native setup**

In `index.js`, add as the FIRST line (before any other import):
```js
import 'react-native-gesture-handler';
```

In `babel.config.js`, add `'react-native-reanimated/plugin'` as the LAST entry of `plugins` (create the `plugins` array if absent):
```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-reanimated/plugin'],
};
```

- [ ] **Step 3: Add stub screens so the app compiles**

Create `src/screens/TradingScreen.tsx` and `src/screens/AccountsScreen.tsx` as temporary stubs (replaced in Tasks 8-10):
```tsx
import React from 'react';
import { Text, View } from 'react-native';
export default function TradingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
      <Text style={{ color: '#fff', padding: 16 }}>Trading</Text>
    </View>
  );
}
```
(Same shape for `AccountsScreen.tsx` with the label `Accounts`.)

- [ ] **Step 4: Rewrite `App.tsx` with the drawer**

```tsx
/**
 * Stock Portfolio App
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PortfolioScreen from './src/screens/PortfolioScreen';
import ChartScreen from './src/screens/ChartScreen';
import OrderEntryScreen from './src/screens/OrderEntryScreen';
import TradingScreen from './src/screens/TradingScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import { AccountProvider } from './src/AccountContext';
import type { AlpacaOrder } from './src/alpaca';

export type RootStackParamList = {
  Portfolio: undefined;
  Chart: { ticker: string };
  OrderEntry: { accountId?: string; symbol?: string; order?: AlpacaOrder };
};

export type RootDrawerParamList = {
  PortfolioStack: undefined;
  Trading: undefined;
  Accounts: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<RootDrawerParamList>();

const stackScreenOptions = {
  headerStyle: { backgroundColor: '#1a1a2e' },
  headerTintColor: '#ffffff',
  headerTitleStyle: { fontWeight: 'bold' as const },
  contentStyle: { backgroundColor: '#1a1a2e' },
};

function PortfolioStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chart"
        component={ChartScreen}
        options={({ route }) => ({ title: route.params.ticker })}
      />
      <Stack.Screen
        name="OrderEntry"
        component={OrderEntryScreen}
        options={{ title: 'Order' }}
      />
    </Stack.Navigator>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <AccountProvider>
        <NavigationContainer>
          <Drawer.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: '#1a1a2e' },
              headerTintColor: '#ffffff',
              drawerStyle: { backgroundColor: '#16213e' },
              drawerActiveTintColor: '#2196f3',
              drawerInactiveTintColor: '#ccc',
            }}
          >
            <Drawer.Screen
              name="PortfolioStack"
              component={PortfolioStack}
              options={{ title: 'Portfolio', headerShown: false }}
            />
            <Drawer.Screen name="Trading" component={TradingScreen} />
            <Drawer.Screen name="Accounts" component={AccountsScreen} />
          </Drawer.Navigator>
        </NavigationContainer>
      </AccountProvider>
    </SafeAreaProvider>
  );
}

export default App;
```

- [ ] **Step 5: Wire the hamburger in `PortfolioScreen.tsx`**

Add `onMenuPress` to `HeaderBar` props and use it on the menu icon:
```tsx
function HeaderBar({
  onAddPress,
  onRefreshPress,
  onMenuPress,
}: {
  onAddPress: () => void;
  onRefreshPress: () => void;
  onMenuPress: () => void;
}) {
  return (
    <View style={styles.headerBar}>
      <TouchableOpacity onPress={onMenuPress}>
        <Text style={styles.headerMenuIcon}>☰</Text>
      </TouchableOpacity>
      {/* ...rest unchanged... */}
```
In the screen body, pass:
```tsx
<HeaderBar
  onAddPress={() => setModalVisible(true)}
  onRefreshPress={refreshQuotes}
  onMenuPress={() => navigation.getParent()?.openDrawer()}
/>
```

- [ ] **Step 6: Run the smoke test + lint**

Run: `npm test -- App.test.tsx && npm run lint`
Expected: App test PASSES (renders without throwing), lint clean.

- [ ] **Step 7: Commit**

```bash
git add App.tsx index.js babel.config.js package.json package-lock.json src/screens/PortfolioScreen.tsx src/screens/TradingScreen.tsx src/screens/AccountsScreen.tsx
git commit -m "feat: add drawer navigation and wire hamburger menu"
```

---

### Task 8: AccountsScreen (add / edit / delete)

**Files:**
- Replace stub: `src/screens/AccountsScreen.tsx`
- Test: `__tests__/accountsScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccounts` (Task 5), `addAccount`/`updateAccount`/`deleteAccount` (Task 3), `Account`/`AlpacaEnv` (Task 1).
- Produces: default-exported `AccountsScreen` component.

**Behavior:**
- Header row: `☰` (calls `navigation.openDrawer()`), title "Accounts", `＋` opens an add/edit modal.
- `FlatList` of `accounts` from `useAccounts()`; each row shows `name`, env badge (`PAPER`/`LIVE`), and a masked secret hint (`••••` + last 4 of key). Row tap → edit modal; a "Delete" affordance per row (with a `confirm` step via `Alert.alert`).
- Add/edit modal fields: name (`TextInput`), key, secret (masked, `secureTextEntry`), env toggle (two buttons Paper/Live). Save calls `addAccount` or `updateAccount`, then `reload()` from context, then closes.
- Empty state: "No accounts yet. Tap ＋ to add one."
- Reuse the `Modal` overlay styling from `PortfolioScreen`'s `AddTickerModal` and the dark palette.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/accountsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import AccountsScreen from '../src/screens/AccountsScreen';
import * as ctx from '../src/AccountContext';

jest.mock('../src/AccountContext');

test('renders the accounts list from context', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [
      { id: 'a', name: 'Paper', key: 'ABCD1234', secret: 'S', env: 'paper' },
    ],
    activeId: 'a',
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountsScreen navigation={{ openDrawer: () => {} } as any} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Paper');
});

test('renders the empty state with no accounts', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [],
    activeId: null,
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountsScreen navigation={{ openDrawer: () => {} } as any} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('No accounts');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- accountsScreen.test.tsx`
Expected: FAIL — stub has no "Paper"/"No accounts" text.

- [ ] **Step 3: Implement `AccountsScreen`**

Implement per the Behavior section (full component below):

```tsx
import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccounts } from '../AccountContext';
import { addAccount, updateAccount, deleteAccount } from '../accounts';
import type { Account, AlpacaEnv } from '../alpaca';

type Draft = {
  id: string | null;
  name: string;
  key: string;
  secret: string;
  env: AlpacaEnv;
};

const EMPTY_DRAFT: Draft = { id: null, name: '', key: '', secret: '', env: 'paper' };

export default function AccountsScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { accounts, reload } = useAccounts();
  const [modalVisible, setModalVisible] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setModalVisible(true);
  };
  const openEdit = (a: Account) => {
    setDraft({ id: a.id, name: a.name, key: a.key, secret: a.secret, env: a.env });
    setModalVisible(true);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.key.trim() || !draft.secret.trim()) {
      Alert.alert('Missing fields', 'Name, key, and secret are required.');
      return;
    }
    if (draft.id) {
      await updateAccount({
        id: draft.id,
        name: draft.name.trim(),
        key: draft.key.trim(),
        secret: draft.secret.trim(),
        env: draft.env,
      });
    } else {
      await addAccount({
        name: draft.name.trim(),
        key: draft.key.trim(),
        secret: draft.secret.trim(),
        env: draft.env,
      });
    }
    await reload();
    setModalVisible(false);
  };

  const remove = (a: Account) =>
    Alert.alert('Delete account', `Delete "${a.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteAccount(a.id);
          await reload();
        },
      },
    ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Accounts</Text>
        <TouchableOpacity onPress={openAdd}>
          <Text style={styles.add}>＋</Text>
        </TouchableOpacity>
      </View>
      {accounts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No accounts yet. Tap ＋ to add one.</Text>
        </View>
      ) : (
        <FlatList
          data={accounts}
          keyExtractor={a => a.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openEdit(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowSub}>
                  {item.env.toUpperCase()} · ••••{item.key.slice(-4)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(item)}>
                <Text style={styles.delete}>Delete</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {draft.id ? 'Edit Account' : 'Add Account'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor="#666"
              value={draft.name}
              onChangeText={t => setDraft(d => ({ ...d, name: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="API Key ID"
              placeholderTextColor="#666"
              autoCapitalize="none"
              value={draft.key}
              onChangeText={t => setDraft(d => ({ ...d, key: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="API Secret"
              placeholderTextColor="#666"
              autoCapitalize="none"
              secureTextEntry
              value={draft.secret}
              onChangeText={t => setDraft(d => ({ ...d, secret: t }))}
            />
            <View style={styles.envRow}>
              {(['paper', 'live'] as AlpacaEnv[]).map(e => (
                <TouchableOpacity
                  key={e}
                  style={[styles.envBtn, draft.env === e && styles.envBtnActive]}
                  onPress={() => setDraft(d => ({ ...d, env: e }))}
                >
                  <Text
                    style={[
                      styles.envText,
                      draft.env === e && styles.envTextActive,
                    ]}
                  >
                    {e.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  menuIcon: { color: '#fff', fontSize: 22 },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: 'bold' },
  add: { color: '#fff', fontSize: 22 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#888', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  rowName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  rowSub: { color: '#999', fontSize: 12, marginTop: 2 },
  delete: { color: '#f44336', fontSize: 13, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '88%',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  input: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    fontSize: 16,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  envRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  envBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  envBtnActive: { backgroundColor: '#2196f3', borderColor: '#2196f3' },
  envText: { color: '#aaa', fontWeight: '600' },
  envTextActive: { color: '#fff' },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  cancel: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2196f3',
  },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- accountsScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/AccountsScreen.tsx __tests__/accountsScreen.test.tsx
git commit -m "feat: add AccountsScreen with add/edit/delete"
```

---

### Task 9: TradingScreen (Positions + Open Orders tabs)

**Files:**
- Replace stub: `src/screens/TradingScreen.tsx`
- Test: `__tests__/tradingScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccounts` (Task 5), `AccountPicker` (Task 6), `listPositions`/`listOpenOrders`/`cancelOrder`/`closePosition`/`AlpacaError` (Tasks 1-2).
- Produces: default-exported `TradingScreen` (drawer screen). Navigates to `OrderEntry` via `navigation.navigate('PortfolioStack', { screen: 'OrderEntry', params: {...} })` (nested navigation into the stack).

**Behavior:**
- Header: `☰` (openDrawer) + `AccountPicker` bound to `activeId`/`setActiveId`.
- Tab bar `POSITIONS` / `OPEN ORDERS` reusing the `PortfolioScreen` TabBar pattern.
- On focus and on active-account change, fetch the active tab's data. Pull-to-refresh (`RefreshControl`) + a refresh button.
- Positions rows: symbol, qty @ avg entry, market value, unrealized P/L (green/red). Row tap → `Alert.alert` action sheet: "Close position" (calls `closePosition`, then refetch) / "New order" (navigate to OrderEntry with `symbol`, `accountId`).
- Orders rows: symbol, side/type, qty, limit/stop price, status. Row tap → `Alert.alert`: "Modify" (navigate to OrderEntry with `order`, `accountId`) / "Cancel order" (calls `cancelOrder`, then refetch).
- Error → inline red banner with the `AlpacaError.message`; write actions show a brief pending state.
- Empty active account → "Add an account to start trading." (link to Accounts drawer item).
- Floating `＋ New Order` button → navigate to OrderEntry with `accountId` = active.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/tradingScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import TradingScreen from '../src/screens/TradingScreen';
import * as ctx from '../src/AccountContext';
import * as alpaca from '../src/alpaca';

jest.mock('../src/AccountContext');
jest.mock('../src/alpaca');

const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [{ id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' }],
    activeId: 'a',
    activeAccount: { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' },
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (alpaca.listPositions as jest.Mock).mockResolvedValue([
    {
      symbol: 'AAPL',
      qty: '100',
      avg_entry_price: '189.20',
      market_value: '19000',
      unrealized_pl: '1240',
      side: 'long',
      current_price: '190',
    },
  ]);
  (alpaca.listOpenOrders as jest.Mock).mockResolvedValue([]);
});

test('renders positions for the active account', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<TradingScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('AAPL');
});

test('prompts to add an account when none is active', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [],
    activeId: null,
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<TradingScreen navigation={nav} />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Add an account');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tradingScreen.test.tsx`
Expected: FAIL — stub renders neither "AAPL" nor "Add an account".

- [ ] **Step 3: Implement `TradingScreen`**

Implement per the Behavior section. Structure guidance:
- State: `tab: 'POSITIONS' | 'ORDERS'`, `positions`, `orders`, `loading`, `error`, `refreshing`.
- `load = useCallback(async () => {...})` depending on `activeAccount` and `tab`; wrap calls in try/catch, set `error = e instanceof AlpacaError ? e.message : 'Something went wrong.'`.
- Use `useFocusEffect(useCallback(() => { load(); }, [load]))` from `@react-navigation/native` to refetch on focus.
- Reuse `TabBar`-style tabs and `StockRow`-style rows (colors: `#4caf50` positive, `#f44336` negative) inline in this file.
- Navigate to order entry:
  ```tsx
  navigation.navigate('PortfolioStack', {
    screen: 'OrderEntry',
    params: { accountId: activeId, symbol },
  });
  ```
- Guard: if `!activeAccount`, render the "Add an account to start trading." view and skip fetching.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tradingScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/TradingScreen.tsx __tests__/tradingScreen.test.tsx
git commit -m "feat: add TradingScreen with positions and open orders"
```

---

### Task 10: OrderEntryScreen (create / modify + review)

**Files:**
- Create: `src/screens/OrderEntryScreen.tsx`
- Test: `__tests__/orderEntryScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccounts` (Task 5), `AccountPicker` (Task 6), `validateOrderForm`/`toNewOrderRequest`/`OrderFormValues` (Task 4), `createOrder`/`replaceOrder`/`AlpacaError`/`AlpacaOrder` (Tasks 1-2). Route params `OrderEntry: { accountId?; symbol?; order? }` (Task 7).
- Produces: default-exported `OrderEntryScreen` component.

**Behavior:**
- On mount, seed `OrderFormValues` from route params: `symbol` from `params.symbol` or `params.order.symbol`; if `params.order` present → **modify mode**.
- **Account selection:** an `AccountPicker` at the top, defaulting to `params.accountId ?? activeId`. In modify mode the account is fixed to the order's account (picker disabled/hidden) since replace targets the same account.
- Fields per spec: Side (Buy/Sell buttons), Qty/Notional (toggle `useNotional`), Type dropdown (Market/Limit/Stop/Stop-Limit/Trailing), conditional Limit/Stop/Trail inputs, Time-in-force dropdown (Day/GTC/IOC/FOK/OPG/CLS), Extended-hours toggle.
- **Modify mode restriction (spec):** symbol, side, and type are shown read-only; only qty, time_in_force, limit_price, stop_price, trail are editable. Submit calls `replaceOrder(account, order.id, {...})` with only those fields.
- **Review & Submit:** tapping Submit runs `validateOrderForm`; if errors, show them inline (red). If valid, open a confirmation `Modal` listing symbol, side, qty/notional, type, price(s), TIF, and target account name. Confirm → `createOrder`/`replaceOrder`. On success, `Alert` + `navigation.goBack()`. On `AlpacaError`, show `.message` inline and keep the form.
- Show a pending state on the submit button during the request.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/orderEntryScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import OrderEntryScreen from '../src/screens/OrderEntryScreen';
import * as ctx from '../src/AccountContext';

jest.mock('../src/AccountContext');
jest.mock('../src/alpaca');

const account = { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' as const };

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [account],
    activeId: 'a',
    activeAccount: account,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
});

test('renders a New Order form with the symbol from params', async () => {
  const route = { params: { accountId: 'a', symbol: 'AAPL' } } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <OrderEntryScreen route={route} navigation={nav} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('AAPL');
});

test('modify mode shows read-only symbol from the order', async () => {
  const route = {
    params: {
      accountId: 'a',
      order: {
        id: 'o1',
        symbol: 'TSLA',
        qty: '10',
        notional: null,
        side: 'buy',
        type: 'limit',
        time_in_force: 'day',
        limit_price: '240',
        stop_price: null,
        trail_percent: null,
        status: 'new',
      },
    },
  } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <OrderEntryScreen route={route} navigation={nav} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('TSLA');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orderEntryScreen.test.tsx`
Expected: FAIL — cannot find module `../src/screens/OrderEntryScreen`.

- [ ] **Step 3: Implement `OrderEntryScreen`**

Implement per the Behavior section. Structure guidance:
- Build initial `OrderFormValues` from params in `useState`'s initializer.
- Modify mode = `Boolean(route.params?.order)`.
- Resolve the target `Account` from `accounts.find(a => a.id === selectedAccountId)`.
- Type and TIF selectors reuse the `Modal`-dropdown pattern (or inline button rows).
- `onSubmit`: `const errs = validateOrderForm(values); if (errs.length) { setErrors(errs); return; } setReviewVisible(true);`
- `onConfirm`: try `createOrder`/`replaceOrder`; on success `Alert.alert('Order submitted'); navigation.goBack();` catch → `setSubmitError(e instanceof AlpacaError ? e.message : 'Failed to submit order.')`.
- For modify: build `ReplaceOrderRequest` from editable fields only (`qty`, `time_in_force`, `limit_price`, `stop_price`, `trail`).
- Reuse dark palette + input styles from AccountsScreen.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- orderEntryScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/OrderEntryScreen.tsx __tests__/orderEntryScreen.test.tsx
git commit -m "feat: add OrderEntryScreen with create/modify and review step"
```

---

### Task 11: Launch order entry from ChartScreen

**Files:**
- Modify: `src/screens/ChartScreen.tsx`

**Interfaces:**
- Consumes: route/navigation typed by `RootStackParamList` (Task 7, now includes `OrderEntry`), `useAccounts` (Task 5).
- Produces: no new exports; adds a "Trade" button to the chart toolbar.

**Behavior:**
- Add a `Trade` button to the `toolbar` `View` that calls `navigation.navigate('OrderEntry', { symbol: ticker, accountId: activeId })`.
- `ChartScreen`'s `Props` already come from `NativeStackScreenProps<RootStackParamList, 'Chart'>`, so `navigation.navigate('OrderEntry', ...)` is typed once Task 7 adds `OrderEntry` to `RootStackParamList`.
- Pull `activeId` from `useAccounts()`.

- [ ] **Step 1: Add the button and handler**

In `ChartScreen`, import `useAccounts`, read `const { activeId } = useAccounts();`, and add to the toolbar (after `FreqDropdown`):
```tsx
<TouchableOpacity
  style={styles.tradeButton}
  onPress={() =>
    navigation.navigate('OrderEntry', { symbol: ticker, accountId: activeId ?? undefined })
  }
>
  <Text style={styles.tradeButtonText}>Trade</Text>
</TouchableOpacity>
```
Add `navigation` to the destructured props: `export default function ChartScreen({ route, navigation }: Props)`.
Add styles:
```tsx
  tradeButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#2196f3',
  },
  tradeButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
```

- [ ] **Step 2: Verify it compiles and existing tests pass**

Run: `npm test && npm run lint`
Expected: all tests PASS, lint clean.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ChartScreen.tsx
git commit -m "feat: launch order entry from chart screen"
```

---

### Task 12: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all suites PASS (alpaca, accounts, orderValidation, accountContext, accountPicker, App, accountsScreen, tradingScreen, orderEntryScreen).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke checklist (device/emulator)**

Verify against a **paper** account first:
- Add a paper account in Accounts; it appears in the list and the Trading picker.
- Trading → Positions and Open Orders load; pull-to-refresh works.
- Create a limit order via ＋ New Order → Review → Submit; it appears under Open Orders.
- Modify that order (change qty); Cancel it.
- Close a position (if any).
- Launch order entry from a chart's Trade button; symbol pre-filled.
- Kill the backend (or point `API_BASE_URL` at a dead host) and confirm Trading still works (proves the failsafe is backend-independent).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: verification fixes for Alpaca trading feature"
```

---

