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
  } catch {
    throw new AlpacaError(0, "Can't reach Alpaca — check your connection.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AlpacaError(response.status, messageForStatus(response.status, text));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function listPositions(account: Account): Promise<AlpacaPosition[]> {
  return alpacaRequest<AlpacaPosition[]>(account, '/v2/positions');
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'opg' | 'cls';

export type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string | null;
  notional: string | null;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price: string | null;
  stop_price: string | null;
  trail_percent: string | null;
  status: string;
};

export type NewOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  trail_percent?: string;
  extended_hours?: boolean;
};

export type ReplaceOrderRequest = {
  qty?: string;
  time_in_force?: TimeInForce;
  limit_price?: string;
  stop_price?: string;
  trail?: string;
};

export async function listOpenOrders(account: Account): Promise<AlpacaOrder[]> {
  return alpacaRequest<AlpacaOrder[]>(account, '/v2/orders?status=open');
}

export async function createOrder(
  account: Account,
  req: NewOrderRequest,
): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>(account, '/v2/orders', {
    method: 'POST',
    body: req,
  });
}

export async function replaceOrder(
  account: Account,
  id: string,
  req: ReplaceOrderRequest,
): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>(
    account,
    `/v2/orders/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: req },
  );
}

export async function cancelOrder(account: Account, id: string): Promise<void> {
  await alpacaRequest<void>(account, `/v2/orders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function closePosition(
  account: Account,
  symbol: string,
): Promise<void> {
  await alpacaRequest<void>(
    account,
    `/v2/positions/${encodeURIComponent(symbol)}`,
    { method: 'DELETE' },
  );
}
