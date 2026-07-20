// __tests__/alpaca.test.ts
import {
  alpacaBaseUrl,
  alpacaHeaders,
  listPositions,
  type Account,
} from '../src/alpaca';
import {
  listOpenOrders,
  createOrder,
  replaceOrder,
  cancelOrder,
  closePosition,
} from '../src/alpaca';

const paperAccount: Account = {
  id: '1',
  name: 'Paper',
  key: 'PKEY',
  secret: 'PSECRET',
  is_paper: true,
  broker: 'alpaca',
};
const liveAccount: Account = {
  ...paperAccount,
  id: '2',
  name: 'IRA',
  is_paper: false,
  broker: 'alpaca',
};

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

test('cancelOrder tolerates a truly empty 204 body (no JSON parse crash)', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => {
      throw new Error('no body');
    },
    text: async () => '',
  } as unknown as Response);
  await expect(cancelOrder(paperAccount, 'o1')).resolves.toBeUndefined();
});
