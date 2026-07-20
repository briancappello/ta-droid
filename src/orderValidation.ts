// src/orderValidation.ts
import type {
  NewOrderRequest,
  OrderSide,
  OrderType,
  TimeInForce,
} from './broker';

export type OrderFormValues = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  qty: string;
  notional: string;
  limit_price: string;
  stop_price: string;
  trail_percent: string;
  extended_hours: boolean;
  useNotional: boolean;
};

function isPositive(s: string): boolean {
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
}

const needsLimit = (t: OrderType) => t === 'limit' || t === 'stop_limit';
const needsStop = (t: OrderType) => t === 'stop' || t === 'stop_limit';
const needsTrail = (t: OrderType) => t === 'trailing_stop';

export function validateOrderForm(v: OrderFormValues): string[] {
  const errors: string[] = [];
  if (!v.symbol.trim()) {
    errors.push('Symbol is required.');
  }
  if (v.useNotional) {
    if (!isPositive(v.notional)) {
      errors.push('Notional must be a positive number.');
    }
  } else if (!isPositive(v.qty)) {
    errors.push('Quantity must be a positive number.');
  }
  if (needsLimit(v.type) && !isPositive(v.limit_price)) {
    errors.push('Limit price is required for limit orders.');
  }
  if (needsStop(v.type) && !isPositive(v.stop_price)) {
    errors.push('Stop price is required for stop orders.');
  }
  if (needsTrail(v.type) && !isPositive(v.trail_percent)) {
    errors.push('Trail percent is required for trailing stop orders.');
  }
  return errors;
}

export function toNewOrderRequest(v: OrderFormValues): NewOrderRequest {
  const req: NewOrderRequest = {
    symbol: v.symbol.trim().toUpperCase(),
    side: v.side,
    type: v.type,
    time_in_force: v.time_in_force,
    extended_hours: v.extended_hours,
  };
  if (v.useNotional) {
    req.notional = v.notional;
  } else {
    req.qty = v.qty;
  }
  if (needsLimit(v.type)) {
    req.limit_price = v.limit_price;
  }
  if (needsStop(v.type)) {
    req.stop_price = v.stop_price;
  }
  if (needsTrail(v.type)) {
    req.trail_percent = v.trail_percent;
  }
  return req;
}
