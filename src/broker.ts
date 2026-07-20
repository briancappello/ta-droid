// src/broker.ts
import type { Account } from './alpaca';

export type BrokerId = 'alpaca';

// --- Enums (Alpaca wire values) ---
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type TimeInForce = 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
export type OrderClass = 'simple' | 'bracket' | 'oco' | 'oto' | 'mleg' | '';
export type PositionIntent =
  | 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
export type OrderStatus =
  | 'new' | 'partially_filled' | 'filled' | 'done_for_day' | 'canceled'
  | 'expired' | 'replaced' | 'pending_cancel' | 'pending_replace' | 'accepted'
  | 'pending_new' | 'accepted_for_bidding' | 'stopped' | 'rejected'
  | 'suspended' | 'calculated' | 'held';
export type AssetClass =
  | 'us_equity' | 'us_option' | 'crypto' | 'crypto_perp' | 'treasury'
  | 'corporate' | 'global_equity' | 'us_index' | 'us_equity_chain' | 'ipo' | '';
export type PositionSide = 'long' | 'short';

// --- Position (GET /v2/positions element); Alpaca numerics are strings ---
export interface Position {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: AssetClass;
  avg_entry_price: string;
  qty: string;
  qty_available?: string;
  side: PositionSide;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
  asset_marginable: boolean;
}

// --- Order (GET /v2/orders element / POST /v2/orders response) ---
export interface OrderLeg {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string | null;
  submitted_at: string | null;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  replaces: string | null;
  asset_id: string;
  symbol: string;
  asset_class: AssetClass;
  notional: string | null;
  qty: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: OrderClass;
  type: OrderType;
  side: OrderSide;
  position_intent: PositionIntent;
  time_in_force: TimeInForce;
  limit_price: string | null;
  stop_price: string | null;
  status: OrderStatus;
  extended_hours: boolean;
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
  ratio_qty: string | null;
}

export interface Order extends OrderLeg {
  expires_at: string;
  legs: OrderLeg[] | null;
  // NOTE: an Order carries BOTH `type` (inherited from OrderLeg, typed OrderType)
  // and `order_type` below — Alpaca's deprecated string alias of the same value.
  // They coexist for wire fidelity; consumers should read `type`, not `order_type`.
  order_type: string;
}

// --- Order-placement request (POST /v2/orders body) ---
export interface TakeProfit {
  limit_price: string;
}
export interface StopLoss {
  stop_price: string;
  limit_price?: string;
}
export interface NewOrderRequest {
  type: OrderType;
  time_in_force: TimeInForce;
  symbol?: string;
  side?: OrderSide;
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  trail_price?: string;
  trail_percent?: string;
  extended_hours?: boolean;
  client_order_id?: string;
  order_class?: OrderClass;
  position_intent?: PositionIntent;
  take_profit?: TakeProfit;
  stop_loss?: StopLoss;
}

// --- listOrders filter (maps to GET /v2/orders query params) ---
export type OrderQueryStatus = 'open' | 'closed' | 'all';
export interface OrderFilter {
  status?: OrderQueryStatus; // default 'open'
  after?: string; // ISO 8601
  until?: string; // ISO 8601
  limit?: number;
  direction?: 'asc' | 'desc';
}

// --- Driver interface ---
export interface BrokerClient {
  listPositions(account: Account): Promise<Position[]>;
  listOrders(account: Account, filter?: OrderFilter): Promise<Order[]>;
  createOrder(account: Account, req: NewOrderRequest): Promise<Order>;
  closePosition(account: Account, symbol: string): Promise<void>;
}

// --- Broker (owns accounts, hosts, driver) ---
export interface Broker {
  id: BrokerId;
  name: string;
  hosts: { paper: string; live: string };
  driver: BrokerClient;
}

// Placeholder driver — Task A3 replaces this with the real Alpaca fetch driver.
// ponytail: intentional stub so A1 lands before A3; throws if called.
const notWired = (): never => {
  throw new Error('alpaca driver not wired');
};
const placeholderDriver: BrokerClient = {
  listPositions: notWired,
  listOrders: notWired,
  createOrder: notWired,
  closePosition: notWired,
};

export const brokers: Record<BrokerId, Broker> = {
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    hosts: {
      paper: 'https://paper-api.alpaca.markets',
      live: 'https://api.alpaca.markets',
    },
    driver: placeholderDriver,
  },
};

export function driverFor(account: Account): BrokerClient {
  const broker = brokers[account.broker];
  if (!broker) {
    throw new Error(`unknown broker: ${account.broker}`);
  }
  return broker.driver;
}
