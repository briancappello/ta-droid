// __tests__/techan.test.ts
import { pingHealth, fetchStrategyPositions } from '../src/techan';

afterEach(() => jest.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

test('pingHealth true on 200, false on error', async () => {
  mockFetch(200, {});
  expect(await pingHealth()).toBe(true);
  jest.restoreAllMocks();
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
  expect(await pingHealth()).toBe(false);
});

test('fetchStrategyPositions returns rows, [] on failure', async () => {
  mockFetch(200, [{ account_id: 'a', symbol: 'AAPL', strategy: 'Momentum' }]);
  expect(await fetchStrategyPositions()).toEqual([
    { account_id: 'a', symbol: 'AAPL', strategy: 'Momentum' },
  ]);
  jest.restoreAllMocks();
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('x'));
  expect(await fetchStrategyPositions()).toEqual([]);
});
