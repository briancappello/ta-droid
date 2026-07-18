// __tests__/orderValidation.test.ts
import {
  validateOrderForm,
  toNewOrderRequest,
  type OrderFormValues,
} from '../src/orderValidation';

const base: OrderFormValues = {
  symbol: 'AAPL',
  side: 'buy',
  type: 'market',
  time_in_force: 'day',
  qty: '10',
  notional: '',
  limit_price: '',
  stop_price: '',
  trail_percent: '',
  extended_hours: false,
  useNotional: false,
};

test('valid market order has no errors', () => {
  expect(validateOrderForm(base)).toEqual([]);
});

test('missing symbol is an error', () => {
  expect(validateOrderForm({ ...base, symbol: '  ' })).toContain(
    'Symbol is required.',
  );
});

test('non-positive qty is an error', () => {
  expect(validateOrderForm({ ...base, qty: '0' })).toContain(
    'Quantity must be a positive number.',
  );
});

test('limit order requires a limit price', () => {
  const errs = validateOrderForm({ ...base, type: 'limit', limit_price: '' });
  expect(errs).toContain('Limit price is required for limit orders.');
});

test('stop_limit requires both prices', () => {
  const errs = validateOrderForm({
    ...base,
    type: 'stop_limit',
    limit_price: '',
    stop_price: '',
  });
  expect(errs.length).toBeGreaterThanOrEqual(2);
});

test('trailing_stop requires trail percent', () => {
  expect(
    validateOrderForm({ ...base, type: 'trailing_stop', trail_percent: '' }),
  ).toContain('Trail percent is required for trailing stop orders.');
});

test('toNewOrderRequest builds a limit request with qty and omits stop', () => {
  const req = toNewOrderRequest({
    ...base,
    type: 'limit',
    limit_price: '190',
  });
  expect(req).toEqual({
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    time_in_force: 'day',
    qty: '10',
    limit_price: '190',
    extended_hours: false,
  });
});

test('toNewOrderRequest uses notional when useNotional is set', () => {
  const req = toNewOrderRequest({
    ...base,
    useNotional: true,
    qty: '',
    notional: '500',
  });
  expect(req.notional).toBe('500');
  expect(req.qty).toBeUndefined();
});

test('toNewOrderRequest omits all price fields for a market order', () => {
  const req = toNewOrderRequest(base);
  expect(req).toEqual({
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    qty: '10',
    extended_hours: false,
  });
});
