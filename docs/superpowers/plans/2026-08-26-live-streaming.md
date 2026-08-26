# Live Streaming (WebSocket) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live streaming over MarketStore `/ws` — watchlists that re-rank live with prices, and charts whose latest candle builds in realtime and rolls a new candle each period.

**Architecture:** MarketStore's watchlist plugin already streams `watchlist_update` (full re-ranked list) and per-symbol `bar` messages; it just lacks price in the ranking. Part 1 adds price to the ranking (flows to both WS and REST). The app gains one shared WebSocket client (`src/marketstoreStream.ts`) with a union-of-subscriptions registry and reconnect, consumed by the Watchlists and Chart screens.

**Tech Stack:** Go (MarketStore), React Native + TypeScript, `react-native-config`, lightweight-charts (in a WebView), Jest.

## Global Constraints

- **`/ws` JSON subprotocol.** Connect with `['json']`. Messages are
  `{"key":"<TBK>","data":{"msg_type":<type>,"payload":<obj>}}`.
- **Subscribe replaces the whole set.** `{"action":"subscribe","tbks":[...]}` —
  the client always sends the full union of active TBKs and resends it after a
  reconnect.
- **TBK format** `Symbol/Timeframe/AttributeGroup`. Watchlist ranking key is
  `WATCHLISTS/1Min/{NAME}` (worker timeframe is hardcoded `1Min`). Bars are
  `SYMBOL/1Min/OHLCV` and `SYMBOL/1Sec/OHLCV`.
- **`bar` payload** `{symbol,open,high,low,close,volume,epoch}`; the forming bar
  is pushed repeatedly with a constant `epoch` (period start) then a new epoch
  at the boundary.
- **`watchlist_update` payload** `{name,timeframe,symbols:[{symbol,rank,<fields...>,sector?}]}`
  — fields are flattened onto each symbol object (WS), or nested under `fields`
  in REST. After Part 1 the symbol fields include `price` and `prior_close`
  (omitted for aggregate rows with no tradeable symbol).
- **WS URL** derives from `MARKETSTORE_BASE_URL` (`http`→`ws`, `https`→`wss`) + `/ws`.
- **Streaming is additive.** A closed socket leaves the REST-populated screen
  intact; it must never blank a screen or throw into React.
- **Baseline is green.** Full app suite currently 33 suites / 117 tests; MarketStore
  `go test ./frontend/... ./contrib/watchlist/...` green.

---

### Task 1: MarketStore — attach `price` + `prior_close` to watchlist rankings

**Files:**
- Modify: `contrib/watchlist/framework/rankings.go` (inject fields in `RunRankings`)
- Test: `contrib/watchlist/framework/integration_test.go` (append a test)

**Interfaces:**
- Consumes: `SymbolState.LastPrice`, `SymbolState.PriorClose` (existing);
  `RunRankings(mgr) map[string][]RankedSymbol` (existing).
- Produces: each non-aggregate ranked symbol carries `Field{Key:"price"}` and
  `Field{Key:"prior_close"}`, so the WS `watchlist_update` payload gains
  `price`/`prior_close` per symbol and the REST `/v1/watchlists` gains
  `fields.price`/`fields.prior_close`. No boundary-type changes.

- [ ] **Step 1: Write the failing test** (append to `contrib/watchlist/framework/integration_test.go`)

