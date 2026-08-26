import Config from 'react-native-config';

import { getBars, getQuotes, freqToTimeframe } from './marketstore';
import { computeIndicators, INDICATOR_COLUMNS } from './indicators';

export const API_BASE = Config.API_BASE_URL!;

const OHLCV_COLUMNS = ['open', 'high', 'low', 'close', 'volume'] as const;
const HISTORY_COLUMNS = [...OHLCV_COLUMNS, ...INDICATOR_COLUMNS];
// Longest indicator period (sma200); over-fetch this many extra bars so
// indicators are warm across the returned window, matching fa-techan which
// computes TA on the full series before slicing.
const HISTORY_WARMUP = 200;

// --- Types ---

export type StockQuote = {
  ticker: string;
  name: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  time: string;
};

export type ApiQuote = {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prev_close: number | null;
};

export type HistoryResponse = {
  columns: string[];
  index: number[];
  data: (number | null)[][];
};

// --- API ---

export async function fetchQuotes(tickers: string[]): Promise<ApiQuote[]> {
  if (tickers.length === 0) {
    return [];
  }
  const params = tickers.map(t => `tickers=${encodeURIComponent(t)}`).join('&');
  const response = await fetch(`${API_BASE}/finance/quotes?${params}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export async function fetchHistory(
  symbol: string,
  frequency?: string,
  limit?: number,
): Promise<HistoryResponse> {
  const timeframe = freqToTimeframe(frequency ?? 'D');
  const want = limit ?? 1500;
  const { bars } = await getBars(symbol, timeframe, want + HISTORY_WARMUP);
  if (bars.length === 0) {
    return { columns: [], index: [], data: [] };
  }

  const indicators = computeIndicators(bars.map(b => b.close));
  const startIdx = Math.max(0, bars.length - want);

  const index: number[] = [];
  const data: (number | null)[][] = [];
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    const ind = indicators[i];
    index.push(Date.parse(b.time));
    data.push([
      b.open,
      b.high,
      b.low,
      b.close,
      b.volume,
      ind.sma20,
      ind.sma100,
      ind.sma200,
      ind.bbands_upper,
      ind.bbands_lower,
      ind.macd,
      ind.macd_signal,
      ind.macd_difference,
      ind.rsi,
    ]);
  }

  return { columns: HISTORY_COLUMNS, index, data };
}

export function apiQuoteToStockQuote(q: ApiQuote): StockQuote {
  const change = q.prev_close != null ? q.close - q.prev_close : 0;
  const changePercent =
    q.prev_close != null && q.prev_close !== 0
      ? (change / q.prev_close) * 100
      : 0;
  const date = new Date(q.date);
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return {
    ticker: q.ticker,
    name: q.ticker,
    lastPrice: q.close,
    change,
    changePercent,
    time,
  };
}
