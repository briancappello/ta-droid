# Broker as a First-Class Concept — Design

**Status:** Approved design (pre-implementation).
**Supersedes coupling:** the app's direct coupling to Alpaca (`src/alpaca.ts` functions imported by every consumer) and the on-device-random `account_id`.
**Motivating trigger:** the FE↔fa-techan contract needs a stable, both-sides-known join key. See `docs/superpowers/contracts/fe-fa-techan-contract.md` §6.1.

---

## 1. Goals

1. Make **broker** a first-class object the app is built around, not an Alpaca-shaped assumption baked into every file.
2. Use the **broker's own account id** (Alpaca `account_number`) as the primary key for accounts and as the fa-techan join key — replacing the current on-device random id.
3. Support **multiple brokers** via a pluggable driver layer (Alpaca is the first driver; adding a second is additive, not a rewrite).
4. Move account configuration to **build time** (single-user, self-packaged app) while keeping **secrets out of git and out of plaintext in the APK**, via passphrase-encrypted credentials provisioned into the Android Keystore.

Non-goals (explicit YAGNI): a closed/history orders UI (interface only), a broker-neutral domain type for positions/orders (keep Alpaca shapes), any runtime add/edit/delete account flow.

---

## 2. Data model

### 2.1 Broker (first-class, owns accounts)

```ts
type BrokerId = 'alpaca'; // union grows as brokers are added

interface Broker {
  id: BrokerId;
  name: string;                         // display, e.g. "Alpaca"
  hosts: { paper: string; live: string }; // broker owns host/port
  driver: BrokerClient;                 // the implementation (§2.3)
  // the driver also knows the broker's credential shape (§4)
}
```

The broker owns all broker-specific concerns: hosts, the driver, and the
paper/live routing logic. Nothing above the broker layer knows Alpaca's URLs,
headers, or env semantics.

### 2.2 Account (belongs to a broker)

```ts
interface Account {
  id: string;          // the BROKER's account id (Alpaca account_number).
                       // Primary key AND fa-techan join key.
  name: string;        // display
  broker: BrokerId;    // reverse-reference to its Broker
  is_paper: boolean;   // replaces the old `env`; the driver uses it to route
                       // host + credentials. Passed inside `account`.
  // credentials are NOT stored on Account — retrieved from Keystore by the
  // driver, keyed by `${broker}:${id}` (§4).
}
```

`env: 'paper' | 'live'` is **removed** from the shared model. Paper/live is now
`account.is_paper`, consumed only inside the driver.

### 2.3 Driver interface