```go
func TestWatchlistRankingIncludesPrice(t *testing.T) {
	h := newTestHarness(t)
	framework.Manager.SetCurator(&mockCurator{allowed: nil})
	framework.Manager.AddStrategy(&mockWatchlist{
		name: "TEST_GAINERS",
		rankFn: func(curated map[string]*framework.SymbolState) []framework.RankedSymbol {
			out := make([]framework.RankedSymbol, 0, len(curated))
			for sym, state := range curated {
				out = append(out, framework.RankedSymbol{
					Symbol: sym,
					Fields: []framework.Field{{Key: "pct_change", Value: state.PctChange}},
				})
			}
			return out
		},
	})

	conn, ch := h.connectAndSubscribe("WATCHLISTS/1Min/*")
	defer conn.Close()
	time.Sleep(50 * time.Millisecond)

	baseTime := time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC)
	aapl := framework.Manager.GetOrCreate("AAPL")
	aapl.PriorClose = 100
	// close=104 -> LastPrice becomes 104 after the bar fires.
	h.writeOHLCVAndFire("AAPL", baseTime, 101, 105, 100, 104, 50000)

	h.worker.TriggerRanking()
	msgs := collectMessages(ch, 500*time.Millisecond)

	found := false
	for _, msg := range msgs {
		if msg["msg_type"] != "watchlist_update" {
			continue
		}
		payload, _ := msg["payload"].(map[string]interface{})
		symbols, _ := payload["symbols"].([]interface{})
		for _, s := range symbols {
			m, _ := s.(map[string]interface{})
			if m["symbol"] == "AAPL" {
				found = true
				assert.EqualValues(t, 104, m["price"])
				assert.EqualValues(t, 100, m["prior_close"])
			}
		}
	}
	assert.True(t, found, "AAPL watchlist_update should carry price/prior_close")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ../marketstore && go test ./contrib/watchlist/framework/ -run TestWatchlistRankingIncludesPrice -count=1`
Expected: FAIL — `m["price"]` is nil (no price field yet).

- [ ] **Step 3: Inject the fields in `RunRankings`**

In `contrib/watchlist/framework/rankings.go`, the `RunRankings` loop currently
sets `ranking[i].Rank = i + 1`. Replace that inner loop body with:

```go
		for i := range ranking {
			ranking[i].Rank = i + 1
			// Attach latest price + prior close as fields so both the
			// WebSocket push (flattened) and the REST response (nested under
			// "fields") carry them. Aggregate strategies emit non-symbol rows
			// (e.g. "Industrials") absent from the curated snapshot, so those
			// get no price.
			if st, ok := curated[ranking[i].Symbol]; ok && st != nil {
				ranking[i].Fields = append(ranking[i].Fields,
					Field{Key: "price", Value: st.LastPrice},
					Field{Key: "prior_close", Value: st.PriorClose},
				)
			}
		}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ../marketstore && go test ./contrib/watchlist/framework/ -run TestWatchlistRankingIncludesPrice -count=1`
Expected: PASS.

- [ ] **Step 5: Run the watchlist + REST suites for regressions**

Run: `cd ../marketstore && go test ./contrib/watchlist/... ./frontend/ -count=1`
Expected: PASS (REST watchlist rendering picks up the new fields automatically via `convertRanking`).

- [ ] **Step 6: Commit**

```bash
cd ../marketstore
git add contrib/watchlist/framework/rankings.go contrib/watchlist/framework/integration_test.go
git commit -m "feat(watchlist): attach price + prior_close to rankings"
```

### Task 2: App — shared WebSocket stream client

**Files:**
- Create: `src/marketstoreStream.ts`
- Create: `__tests__/marketstoreStream.test.ts`

**Interfaces:**
- Consumes: `Config.MARKETSTORE_BASE_URL`; a `WebSocketLike` (RN global `WebSocket`
  in prod, a mock in tests).
- Produces:
  - `type StreamMessage = { key: string; data: { msg_type: string; payload: any } }`
  - `wsUrl(): string`
  - `createStreamClient(opts?): StreamClient` where
    `StreamClient = { subscribe(tbks: string[], onMessage: (m: StreamMessage) => void): () => void }`
  - `stream: StreamClient` — shared singleton used by screens.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/marketstoreStream.test.ts`:

```ts
import { createStreamClient, wsUrl, type WebSocketLike } from '../src/marketstoreStream';

type MockSocket = WebSocketLike & {
  sent: string[];
  openIt: () => void;
  fire: (msg: unknown) => void;
  drop: () => void;
};

