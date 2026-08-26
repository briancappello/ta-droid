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

export type WatchRow = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
};

// Maps a flattened ranked-symbol object (WS watchlist_update symbol, or a REST
// entry with its `fields` spread in) to a display row. Aggregates lack a
// tradeable price and use avg_pct_change.
export function toWatchRow(s: any): WatchRow {
  const price = typeof s.price === 'number' ? s.price : null;
  const prior = typeof s.prior_close === 'number' ? s.prior_close : null;
  const changePct =
    typeof s.pct_change === 'number'
      ? s.pct_change
      : typeof s.avg_pct_change === 'number'
      ? s.avg_pct_change
      : null;
  const change = price != null && prior != null ? price - prior : null;
  return { symbol: s.symbol, price, change, changePct };
}

export const watchlistStreamKey = (id: string) => `WATCHLISTS/1Min/${id}`;

// Initial REST paint. The REST watchlist nests metrics under `fields`, so
// spread them before mapping.
export async function fetchWatchlistEntries(id: string): Promise<WatchRow[]> {
  const wl = await getWatchlist(id);
  return wl.entries.map(e => toWatchRow({ symbol: e.symbol, ...e.fields }));
}
