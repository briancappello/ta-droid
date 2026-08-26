import { fetchWatchlists, fetchWatchlistSymbols } from '../src/watchlists';

afterEach(() => jest.restoreAllMocks());

test('fetchWatchlists maps MarketStore names to {id,name} with friendly labels', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      watchlists: [
        { name: 'MOMENTUM', entries: [] },
        { name: 'FOO_BAR', entries: [] },
      ],
    }),
  } as unknown as Response);
  const wls = await fetchWatchlists();
  expect(wls).toEqual([
    { id: 'MOMENTUM', name: 'Momentum' },
    // Unknown keys fall back to the raw name.
    { id: 'FOO_BAR', name: 'FOO_BAR' },
  ]);
});

test('fetchWatchlistSymbols returns the symbols of the watchlist entries', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      name: 'MOMENTUM',
      entries: [
        { symbol: 'AIXI', rank: 1, sector: '', fields: {} },
        { symbol: 'SMCI', rank: 2, sector: '', fields: {} },
      ],
    }),
  } as unknown as Response);
  expect(await fetchWatchlistSymbols('MOMENTUM')).toEqual(['AIXI', 'SMCI']);
});