Driver methods take `account` first (matching today's `alpaca.ts` call shape).
The driver reads `account.broker` + `account.is_paper` to pick host and creds.

```ts
type OrderStatus = 'open' | 'closed' | 'all';

interface OrderFilter {
  status?: OrderStatus; // default 'open' (preserves current behavior)
  after?: string;       // ISO 8601 — orders submitted at/after
  until?: string;       // ISO 8601 — orders submitted at/before
  limit?: number;       // cap results
}

interface BrokerClient {
  listPositions(account: Account): Promise<Position[]>;
  listOrders(account: Account, filter?: OrderFilter): Promise<Order[]>;
  createOrder(account: Account, req: NewOrderRequest): Promise<Order>;
  closePosition(account: Account, symbol: string): Promise<void>;
}
```

`listOrders` generalizes the old `listOpenOrders`. The Alpaca driver maps the
filter to `GET /v2/orders` query params (`status`, `after`, `until`, `limit`),
which Alpaca supports natively. `listOrders(account)` / `{status:'open'}`
reproduces today's open-orders behavior. **Scope: interface only** — no
closed/history UI is built now; `OrdersScreen` calls `{ status: 'open' }`.

### 2.4 Registry

```ts
const brokers: Record<BrokerId, Broker>; // 'alpaca' is the sole entry today

function driverFor(account: Account): BrokerClient; // = brokers[account.broker].driver
```

Consumers resolve a driver via `driverFor(account)` instead of importing
`alpaca.ts` functions by name.

### 2.5 Payload types

`AlpacaPosition` / `AlpacaOrder` / `NewOrderRequest` are **renamed** to neutral
`Position` / `Order` / `NewOrderRequest` with **identical fields** (still
`avg_entry_price`, `unrealized_pl`, `limit_price`, `status`, `submitted_at`,
etc.). A future non-Alpaca driver maps its responses into these shapes. This
keeps `book.ts`, the screens, and `flatten.ts` unchanged apart from imports.
These types live in `src/broker.ts` and are re-exported for consumers.

---

## 3. Failsafe & security invariants (unchanged, restated)

- All position/order reads and writes go **device → broker directly** through
  the driver. They MUST work with the fa-techan backend down. Never gate a
  broker action on backend availability.
- Secrets never cross the fa-techan boundary and never appear in logs. Catch
  blocks log only `e.message` / `AlpacaError.status`.
- The driver layer preserves `AlpacaError` (or a broker-neutral error carrying
  `status` + safe `message`); `messageForStatus` mapping stays.

---

## 4. Credentials, encryption, and provisioning

### 4.1 Threat model (explicit)

Single-user, sideloaded, private APK on the developer's own phone. **Anything
shipped inside the APK in plaintext is recoverable** (`unzip && strings`).
Therefore credentials are shipped **encrypted**, and decrypted on-device with a
passphrase only the developer knows. Security rests entirely on passphrase
strength (the salt ships in the APK); a strong passphrase + Argon2id makes
brute-forcing the APK impractical. This is accepted for single-user.

### 4.2 What ships in the APK

- **Non-secret account config** — `broker`, `id` (broker account number),
  `name`, `is_paper` per account — injected via the existing
  `react-native-config` mechanism, in the clear (non-secret).
- **Encrypted credentials blob** — the per-account Alpaca `{key, secret}` set,
  encrypted at build time:
  - **KDF:** Argon2id (libsodium) from a build-time **passphrase** + random salt.
  - **Cipher:** libsodium `secretbox` (XSalsa20-Poly1305, authenticated).
  - Shipped: **ciphertext + salt + nonce**. Never the passphrase, never plaintext.
- **`credentialsFingerprint`** — a hash of the shipped ciphertext blob
  (non-secret; a hash of already-encrypted bytes leaks nothing). Drives
  re-provisioning (§4.4).

### 4.3 Build tooling

A small build-side script (Node, using a libsodium binding matching
`react-native-libsodium`) reads the developer's local plaintext creds + a
passphrase and emits the ciphertext/salt/nonce + fingerprint into the injected
config. The plaintext creds live only in a git-ignored local source and never
enter git or the APK.

**New dependency:** `react-native-libsodium` (device) + its build-side
counterpart (the encrypt script).

### 4.4 Provisioning — *provision iff fingerprint changed*

Credentials are copied from the encrypted blob into the Android Keystore
(`react-native-keychain`, hardware-backed at rest) only when the shipped
`credentialsFingerprint` differs from the one last provisioned. The fingerprint
— not the app version — is the sole trigger.

On launch:

1. Read the last-provisioned fingerprint from Keystore.
2. Compare to the shipped fingerprint:
   - **No stored fingerprint** (fresh install) → provision.
   - **Shipped ≠ stored** (creds changed in this build) → re-provision.
   - **Equal** → normal launch; read creds from Keystore; no prompt (even across
     app-version bumps that didn't touch creds).
3. **Provision** = prompt for passphrase → re-derive key (Argon2id + shipped
   salt) → decrypt blob **in memory** → write each account's plaintext creds to
   Keystore keyed `${broker}:${account.id}` → store the shipped fingerprint →
   discard in-memory plaintext.
4. Wrong passphrase → decryption fails (authenticated cipher) → re-prompt. No
   lockout (single-user).

Runtime after provisioning: drivers read creds from Keystore only, keyed
`${broker}:${account.id}`. The passphrase is never persisted.

### 4.5 Provisioning gate

`AccountContext` gates the app on provisioning: on launch it runs the
fingerprint check and, if provisioning is needed, presents the passphrase
prompt before the account list is usable. Once provisioned, accounts load from
config (non-secret) + Keystore (creds).

---

## 5. Consumer migration (blast radius)

| File | Change |
|---|---|
| `src/broker.ts` (new) | `BrokerId`, `Broker`, `BrokerClient`, `OrderFilter`, `Position`/`Order`/`NewOrderRequest`, registry, `driverFor`. |
| `src/alpaca.ts` | Becomes the **Alpaca driver** (`alpacaDriver: BrokerClient`). Keeps `AlpacaError`, header/JSON logic, `messageForStatus`. Host from broker `hosts` + `account.is_paper`. `AlpacaEnv`/`env`/`alpacaBaseUrl(env)` removed/reworked. `listOrders` maps `OrderFilter`→query params. |
| `src/accounts.ts` | Config from build-time `react-native-config` (non-secret) + Keystore (creds). Drops runtime add/edit/delete and on-device `newId()`. `Account` gains `broker`/`is_paper`; `id` = broker account number. |
| `src/provisioning.ts` (new) | Fingerprint check + passphrase → decrypt → Keystore flow (libsodium). |
| `src/AccountContext.tsx` | Loads accounts from config + Keystore; provisioning gate (§4.5). |
| `src/flatten.ts` | `listPositions`/`createOrder` via `driverFor(account)`. `NewOrderRequest` from `broker.ts`. |
| `PositionsScreen` | Resolve driver; `listPositions` via driver. |
| `OrdersScreen` | Resolve driver; `listOrders(account, { status: 'open' })`. No visible change. |
| `ChartScreen` | `holdingsForSymbol`/order entry via driver (through `flatten.ts`/driver). |
| `ExitScreen` | Flatten via driver (through `flatten.ts`). |
| `AccountsScreen` | **Read-only** list: name, broker, paper/live badge, account id. No add/edit/delete, no provisioning button (provisioning is automatic). |
| `src/strategyTagger.ts` | Join key → `${broker}:${account.id}:${symbol}`. |
| Tests | Repoint `../alpaca` fn mocks to the driver; account fixtures gain `broker`/`is_paper`, drop `env`. Add provisioning + broker-registry + `listOrders` filter tests. |

---

## 6. fa-techan contract update

Join key becomes **`(broker_id, account_id, symbol)`** (was `account_id, symbol`).

- `GET /strategies/positions` rows: `{ broker_id, account_id, symbol, strategy }`.
- `POST /exits` body: `{ broker_id, symbol, account_ids: string[] }` — where
  `account_ids` are broker account numbers **for that `broker_id`**. (If a single
  flatten ever spans multiple brokers, the FE sends one POST per broker so each
  payload is unambiguous.)
- Tagger joins on `${broker}:${account.id}:${symbol}`.
- Update `docs/superpowers/contracts/fe-fa-techan-contract.md` §4.2, §4.5, and
  resolve §6.1 (join key = broker id + broker account number).

---

## 7. Testing strategy

- **Broker layer:** registry resolution (`driverFor`), Alpaca driver host/cred
  routing by `is_paper`, `listOrders` filter→query-param mapping, error mapping
  preserved.
- **Provisioning (pure-testable seam):** fingerprint compare logic
  (fresh/changed/equal → provision/re-provision/skip) as a pure function; the
  decrypt→Keystore effect wrapped thinly around it. Passphrase-failure path.
  Do NOT put real secrets in tests; use fixture blobs.
- **Migration safety:** existing `book.ts`/screen/`flatten.ts` tests keep
  passing with driver-mocked calls and updated account fixtures.
- **Failsafe preserved:** driver-down still degrades exactly as today (Alpaca
  errors surface via `AlpacaError.message`; fa-techan enrichment independent).
- **Security:** no test or catch logs a key/secret/credential blob.

---

## 8. Open items to settle at plan time (not design-blocking)

- Exact `react-native-libsodium` API calls + the build-side encrypt script
  shape (argon2id params: memlimit/opslimit).
- Precise Keystore service-name scheme for creds vs. fingerprint entries.
- Whether the neutral payload types get their own module or re-export from
  `broker.ts` (leaning re-export from `broker.ts`).
- Migration ordering (broker layer + types first, then provisioning, then
  consumer repointing, then contract/tagger) — for the implementation plan.
