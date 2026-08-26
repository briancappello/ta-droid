import { fetchWatchlists } from '../src/watchlists';
import { toWatchRow, watchlistStreamKey } from '../src/watchlists';

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
