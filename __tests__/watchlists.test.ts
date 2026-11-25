import {
  basisLabel,
  fetchWatchlistEntries,
  fetchWatchlists,
  openLabel,
  priorCloseLabel,
  sessionLabel,
  toWatchMeta,
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

const listing = (names: string[]) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      watchlists: names.map(name => ({ name, entries: [] })),
    }),
  } as unknown as Response);

test('fetchWatchlists labels the session-era lists outside the regular session', async () => {
  // Premarket/afterhours: only bare lists, sorted by name as the server does.
  listing([
    'INDUSTRY_AGGREGATE',
    'MOMENTUM',
    'PCT_CHANGE_DOWN',
    'PCT_CHANGE_UP',
    'RELATIVE_VOLUME',
    'SECTOR_AGGREGATE',
    'VOLUME_DOWN',
    'VOLUME_UP',
  ]);
  expect(await fetchWatchlists()).toEqual([
    { id: 'INDUSTRY_AGGREGATE', name: 'Industry Aggregate' },
    { id: 'MOMENTUM', name: 'Momentum' },
    { id: 'PCT_CHANGE_DOWN', name: 'Top Losers' },
    { id: 'PCT_CHANGE_UP', name: 'Top Gainers' },
    { id: 'RELATIVE_VOLUME', name: 'Relative Volume' },
    { id: 'SECTOR_AGGREGATE', name: 'Sector Aggregate' },
    { id: 'VOLUME_DOWN', name: 'Volume Losers' },
    { id: 'VOLUME_UP', name: 'Volume Gainers' },
  ]);
});

test('fetchWatchlists: in the regular session Top Gainers/Losers are the traditional lists', async () => {
  listing([
    'GAP_DOWN_TRADITIONAL',
    'GAP_UP_TRADITIONAL',
    'INDUSTRY_AGGREGATE',
    'INDUSTRY_AGGREGATE_TRADITIONAL',
    'MOMENTUM',
    'MOMENTUM_TRADITIONAL',
    'PCT_CHANGE_DOWN',
    'PCT_CHANGE_DOWN_TRADITIONAL',
    'PCT_CHANGE_UP',
    'PCT_CHANGE_UP_TRADITIONAL',
    'RELATIVE_VOLUME',
    'RELATIVE_VOLUME_TRADITIONAL',
    'SECTOR_AGGREGATE',
    'SECTOR_AGGREGATE_TRADITIONAL',
    'SMA_CROSS_DOWN_TRADITIONAL',
    'SMA_CROSS_UP_TRADITIONAL',
    'VOLUME_DOWN',
    'VOLUME_DOWN_TRADITIONAL',
    'VOLUME_UP',
    'VOLUME_UP_TRADITIONAL',
  ]);
  expect(await fetchWatchlists()).toEqual([
    { id: 'GAP_DOWN_TRADITIONAL', name: 'Gap Down' },
    { id: 'GAP_UP_TRADITIONAL', name: 'Gap Up' },
    { id: 'INDUSTRY_AGGREGATE', name: 'Industry Aggregate' },
    { id: 'INDUSTRY_AGGREGATE_TRADITIONAL', name: 'Industry Aggregate (Traditional)' },
    { id: 'MOMENTUM', name: 'Momentum' },
    { id: 'MOMENTUM_TRADITIONAL', name: 'Momentum (Traditional)' },
    // The plain label goes to the traditional list, which comes first.
    { id: 'PCT_CHANGE_DOWN_TRADITIONAL', name: 'Top Losers' },
    { id: 'PCT_CHANGE_DOWN', name: 'Top Losers (Session)' },
    { id: 'PCT_CHANGE_UP_TRADITIONAL', name: 'Top Gainers' },
    { id: 'PCT_CHANGE_UP', name: 'Top Gainers (Session)' },
    { id: 'RELATIVE_VOLUME', name: 'Relative Volume' },
    { id: 'RELATIVE_VOLUME_TRADITIONAL', name: 'Relative Volume (Traditional)' },
    { id: 'SECTOR_AGGREGATE', name: 'Sector Aggregate' },
    { id: 'SECTOR_AGGREGATE_TRADITIONAL', name: 'Sector Aggregate (Traditional)' },
    { id: 'SMA_CROSS_DOWN_TRADITIONAL', name: 'SMA Cross Down' },
    { id: 'SMA_CROSS_UP_TRADITIONAL', name: 'SMA Cross Up' },
    { id: 'VOLUME_DOWN', name: 'Volume Losers' },
    { id: 'VOLUME_DOWN_TRADITIONAL', name: 'Volume Losers (Traditional)' },
    { id: 'VOLUME_UP', name: 'Volume Gainers' },
    { id: 'VOLUME_UP_TRADITIONAL', name: 'Volume Gainers (Traditional)' },
  ]);
});