function makeMockSocket(): MockSocket {
  const s: MockSocket = {
    sent: [],
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(d: string) {
      this.sent.push(d);
    },
    close() {},
    openIt() {
      this.onopen && this.onopen();
    },
    fire(msg: unknown) {
      this.onmessage && this.onmessage({ data: JSON.stringify(msg) });
    },
    drop() {
      this.onclose && this.onclose();
    },
  };
  return s;
}

test('wsUrl converts the http(s) base to ws(s) + /ws', () => {
  // jest.setup mock: MARKETSTORE_BASE_URL = https://ms.test
  expect(wsUrl()).toBe('wss://ms.test/ws');
});

test('subscribe opens a json socket and sends the union of tbks on open', () => {
  const sock = makeMockSocket();
  const client = createStreamClient({ url: 'ws://x/ws', factory: () => sock });
  client.subscribe(['WATCHLISTS/1Min/MOMENTUM'], () => {});
  sock.openIt();
  const last = JSON.parse(sock.sent[sock.sent.length - 1]);
  expect(last).toEqual({
    action: 'subscribe',
    tbks: ['WATCHLISTS/1Min/MOMENTUM'],
  });
});

test('dispatches a payload to the key handler and ignores the ack', () => {
  const sock = makeMockSocket();
  const client = createStreamClient({ url: 'ws://x/ws', factory: () => sock });
  const seen: any[] = [];
  client.subscribe(['AAPL/1Min/OHLCV'], m => seen.push(m));
  sock.openIt();
  sock.fire({ action: 'subscribed', tbks: ['AAPL/1Min/OHLCV'] });
  sock.fire({ key: 'AAPL/1Min/OHLCV', data: { msg_type: 'bar', payload: { close: 5 } } });
  expect(seen).toHaveLength(1);
  expect(seen[0].data.payload.close).toBe(5);
});

test('a second subscriber for another key extends the union', () => {
  const sock = makeMockSocket();
  const client = createStreamClient({ url: 'ws://x/ws', factory: () => sock });
  client.subscribe(['A/1Min/OHLCV'], () => {});
  sock.openIt();
  client.subscribe(['B/1Min/OHLCV'], () => {});
  const last = JSON.parse(sock.sent[sock.sent.length - 1]);
  expect(last.tbks.sort()).toEqual(['A/1Min/OHLCV', 'B/1Min/OHLCV']);
});

test('unsubscribe removes the tbk from the union', () => {
  const sock = makeMockSocket();
  const client = createStreamClient({ url: 'ws://x/ws', factory: () => sock });
  const off = client.subscribe(['A/1Min/OHLCV'], () => {});
  sock.openIt();
  off();
  const last = JSON.parse(sock.sent[sock.sent.length - 1]);
  expect(last.tbks).toEqual([]);
});

test('reconnects with backoff and resubscribes on reopen', () => {
  jest.useFakeTimers();
  const sockets: MockSocket[] = [];
  const factory = () => {
    const s = makeMockSocket();
    sockets.push(s);
    return s;
  };
  const client = createStreamClient({
    url: 'ws://x/ws',
    factory,
    backoff: () => 10,
  });
  client.subscribe(['A/1Min/OHLCV'], () => {});
  sockets[0].openIt();
  sockets[0].drop(); // connection lost
  jest.advanceTimersByTime(10);
  expect(sockets).toHaveLength(2); // reconnected
  sockets[1].openIt();
  const last = JSON.parse(sockets[1].sent[sockets[1].sent.length - 1]);
  expect(last).toEqual({ action: 'subscribe', tbks: ['A/1Min/OHLCV'] });
  jest.useRealTimers();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- marketstoreStream`
Expected: FAIL — `Cannot find module '../src/marketstoreStream'`.

- [ ] **Step 3: Write the implementation**

Create `src/marketstoreStream.ts`:

```ts
import Config from 'react-native-config';

export type StreamMessage = {
  key: string;
  data: { msg_type: string; payload: any };
};

type Handler = (m: StreamMessage) => void;

// Minimal shape shared by RN's global WebSocket and the test mock.
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: any }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: any) => void) | null;
}

