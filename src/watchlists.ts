import { getWatchlists, getWatchlist } from './marketstore';

export type Watchlist = { id: string; name: string };

// MarketStore watchlist-plugin keys -> friendly labels (the labels fa-techan
// used to return). Unknown keys fall back to the raw key. Bare names use the
// session basis and exist in every session; NAME_TRADITIONAL (previous day's
// close) exists only in the regular session. GAP_* and SMA_CROSS_* are
// traditional by definition, so they are published only as *_TRADITIONAL.
const LABELS: Record<string, string> = {
  PCT_CHANGE_UP: 'Top Gainers',
  PCT_CHANGE_DOWN: 'Top Losers',
  VOLUME_UP: 'Volume Gainers',
  VOLUME_DOWN: 'Volume Losers',
  MOMENTUM: 'Momentum',
  RELATIVE_VOLUME: 'Relative Volume',
  INDUSTRY_AGGREGATE: 'Industry Aggregate',
  SECTOR_AGGREGATE: 'Sector Aggregate',
  PCT_CHANGE_UP_TRADITIONAL: 'Top Gainers (Traditional)',
  PCT_CHANGE_DOWN_TRADITIONAL: 'Top Losers (Traditional)',
  VOLUME_UP_TRADITIONAL: 'Volume Gainers (Traditional)',
  VOLUME_DOWN_TRADITIONAL: 'Volume Losers (Traditional)',
  MOMENTUM_TRADITIONAL: 'Momentum (Traditional)',
  RELATIVE_VOLUME_TRADITIONAL: 'Relative Volume (Traditional)',
  INDUSTRY_AGGREGATE_TRADITIONAL: 'Industry Aggregate (Traditional)',
  SECTOR_AGGREGATE_TRADITIONAL: 'Sector Aggregate (Traditional)',
  GAP_UP_TRADITIONAL: 'Gap Up',
  GAP_DOWN_TRADITIONAL: 'Gap Down',
  SMA_CROSS_UP_TRADITIONAL: 'SMA Cross Up',
  SMA_CROSS_DOWN_TRADITIONAL: 'SMA Cross Down',
};

const TRADITIONAL = '_TRADITIONAL';

// Lists whose plain label means "today's move" to the user. During the
// regular session their traditional variant takes the plain label and comes
// first; the bare (session-basis) list is relabeled as the alternative.
const DEFAULT_TRADITIONAL = ['PCT_CHANGE_UP', 'PCT_CHANGE_DOWN'];

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const { watchlists } = await getWatchlists();
  const names = new Set(watchlists.map(w => w.name));
  const swapped = (n: string) =>
    DEFAULT_TRADITIONAL.includes(n) && names.has(n + TRADITIONAL);
  const out: Watchlist[] = [];
  for (const { name } of watchlists) {
    if (
      name.endsWith(TRADITIONAL) &&
      swapped(name.slice(0, -TRADITIONAL.length))
    ) {
      continue;
    }
    if (swapped(name)) {
      out.push({ id: name + TRADITIONAL, name: LABELS[name] });
      out.push({ id: name, name: `${LABELS[name]} (Session)` });
      continue;
    }
    out.push({ id: name, name: LABELS[name] ?? name });
  }
  return out;
}

export type WatchRow = {
  symbol: string;
  // Last price (the session's most recent close).
  price: number | null;
  // Price vs prior_close, whose meaning depends on the basis (see
  // priorCloseLabel). Colors the price. null when either value is missing
  // (e.g. aggregate rows).
  priceUp: boolean | null;
  // Percent change from the session's open: (price - open) / open * 100.
  // Colors itself. null when price/open are missing or open is 0.
  changePct: number | null;
  // Change direction: price vs the session's open (i.e. changePct >= 0).
  changeUp: boolean | null;
  // Aggregate rows (Sector/Industry) have no tradeable price; they carry
  // avg_pct_change instead, shown in place of price+change.
  aggPct: number | null;
};

// Maps a flattened ranked-symbol object (WS watchlist_update symbol, or a REST
// entry with its `fields` spread in) to a display row. The price colors against
// prior_close; the change is the percent from the session's open and colors
// against the open. Aggregate rows lack price/open and use
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

export type Session = 'premarket' | 'regular' | 'afterhours';
export type Basis = 'session' | 'traditional';

// Which ranking a list is: sent by the server with every REST list and
// watchlist_update push. Older servers omit it, so every field may be null.
export type WatchMeta = {
  session: Session | null;
  basis: Basis | null;
  tradingDate: string | null;
};

const SESSIONS: Session[] = ['premarket', 'regular', 'afterhours'];
const BASES: Basis[] = ['session', 'traditional'];

export function toWatchMeta(m: any): WatchMeta {
  return {
    session: SESSIONS.includes(m?.session) ? m.session : null,
    basis: BASES.includes(m?.basis) ? m.basis : null,
    tradingDate:
      typeof m?.trading_date === 'string' && m.trading_date
        ? m.trading_date
        : null,
  };
}

const SESSION_LABELS: Record<Session, string> = {
  premarket: 'Premarket',
  regular: 'Regular',
  afterhours: 'After-hours',
};

export function sessionLabel(s: Session | null): string | null {
  return s ? `${SESSION_LABELS[s]} session` : null;
}

export function basisLabel(b: Basis | null): string | null {
  return b === 'traditional'
    ? 'Traditional basis'
    : b === 'session'
    ? 'Session basis'
    : null;
}

// What prior_close is: the previous day's official close (traditional), or
// the close of the session immediately before (session basis).
export function priorCloseLabel(meta: WatchMeta): string | null {
  if (meta.basis === 'traditional') {
    return 'previous day close';
  }
  if (meta.basis !== 'session') {
    return null;
  }
  switch (meta.session) {
    case 'premarket':
      return 'previous after-hours close';
    case 'regular':
      return 'premarket close';
    case 'afterhours':
      return 'official close';
    default:
      return 'previous session close';
  }
}

// open is the open of the session's first bar, under either basis.
export function openLabel(meta: WatchMeta): string | null {
  return meta.session
    ? `${SESSION_LABELS[meta.session].toLowerCase()} open`
    : null;
}

export const watchlistStreamKey = (id: string) => `WATCHLISTS/1Min/${id}`;

export type WatchlistSnapshot = { meta: WatchMeta; rows: WatchRow[] };

// Initial REST paint. The REST watchlist nests metrics under `fields`, so
// spread them before mapping.
export async function fetchWatchlistEntries(
  id: string,
): Promise<WatchlistSnapshot> {
  const wl = await getWatchlist(id);
  return {
    meta: toWatchMeta(wl),
    rows: wl.entries.map(e => toWatchRow({ symbol: e.symbol, ...e.fields })),
  };
}
