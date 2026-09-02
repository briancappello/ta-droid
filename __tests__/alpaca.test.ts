// __tests__/alpaca.test.ts
import {
  alpacaHeaders,
  replaceOrder,
  cancelOrder,
  type Account,
} from '../src/alpaca';

const paperAccount: Account = {
  id: '1',
  name: 'Paper',
  key: 'PKEY',
  secret: 'PSECRET',
  is_paper: true,
  broker: 'alpaca',
};
afterEach(() => {
  jest.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

test('alpacaHeaders sets auth headers from account', () => {
  expect(alpacaHeaders(paperAccount)).toEqual({
    'APCA-API-KEY-ID': 'PKEY',
    'APCA-API-SECRET-KEY': 'PSECRET',
    'Content-Type': 'application/json',
  });
});

test('replaceOrder PATCHes to the order id', async () => {
  const spy = mockFetch(200, { id: 'o1' });
  await replaceOrder(paperAccount, 'o1', { qty: '5' });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('https://paper-api.alpaca.markets/v2/orders/o1');
  expect(init?.method).toBe('PATCH');
  expect(JSON.parse(init?.body as string)).toEqual({ qty: '5' });
});

test('cancelOrder DELETEs the order id', async () => {
  const spy = mockFetch(204, {});
  await cancelOrder(paperAccount, 'o1');
  expect(spy).toHaveBeenCalledWith(
    'https://paper-api.alpaca.markets/v2/orders/o1',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

test('cancelOrder tolerates a truly empty 204 body (no JSON parse crash)', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => {
      throw new Error('no body');
    },
    text: async () => '',
  } as unknown as Response);
  await expect(cancelOrder(paperAccount, 'o1')).resolves.toBeUndefined();
});
