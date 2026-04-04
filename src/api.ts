import Config from 'react-native-config';

export const API_BASE = Config.API_BASE_URL!;

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
  data: number[][];
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
  const params = new URLSearchParams();
  if (frequency) {
    params.set('frequency', frequency);
  }
  if (limit != null) {
    params.set('limit', String(limit));
  }
  const qs = params.toString();
  const url = `${API_BASE}/finance/history/${encodeURIComponent(symbol)}${
    qs ? '?' + qs : ''
  }`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
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
