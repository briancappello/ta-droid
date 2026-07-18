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
