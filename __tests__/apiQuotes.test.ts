import { fetchQuotes } from '../src/api';

afterEach(() => jest.restoreAllMocks());

test('returns [] without calling the network for an empty ticker list', async () => {
  const spy = jest.spyOn(globalThis, 'fetch');
  const res = await fetchQuotes([]);
  expect(res).toEqual([]);
  expect(spy).not.toHaveBeenCalled();
});

test('maps MarketStore quotes to ApiQuote shape', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      quotes: [
        {
          symbol: 'AAPL',
          time: '2024-01-15T00:00:00Z',
          open: 1.5,
          high: 2.5,
          low: 1,
          close: 2,
          volume: 1200,
          prev_close: 1.5,
        },
      ],
    }),
  } as unknown as Response);

  const res = await fetchQuotes(['AAPL']);
  expect(res).toEqual([
    {
      ticker: 'AAPL',
      date: '2024-01-15T00:00:00Z',
      open: 1.5,
      high: 2.5,
      low: 1,
      close: 2,
      volume: 1200,
      prev_close: 1.5,
    },
  ]);
});

test('passes prev_close null through unchanged', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      quotes: [
        {
          symbol: 'NEW',
          time: '2024-01-15T00:00:00Z',
          open: 5,
          high: 5,
          low: 5,
          close: 5,
          volume: 1,
          prev_close: null,
        },
      ],
    }),
  } as unknown as Response);

  const res = await fetchQuotes(['NEW']);
  expect(res[0].prev_close).toBeNull();
});
