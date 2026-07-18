// src/alpaca.ts
export type AlpacaEnv = 'paper' | 'live';

export type Account = {
  id: string;
  name: string;
  key: string;
  secret: string;
  env: AlpacaEnv;
};

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  side: string;
  current_price: string;
};

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AlpacaError';
    this.status = status;
  }
}

export function alpacaBaseUrl(env: AlpacaEnv): string {
  return env === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
}

export function alpacaHeaders(account: Account): Record<string, string> {
  return {
    'APCA-API-KEY-ID': account.key,
    'APCA-API-SECRET-KEY': account.secret,
    'Content-Type': 'application/json',
  };
}

function messageForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return 'Check the API keys for this account.';
  }
  if (status === 429) {
    return 'Rate limited by Alpaca, retry shortly.';
  }
  if (status === 422) {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) {
        return String(parsed.message);
      }
    } catch {}
    return 'Alpaca rejected the request (validation error).';
  }
  return `Alpaca error (${status}).`;
}

async function alpacaRequest<T>(
  account: Account,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  // ponytail: path callers must encodeURIComponent any dynamic segment
  // (symbol/id). Fine for equities; crypto pairs like BTC/USD contain a slash.
  let response: Response;
  try {
    response = await fetch(`${alpacaBaseUrl(account.env)}${path}`, {
      method: init.method,
      headers: alpacaHeaders(account),
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new AlpacaError(0, "Can't reach Alpaca — check your connection.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AlpacaError(response.status, messageForStatus(response.status, text));
  }
  return response.json() as Promise<T>;
}

export async function listPositions(account: Account): Promise<AlpacaPosition[]> {
  return alpacaRequest<AlpacaPosition[]>(account, '/v2/positions');
}