test('fetchWatchlists no longer knows the removed GAP_*/SMA_CROSS_* names', async () => {
  listing(['GAP_UP', 'GAP_DOWN', 'SMA_CROSS_UP', 'SMA_CROSS_DOWN']);
  expect(await fetchWatchlists()).toEqual([
    { id: 'GAP_UP', name: 'GAP_UP' },
    { id: 'GAP_DOWN', name: 'GAP_DOWN' },
    { id: 'SMA_CROSS_UP', name: 'SMA_CROSS_UP' },
    { id: 'SMA_CROSS_DOWN', name: 'SMA_CROSS_DOWN' },
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

test('fetchWatchlistEntries returns the ranking metadata with the rows', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      name: 'PCT_CHANGE_UP_TRADITIONAL',
      basis: 'traditional',
      session: 'regular',
      trading_date: '2026-11-25',
      window_start: 1764081000,
      window_end: 1764090000,
      complete: false,
      entries: [{ symbol: 'NVDA', rank: 1, fields: { price: 104, prior_close: 100, open: 102 } }],
    }),
  } as unknown as Response);
  const { meta, rows } = await fetchWatchlistEntries('PCT_CHANGE_UP_TRADITIONAL');
  expect(meta).toEqual({ session: 'regular', basis: 'traditional', tradingDate: '2026-11-25' });
  expect(rows[0].symbol).toBe('NVDA');
  expect(rows[0].priceUp).toBe(true);
});

test('toWatchMeta tolerates an older server that omits the metadata', () => {
  const none = { session: null, basis: null, tradingDate: null };
  expect(toWatchMeta({ name: 'MOMENTUM', entries: [] })).toEqual(none);
  expect(toWatchMeta(undefined)).toEqual(none);
  expect(toWatchMeta({ session: 'lunch', basis: 'weird', trading_date: '' })).toEqual(none);
});

test('session and basis labels', () => {
  expect(sessionLabel('premarket')).toBe('Premarket session');
  expect(sessionLabel('regular')).toBe('Regular session');
  expect(sessionLabel('afterhours')).toBe('After-hours session');
  expect(sessionLabel(null)).toBeNull();
  expect(basisLabel('session')).toBe('Session basis');
  expect(basisLabel('traditional')).toBe('Traditional basis');
  expect(basisLabel(null)).toBeNull();
});

test('priorCloseLabel follows the basis; openLabel follows the session', () => {
  const m = (session: any, basis: any) => ({ session, basis, tradingDate: null });
  // Session basis: the close of the session immediately before.
  expect(priorCloseLabel(m('premarket', 'session'))).toBe('previous after-hours close');
  expect(priorCloseLabel(m('regular', 'session'))).toBe('premarket close');
  expect(priorCloseLabel(m('afterhours', 'session'))).toBe('official close');
  expect(priorCloseLabel(m(null, 'session'))).toBe('previous session close');
  // Traditional basis: the previous trading day's official close.
  expect(priorCloseLabel(m('regular', 'traditional'))).toBe('previous day close');
  // No basis (older server): unknown meaning, so no label.
  expect(priorCloseLabel(m('regular', null))).toBeNull();
  expect(openLabel(m('regular', 'traditional'))).toBe('regular open');
  expect(openLabel(m('afterhours', 'session'))).toBe('after-hours open');
  expect(openLabel(m(null, null))).toBeNull();
});
