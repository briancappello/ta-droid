import {
  fetchWatchlists,
  toWatchRow,
  watchlistStreamKey,
} from '../src/watchlists';

afterEach(() => jest.restoreAllMocks());

test('fetchWatchlists maps MarketStore names to {id,name} with friendly labels', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
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

test('toWatchRow: price colors vs prior_close; change is intraday % from open', () => {
  // Gap-down that recovered: below yesterday's close (down day, red price) but
  // above today's open (up since open, green change).
  const row = toWatchRow({ symbol: 'INTU', price: 345, prior_close: 357, open: 300 });
  expect(row).toEqual({
    symbol: 'INTU',
    price: 345,
    priceUp: false, // 345 < 357 -> down day
    changePct: 15, // (345 - 300) / 300 * 100
    changeUp: true, // up since open -> green
    aggPct: null,
  });
});

test('toWatchRow: the two directions are independent (up day, down since open)', () => {
  const row = toWatchRow({ symbol: 'GWRE', price: 110, prior_close: 100, open: 125 });
  expect(row).toEqual({
    symbol: 'GWRE',
    price: 110,
    priceUp: true, // 110 >= 100 -> up day
    changePct: -12, // (110 - 125) / 125 * 100
    changeUp: false, // down since open -> red
    aggPct: null,
  });
});

test('toWatchRow: guards a zero/missing open (no divide-by-zero)', () => {
  const row = toWatchRow({ symbol: 'HALT', price: 10, prior_close: 9, open: 0 });
  expect(row.changePct).toBeNull();
  expect(row.changeUp).toBeNull();
  expect(row.price).toBe(10);
});

test('toWatchRow: aggregates have null price/change and carry avg_pct_change', () => {
  const row = toWatchRow({ symbol: 'Industrials', avg_pct_change: 8.07 });
  expect(row).toEqual({
    symbol: 'Industrials',
    price: null,
    priceUp: null,
    changePct: null,
    changeUp: null,
    aggPct: 8.07,
  });
});

test('watchlistStreamKey builds the WATCHLISTS/1Min key', () => {
  expect(watchlistStreamKey('MOMENTUM')).toBe('WATCHLISTS/1Min/MOMENTUM');
});
