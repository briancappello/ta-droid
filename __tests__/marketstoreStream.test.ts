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

test('a throwing factory does not throw out of subscribe and retries via backoff', () => {
  jest.useFakeTimers();
  let calls = 0;
  const sockets: MockSocket[] = [];
  const factory = () => {
    calls++;
    if (calls === 1) {
      throw new Error('WebSocket constructor blew up');
    }
    const s = makeMockSocket();
    sockets.push(s);
    return s;
  };
  const client = createStreamClient({ url: 'ws://x/ws', factory, backoff: () => 10 });
  expect(() => client.subscribe(['A/1Min/OHLCV'], () => {})).not.toThrow();
  expect(calls).toBe(1); // first attempt threw
  expect(sockets).toHaveLength(0); // no socket yet
  jest.advanceTimersByTime(10); // backoff fires -> retry
  expect(calls).toBe(2); // factory called again
  expect(sockets).toHaveLength(1); // socket created on retry
  jest.useRealTimers();
});

test('calling one subscriber off() twice does not kill the other subscriber', () => {
  const sock = makeMockSocket();
  const client = createStreamClient({ url: 'ws://x/ws', factory: () => sock });
  const off1 = client.subscribe(['A/1Min/OHLCV'], () => {});
  const off2 = client.subscribe(['A/1Min/OHLCV'], () => {});
  sock.openIt();
  off1();
  off1(); // idempotent: must not decrement the shared refcount again
  let last = JSON.parse(sock.sent[sock.sent.length - 1]);
  expect(last.tbks).toEqual(['A/1Min/OHLCV']); // second subscriber still alive
  off2(); // the surviving subscriber leaves -> union empties
  last = JSON.parse(sock.sent[sock.sent.length - 1]);
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
