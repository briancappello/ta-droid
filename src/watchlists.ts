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
  // Last price (today's most recent close).
  price: number | null;
  // Day direction: price vs yesterday's close. Colors the price. null when
  // either value is missing (e.g. aggregate rows).
  priceUp: boolean | null;
  // Intraday percent change from today's open: (price - open) / open * 100.
  // Colors itself. null when price/open are missing or open is 0.
  changePct: number | null;
  // Change direction: price vs today's open (i.e. changePct >= 0).
  changeUp: boolean | null;
  // Aggregate rows (Sector/Industry) have no tradeable price; they carry
  // avg_pct_change instead, shown in place of price+change.
  aggPct: number | null;
};

// Maps a flattened ranked-symbol object (WS watchlist_update symbol, or a REST
// entry with its `fields` spread in) to a display row. The price colors against
// prior_close (day move); the change is the intraday percent from today's open
// and colors against the open. Aggregate rows lack price/open and use
// avg_pct_change.
export function toWatchRow(s: any): WatchRow {
  const price = typeof s.price === 'number' ? s.price : null;
  const prior = typeof s.prior_close === 'number' ? s.prior_close : null;
  const open = typeof s.open === 'number' ? s.open : null;
  const changePct =
    price != null && open != null && open !== 0
      ? ((price - open) / open) * 100
      : null;
  return {
    symbol: s.symbol,
    price,
    priceUp: price != null && prior != null ? price >= prior : null,
    changePct,
    changeUp: changePct != null ? changePct >= 0 : null,
    aggPct: typeof s.avg_pct_change === 'number' ? s.avg_pct_change : null,
  };
}

export const watchlistStreamKey = (id: string) => `WATCHLISTS/1Min/${id}`;

// Initial REST paint. The REST watchlist nests metrics under `fields`, so
// spread them before mapping.
export async function fetchWatchlistEntries(id: string): Promise<WatchRow[]> {
  const wl = await getWatchlist(id);
  return wl.entries.map(e => toWatchRow({ symbol: e.symbol, ...e.fields }));
}
