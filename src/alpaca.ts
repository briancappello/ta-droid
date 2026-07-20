// src/alpaca.ts
import type { BrokerId } from './broker';
import {
  brokers,
  type BrokerClient,
  type Order,
  type OrderFilter,
  type NewOrderRequest,
  type Position,
  type TimeInForce,
} from './broker';

export type Account = {
  id: string; // broker's account number (Alpaca account_number); primary key + fa-techan join key
  name: string;
  broker: BrokerId;
  is_paper: boolean;
  key: string;
  secret: string;
};

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AlpacaError';
    this.status = status;
  }
}

function hostFor(account: Account): string {
  const broker = brokers[account.broker];
  return account.is_paper ? broker.hosts.paper : broker.hosts.live;
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

const TIMEOUT_MS = 30000;

async function alpacaRequest<T>(
  account: Account,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  // ponytail: path callers must encodeURIComponent any dynamic segment.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    // ponytail: RN's RequestInit type omits `redirect`, so widen locally to keep it type-checked.
    const fetchInit: RequestInit & { redirect?: 'error' | 'follow' | 'manual' } = {
      method: init.method,
      headers: alpacaHeaders(account),
      body: init.body != null ? JSON.stringify(init.body) : undefined,
      redirect: 'error', // never follow a 3xx off-host with the secret headers
      signal: controller.signal,
    };
    response = await fetch(`${hostFor(account)}${path}`, fetchInit);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AlpacaError(0, 'Alpaca request timed out.');
    }
    throw new AlpacaError(0, "Can't reach Alpaca — check your connection.");
  } finally {
    clearTimeout(timer);
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

function newClientOrderId(): string {
  return `ta-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ordersQuery(filter?: OrderFilter): string {
  const params = new URLSearchParams();
  params.set('status', filter?.status ?? 'open');
  if (filter?.after) {
    params.set('after', filter.after);
  }
  if (filter?.until) {
    params.set('until', filter.until);
  }
  if (filter?.limit != null) {
    params.set('limit', String(filter.limit));
  }
  if (filter?.direction) {
    params.set('direction', filter.direction);
  }
  return params.toString();
}

export const alpacaDriver: BrokerClient = {
  listPositions(account) {
    return alpacaRequest<Position[]>(account, '/v2/positions');
  },
  listOrders(account, filter) {
    return alpacaRequest<Order[]>(account, `/v2/orders?${ordersQuery(filter)}`);
  },
  createOrder(account, req) {
    // Never auto-retried; stable client_order_id for auditability.
    const body: NewOrderRequest = {
      ...req,
      client_order_id: req.client_order_id ?? newClientOrderId(),
    };
    return alpacaRequest<Order>(account, '/v2/orders', { method: 'POST', body });
  },
  async closePosition(account, symbol) {
    await alpacaRequest<void>(
      account,
      `/v2/positions/${encodeURIComponent(symbol)}`,
      { method: 'DELETE' },
    );
  },
};

// Wire the registry (broker.ts fully initialized `brokers` before this runs).
brokers.alpaca.driver = alpacaDriver;

// --- Transitional named exports (deleted in Task B6). Keep consumers compiling. ---
// ponytail: wrap (don't detach `alpacaDriver.method`) so these never depend on
// `this` binding — cheap insurance for a shim that lives across 3 phases.
export const listPositions = (a: Account): Promise<Position[]> =>
  alpacaDriver.listPositions(a);
export const listOrders = (a: Account, f?: OrderFilter): Promise<Order[]> =>
  alpacaDriver.listOrders(a, f);
export const createOrder = (a: Account, req: NewOrderRequest): Promise<Order> =>
  alpacaDriver.createOrder(a, req);
export const closePosition = (a: Account, symbol: string): Promise<void> =>
  alpacaDriver.closePosition(a, symbol);

// listOpenOrders shim: old consumers call it with no filter → open orders.
export function listOpenOrders(account: Account): Promise<Order[]> {
  return alpacaDriver.listOrders(account, { status: 'open' });
}

// replaceOrder / cancelOrder retained for OrderEntryScreen until Phase B.
export type ReplaceOrderRequest = {
  qty?: string;
  time_in_force?: TimeInForce;
  limit_price?: string;
  stop_price?: string;
  trail?: string;
};
export async function replaceOrder(
  account: Account,
  id: string,
  req: ReplaceOrderRequest,
): Promise<Order> {
  return alpacaRequest<Order>(account, `/v2/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: req,
  });
}
export async function cancelOrder(account: Account, id: string): Promise<void> {
  await alpacaRequest<void>(account, `/v2/orders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// --- Transitional type re-exports (deleted in Task B6). Keep consumers compiling. ---
export type {
  Position as AlpacaPosition,
  Order as AlpacaOrder,
  OrderType,
  OrderSide,
  TimeInForce,
  NewOrderRequest,
} from './broker';