export type WSFactory = (url: string, protocols: string[]) => WebSocketLike;

export type StreamClient = {
  subscribe(tbks: string[], onMessage: Handler): () => void;
};

export function wsUrl(): string {
  const base = Config.MARKETSTORE_BASE_URL!;
  return base.replace(/^http/, 'ws') + '/ws';
}

export function createStreamClient(
  opts: {
    factory?: WSFactory;
    url?: string;
    backoff?: (attempt: number) => number;
  } = {},
): StreamClient {
  const factory: WSFactory =
    opts.factory ??
    ((u, p) => new WebSocket(u, p) as unknown as WebSocketLike);
  const url = opts.url ?? wsUrl();
  const backoff = opts.backoff ?? (a => Math.min(1000 * 2 ** a, 15000));

  const counts = new Map<string, number>(); // tbk -> refcount
  const handlers = new Map<string, Set<Handler>>(); // tbk -> handlers
  let ws: WebSocketLike | null = null;
  let open = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const union = () => Array.from(counts.keys());

  function sendSubscribe() {
    if (ws && open) {
      ws.send(JSON.stringify({ action: 'subscribe', tbks: union() }));
    }
  }

  function connect() {
    if (ws || counts.size === 0) {
      return;
    }
    ws = factory(url, ['json']);
    ws.onopen = () => {
      open = true;
      attempt = 0;
      sendSubscribe();
    };
    ws.onmessage = e => {
      let m: StreamMessage;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      // Ignore subscribe acks / error envelopes (no key).
      if (!m || (m as any).action || !m.key) {
        return;
      }
      handlers.get(m.key)?.forEach(h => h(m));
    };
    ws.onclose = onDrop;
    ws.onerror = onDrop;
  }

  function onDrop() {
    open = false;
    ws = null;
    if (counts.size > 0 && timer == null) {
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, backoff(attempt++));
    }
  }

  function subscribe(tbks: string[], onMessage: Handler): () => void {
    for (const tbk of tbks) {
      counts.set(tbk, (counts.get(tbk) ?? 0) + 1);
      let set = handlers.get(tbk);
      if (!set) {
        set = new Set();
        handlers.set(tbk, set);
      }
      set.add(onMessage);
    }
    connect();
    sendSubscribe();

    return () => {
      for (const tbk of tbks) {
        const n = (counts.get(tbk) ?? 1) - 1;
        if (n <= 0) {
          counts.delete(tbk);
        } else {
          counts.set(tbk, n);
        }
        const set = handlers.get(tbk);
        if (set) {
          set.delete(onMessage);
          if (set.size === 0) {
            handlers.delete(tbk);
          }
        }
      }
      sendSubscribe();
    };
  }

  return { subscribe };
}

// Shared singleton for app screens. Inert until the first subscribe().
export const stream = createStreamClient();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- marketstoreStream`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/marketstoreStream.ts __tests__/marketstoreStream.test.ts
git commit -m "feat: shared MarketStore WebSocket stream client with reconnect"
```

### Task 3: App — Watchlists live streaming

**Files:**
- Modify: `src/watchlists.ts` (add row type, mapper, stream key, REST entries fetch; remove now-dead `fetchWatchlistSymbols`)
- Modify: `src/screens/WatchlistsScreen.tsx` (subscribe + render price/pct)
- Modify: `__tests__/watchlists.test.ts` (mapper test)
- Modify: `__tests__/watchlistsScreen.test.tsx` (stream mock + assertions)

**Interfaces:**
- Consumes: `stream` (Task 2); `getWatchlist` (existing `src/marketstore.ts`).
- Produces (in `src/watchlists.ts`):
  - `type WatchRow = { symbol: string; price: number | null; change: number | null; changePct: number | null }`
  - `toWatchRow(s: any): WatchRow`
  - `watchlistStreamKey(id: string): string` → `WATCHLISTS/1Min/{id}`
  - `fetchWatchlistEntries(id: string): Promise<WatchRow[]>`

