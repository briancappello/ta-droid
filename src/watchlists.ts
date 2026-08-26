import { getWatchlists, getWatchlist } from './marketstore';

export type Watchlist = { id: string; name: string };

// MarketStore watchlist-plugin keys -> friendly labels (the labels fa-techan
// used to return). Unknown keys fall back to the raw key.
const LABELS: Record<string, string> = {
  PCT_CHANGE_UP: 'Top Gainers',
  PCT_CHANGE_DOWN: 'Top Losers',
  MOMENTUM: 'Momentum',
  RELATIVE_VOLUME: 'Relative Volume',
  GAP_UP: 'Gap Up',
  GAP_DOWN: 'Gap Down',
  SMA_CROSS_UP: 'SMA Cross Up',
  SMA_CROSS_DOWN: 'SMA Cross Down',
  INDUSTRY_AGGREGATE: 'Industry Aggregate',
  SECTOR_AGGREGATE: 'Sector Aggregate',
};

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const { watchlists } = await getWatchlists();
  return watchlists.map(w => ({ id: w.name, name: LABELS[w.name] ?? w.name }));
}

export async function fetchWatchlistSymbols(id: string): Promise<string[]> {
  const wl = await getWatchlist(id);
  return wl.entries.map(e => e.symbol);
}
