import Config from 'react-native-config';

const BASE = Config.MARKETSTORE_BASE_URL!;
const AUTH = Config.MARKETSTORE_AUTH_TOKEN;

export type MarketstoreBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketstoreBars = {
  symbol: string;
  timeframe: string;
  bars: MarketstoreBar[];
};

export type MarketstoreQuote = {
  symbol: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prev_close: number | null;
};

// App frequency (fin.enums.Freq values) -> MarketStore timeframe
// (pymarketstore.Freq strings).
const FREQ_TIMEFRAME: Record<string, string> = {
  '1min': '1Min',
  '2min': '2Min',
  '5min': '5Min',
  '10min': '10Min',
  '15min': '15Min',
  '30min': '30Min',
  h: '1H',
  D: '1D',
  W: '1W',
  M: '1M',
};

export function freqToTimeframe(freq: string): string {
  const tf = FREQ_TIMEFRAME[freq];
  if (!tf) {
    throw new Error(`Unknown frequency: ${freq}`);
  }
  return tf;
}

async function msGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: AUTH ? { Authorization: AUTH } : undefined,
    });
  } catch {
    throw new Error("Can't reach market data — check your connection.");
  }
  if (!response.ok) {
    let message = `Market data error: ${response.status}`;
    try {
      const body = await response.json();
      if (body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // no JSON body; keep the status message
    }
    throw new Error(message);
  }
  return response.json();
}

export function getBars(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<MarketstoreBars> {
  const params = new URLSearchParams({ timeframe, limit: String(limit) });
  return msGet<MarketstoreBars>(
    `/v1/bars/${encodeURIComponent(symbol)}?${params}`,
  );
}

export function getQuotes(
  symbols: string[],
  timeframe = '1D',
): Promise<{ quotes: MarketstoreQuote[] }> {
  const params = new URLSearchParams({ symbols: symbols.join(','), timeframe });
  return msGet<{ quotes: MarketstoreQuote[] }>(`/v1/quotes?${params}`);
}

export type MarketstoreWatchlistEntry = {
  symbol: string;
  rank: number;
  sector: string;
  fields: Record<string, number>;
};

export type MarketstoreWatchlist = {
  name: string;
  entries: MarketstoreWatchlistEntry[];
  // Ranking metadata; absent on servers older than watchlist sessions.
  basis?: string;
  session?: string;
  trading_date?: string;
  window_start?: number;
  window_end?: number;
  complete?: boolean;
};

export function getWatchlists(): Promise<{
  watchlists: MarketstoreWatchlist[];
}> {
  return msGet<{ watchlists: MarketstoreWatchlist[] }>('/v1/watchlists');
}

export function getWatchlist(name: string): Promise<MarketstoreWatchlist> {
  return msGet<MarketstoreWatchlist>(
    `/v1/watchlists/${encodeURIComponent(name)}`,
  );
}

export async function pingMarketstore(): Promise<boolean> {
  try {
    // Dedicated liveness endpoint: 200 when queryable, 503 while starting.
    // Touches no catalog data and logs nothing (unlike a bogus-symbol query).
    const res = await fetch(`${BASE}/v1/health`, {
      headers: AUTH ? { Authorization: AUTH } : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}