- [ ] **Step 1: Write the failing mapper tests** (append to `__tests__/watchlists.test.ts`)

```ts
import { toWatchRow, watchlistStreamKey } from '../src/watchlists';

test('toWatchRow reads flattened stream fields (price + pct_change)', () => {
  const row = toWatchRow({ symbol: 'AAPL', price: 104, prior_close: 100, pct_change: 4 });
  expect(row).toEqual({ symbol: 'AAPL', price: 104, change: 4, changePct: 4 });
});

test('toWatchRow falls back to avg_pct_change and null price for aggregates', () => {
  const row = toWatchRow({ symbol: 'Industrials', avg_pct_change: 8.07 });
  expect(row).toEqual({ symbol: 'Industrials', price: null, change: null, changePct: 8.07 });
});

test('watchlistStreamKey builds the WATCHLISTS/1Min key', () => {
  expect(watchlistStreamKey('MOMENTUM')).toBe('WATCHLISTS/1Min/MOMENTUM');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- watchlists.test`
Expected: FAIL — `toWatchRow`/`watchlistStreamKey` are not exported.

- [ ] **Step 3: Implement in `src/watchlists.ts`**

First delete the now-dead `fetchWatchlistSymbols` (its only caller was the
watchlist screen's old quotes effect, replaced in Step 5):

```ts
// Remove this function — no callers remain after Step 5.
export async function fetchWatchlistSymbols(id: string): Promise<string[]> {
  const wl = await getWatchlist(id);
  return wl.entries.map(e => e.symbol);
}
```

Then append to `src/watchlists.ts`:

```ts
export type WatchRow = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
};

// Maps a flattened ranked-symbol object (WS watchlist_update symbol, or a REST
// entry with its `fields` spread in) to a display row. Aggregates lack a
// tradeable price and use avg_pct_change.
export function toWatchRow(s: any): WatchRow {
  const price = typeof s.price === 'number' ? s.price : null;
  const prior = typeof s.prior_close === 'number' ? s.prior_close : null;
  const changePct =
    typeof s.pct_change === 'number'
      ? s.pct_change
      : typeof s.avg_pct_change === 'number'
      ? s.avg_pct_change
      : null;
  const change = price != null && prior != null ? price - prior : null;
  return { symbol: s.symbol, price, change, changePct };
}

export const watchlistStreamKey = (id: string) => `WATCHLISTS/1Min/${id}`;

// Initial REST paint. The REST watchlist nests metrics under `fields`, so
// spread them before mapping.
export async function fetchWatchlistEntries(id: string): Promise<WatchRow[]> {
  const wl = await getWatchlist(id);
  return wl.entries.map(e => toWatchRow({ symbol: e.symbol, ...e.fields }));
}
```

- [ ] **Step 4: Run to verify the mapper passes**

Run: `pnpm test -- watchlists.test`
Expected: PASS.

- [ ] **Step 5: Wire the screen** — replace the quotes effect + render in `src/screens/WatchlistsScreen.tsx`

Change the imports:

```tsx
import {
  fetchWatchlists,
  fetchWatchlistEntries,
  toWatchRow,
  watchlistStreamKey,
  type Watchlist,
  type WatchRow,
} from '../watchlists';
import { formatMoney, formatPercent } from '../format';
import { stream } from '../marketstoreStream';
```

Remove the `../api` import and the `StockQuote` state. Replace `rows` state type
and the symbols/quotes effect (`WatchlistsScreen.tsx:41-61`) with:

```tsx
  const [rows, setRows] = useState<WatchRow[]>([]);

  useEffect(() => {
    if (!selectedId) {
      setRows([]);
      return;
    }
    let alive = true;
    // Instant REST paint (already includes price + pct_change).
    fetchWatchlistEntries(selectedId)
      .then(r => {
        if (alive) {
          setRows(r);
        }
      })
      .catch(() => {});
    // Live re-ranking + prices.
    const off = stream.subscribe([watchlistStreamKey(selectedId)], msg => {
      if (msg.data.msg_type === 'watchlist_update') {
        const syms: any[] = msg.data.payload?.symbols ?? [];
        if (alive) {
          setRows(syms.map(toWatchRow));
        }
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [selectedId]);
```

Replace the row render (`WatchlistsScreen.tsx:94-116`) with:

```tsx
        {rows.map((row, i) => {
          const up = (row.changePct ?? 0) >= 0;
          const color = up ? '#4caf50' : '#f44336';
          const sign = up ? '+' : '';
          return (
            <TouchableOpacity
              key={`${row.symbol}-${i}`}
              style={styles.row}
              onPress={() =>
                navigation.navigate('ChartStack', {
                  screen: 'Chart',
                  params: { ticker: row.symbol },
                })
              }
            >
              <Text style={styles.symbol}>{row.symbol}</Text>
              <Text style={[styles.change, { color }]}>
                {row.price != null ? formatMoney(row.price) : '--'}
                {row.change != null
                  ? `  ${sign}${formatMoney(row.change, row.price ?? row.change)}`
                  : ''}
                {row.changePct != null
                  ? ` (${sign}${formatPercent(row.changePct)}%)`
                  : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
```

- [ ] **Step 6: Update the screen test** (`__tests__/watchlistsScreen.test.tsx`)

Replace the `../src/api` mock with the watchlists + stream mocks. At the top:

```tsx
import * as watchlists from '../src/watchlists';
import * as streamMod from '../src/marketstoreStream';

jest.mock('../src/BackendContext');
jest.mock('../src/watchlists');
jest.mock('../src/marketstoreStream');
```

In `beforeEach`, keep the `fetchWatchlists` mock and add:

```tsx
  (watchlists.fetchWatchlistEntries as jest.Mock).mockResolvedValue([
    { symbol: 'SMCI', price: 42, change: 2, changePct: 5 },
  ]);
  (watchlists.watchlistStreamKey as jest.Mock).mockImplementation(
    (id: string) => `WATCHLISTS/1Min/${id}`,
  );
  (watchlists.toWatchRow as jest.Mock).mockImplementation((s: any) => ({
    symbol: s.symbol,
    price: s.price ?? null,
    change: null,
    changePct: s.pct_change ?? null,
  }));
  (streamMod.stream as any).subscribe = jest.fn(() => () => {});
```

Update the first test to assert the REST-painted row shows the symbol and price:

```tsx
test('renders the selected watchlist with streamed price rows', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Breakouts');
  expect(json).toContain('SMCI');
  expect(json).toContain('42.00');
});
```

The "unavailable" test is unchanged (still keys off `fetchWatchlists` returning `[]`).

- [ ] **Step 7: Run the watchlist tests + full suite**

Run: `pnpm test -- watchlists`
Expected: PASS.
Run: `pnpm test`
Expected: PASS (whole suite; `fetchQuotes`/`apiQuoteToStockQuote` are no longer used by the watchlist screen — leave them in `src/api.ts`, still covered by `apiQuotes` tests).

- [ ] **Step 8: Commit**

```bash
git add src/watchlists.ts src/screens/WatchlistsScreen.tsx __tests__/watchlists.test.ts __tests__/watchlistsScreen.test.tsx
git commit -m "feat: live-streaming Watchlists (WATCHLISTS/1Min ranking + prices)"
```

### Task 4: App — Chart live streaming

**Files:**
- Create: `src/chartTime.ts` (pure time/bar helpers)
- Create: `__tests__/chartTime.test.ts`
- Modify: `src/screens/ChartScreen.tsx` (import helpers, `__pushBar` in HTML,
  WebView ref, subscription effect)
- Modify: `__tests__/chartScreen.test.tsx` (mock the stream)

**Interfaces:**
- Consumes: `stream` (Task 2); `freqToTimeframe` (existing `src/marketstore.ts`).
- Produces (in `src/chartTime.ts`):
  - `easternOffset(ms: number): number` — seconds offset for America/New_York.
  - `barFromBarPayload(p: any): { time:number; open:number; high:number; low:number; close:number; volume:number }`
    — maps a MarketStore `bar` payload to a lightweight-charts point in the
    chart's eastern-shifted-seconds convention.

- [ ] **Step 1: Write the failing helper tests**

Create `__tests__/chartTime.test.ts`:

```ts
import { easternOffset, barFromBarPayload } from '../src/chartTime';

test('easternOffset is -4h in summer (EDT) and -5h in winter (EST)', () => {
  expect(easternOffset(Date.UTC(2026, 6, 15, 16, 0, 0))).toBe(-4 * 3600);
  expect(easternOffset(Date.UTC(2026, 0, 15, 16, 0, 0))).toBe(-5 * 3600);
});

test('barFromBarPayload maps OHLCV and shifts epoch by the eastern offset', () => {
  const epoch = Math.floor(Date.UTC(2026, 6, 15, 16, 0, 0) / 1000); // summer
  const bar = barFromBarPayload({
    epoch,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  });
  expect(bar).toEqual({
    time: epoch + -4 * 3600,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- chartTime`
Expected: FAIL — `Cannot find module '../src/chartTime'`.

- [ ] **Step 3: Implement `src/chartTime.ts`**

```ts
// One shared formatter — constructing Intl.DateTimeFormat is expensive, and
// buildEasternOffsets calls easternOffset O(log n) times per render. Hoisted
// to module scope so we build it once, mirroring the closure the old inline
// getOffset used.
const easternFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  timeZoneName: 'shortOffset',
});

// Eastern-time offset (seconds) for a given instant, matching the chart's
// "fake-UTC shifted to Eastern" time axis. Mirrors the getOffset logic in
// ChartScreen.buildEasternOffsets so live bars align with historical bars.
export function easternOffset(ms: number): number {
  const part = easternFmt
    .formatToParts(new Date(ms))
    .find(p => p.type === 'timeZoneName');
  const match = part?.value?.match(/GMT([+-]\d+)/);
  return match ? parseInt(match[1], 10) * 3600 : -5 * 3600;
}

// Maps a MarketStore `bar` payload {symbol,open,high,low,close,volume,epoch}
// (epoch in unix seconds) to a lightweight-charts point in the chart's
// eastern-shifted-seconds convention.
export function barFromBarPayload(p: any): {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
} {
  return {
    time: p.epoch + easternOffset(p.epoch * 1000),
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: p.volume,
  };
}
```

- [ ] **Step 4: Run to verify the helpers pass**

Run: `pnpm test -- chartTime`
Expected: PASS.

- [ ] **Step 5: Add `window.__pushBar` to the chart HTML**

In `src/screens/ChartScreen.tsx`, right after `volumeSeries.setData(...)`
(`ChartScreen.tsx:388`), insert into the template string:

```js
    window.__pushBar = function (b) {
      candleSeries.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
      volumeSeries.update({ time: b.time, value: b.volume, color: b.close >= b.open ? '#4caf50' : '#f44336' });
    };
```

- [ ] **Step 6: Wire the WebView ref + subscription in the component**

Add imports at the top of `ChartScreen.tsx`:

```tsx
import { freqToTimeframe } from '../marketstore';
import { stream } from '../marketstoreStream';
import { barFromBarPayload } from '../chartTime';
```

Add `useRef` to the React import and reuse `easternOffset` in
`buildEasternOffsets` (replace its inner `const getOffset = (ms: number) => {...}`
with `const getOffset = easternOffset;` and `import { easternOffset } from '../chartTime';`).

In the component (after `const insets = useSafeAreaInsets();`), add the ref:

```tsx
  const webRef = useRef<WebView>(null);
```

Add `ref={webRef}` to the `<WebView>` element (`ChartScreen.tsx:713`).

Add a subscription effect (near the existing data-loading effect):

```tsx
  useEffect(() => {
    const key = `${ticker}/${freqToTimeframe(freq)}/OHLCV`;
    const off = stream.subscribe([key], msg => {
      if (msg.data.msg_type !== 'bar') {
        return;
      }
      const bar = barFromBarPayload(msg.data.payload);
      webRef.current?.injectJavaScript(
        `window.__pushBar && window.__pushBar(${JSON.stringify(bar)}); true;`,
      );
    });
    return off;
  }, [ticker, freq]);
```

- [ ] **Step 7: Mock the stream in the chart screen test**

In `__tests__/chartScreen.test.tsx`, add:

```tsx
jest.mock('../src/marketstoreStream', () => ({
  stream: { subscribe: jest.fn(() => () => {}) },
}));
```

Add a test asserting the chart subscribes to the ticker's bar stream:

```tsx
import { stream } from '../src/marketstoreStream';

test('subscribes to the ticker OHLCV stream', async () => {
  await act(async () => {
    ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  const keys = (stream.subscribe as jest.Mock).mock.calls.map(c => c[0][0]);
  expect(keys.some((k: string) => k.startsWith('AAPL/') && k.endsWith('/OHLCV'))).toBe(true);
});
```

(Use whatever `route`/`nav`/ticker the existing test already sets up; the
existing tests mock `../src/api`, `../src/AccountContext`, `../src/flatten`,
`react-native-webview`, and `react-native-safe-area-context` — keep those.)

- [ ] **Step 8: Run the chart tests + full suite + typecheck**

Run: `pnpm test -- "chartTime|chartScreen"`
Expected: PASS.
Run: `pnpm test`
Expected: PASS (whole suite).
Run: `pnpm tsc --noEmit`
Expected: no new `src/` errors (pre-existing test-file `global` errors remain).

- [ ] **Step 9: Commit**

```bash
git add src/chartTime.ts __tests__/chartTime.test.ts src/screens/ChartScreen.tsx __tests__/chartScreen.test.tsx
git commit -m "feat: live-streaming chart (SYMBOL/tf/OHLCV -> series.update)"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (price in ranking, WS + REST) → Task 1.
- Part 2 (WS client, union subscribe, reconnect+backoff, resubscribe) → Task 2.
- Part 3 (Watchlists live: subscribe, price+pct rows, initial REST paint) → Task 3.
- Part 4 (Chart live: forming/new candle via series.update, epoch→eastern time) → Task 4.
- Config (ws url from MARKETSTORE_BASE_URL) → Task 2 `wsUrl`.
- Graceful degradation (REST paint stands if socket down) → Task 3 initial fetch;
  reconnect never throws into React (Task 2 onDrop).

**Placeholder scan:** No TBD/TODO. Task 4 Step 7 references the existing test's
`route`/`nav` rather than repeating them — those are already defined in the file.

**Type consistency:** `StreamMessage`/`stream.subscribe` (Task 2) are consumed
with matching shapes in Tasks 3–4. `WatchRow`/`toWatchRow`/`watchlistStreamKey`/
`fetchWatchlistEntries` (Task 3) match their screen use. `barFromBarPayload`/
`easternOffset` (Task 4) match the chart wiring. Watchlist stream key
`WATCHLISTS/1Min/{id}` matches the MarketStore worker's hardcoded `1Min`
timeframe (Task 1 context).

**Deferred / verify-in-implementation:**
- Higher-timeframe streaming coverage (only 1Sec/1Min verified live). For a
  timeframe MarketStore does not stream, the chart subscription simply receives
  nothing and the chart stays static — acceptable; a follow-up can drive the
  current higher-TF candle from the 1Min stream.
- `MARKETSTORE_AUTH_TOKEN` on the WS handshake (header seam) — infra follow-up
  with the nginx `wss` termination, same as the REST auth seam.
