// __tests__/alpacaDriver.test.ts
import { alpacaDriver, AlpacaError } from '../src/alpaca';
import type { Account } from '../src/alpaca';
import { brokers } from '../src/broker';

const acct: Account = {
  id: 'PA1', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S',
};
const live: Account = { ...acct, id: 'A1', name: 'Live', is_paper: false };

afterEach(() => jest.restoreAllMocks());

// Guards the import-side-effect wiring: importing alpaca.ts must replace the
// A1 placeholder in the registry with the real driver. If module ordering ever
// regresses, driverFor() would hand back the throwing placeholder — this fails
// loudly instead.
test('importing alpaca.ts wires the real driver into the registry', () => {
  expect(brokers.alpaca.driver).toBe(alpacaDriver);
});

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue({
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
  // RN's RequestInit type omits `redirect`, so widen it the same way
  // src/alpaca.ts does. This guards a real property: a 3xx must never be
  // followed off-host while the request carries the API secret headers.
  expect((init as RequestInit & { redirect?: string })?.redirect).toBe('error');
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

test('request timeout throws AlpacaError with status 0', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await expect(alpacaDriver.listPositions(acct)).rejects.toMatchObject({
    status: 0,
    message: 'Alpaca request timed out.',
  });
});
