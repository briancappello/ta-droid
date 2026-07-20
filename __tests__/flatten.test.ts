// __tests__/flatten.test.ts
import { flattenPlan, submitFlatten, finishExit, holdingsForSymbol, type SymbolHolding } from '../src/flatten';
import * as broker from '../src/broker';
import { AlpacaError, type Account } from '../src/alpaca';
import type { Position } from '../src/broker';

const ira: Account = { id: 'i', name: 'IRA', broker: 'alpaca', is_paper: false, key: 'K', secret: 'S' };
const paper: Account = { id: 'p', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S' };

function held(symbol: string, qty: string, side: 'long' | 'short' = 'long'): Position {
  return {
    asset_id: 'x', symbol, exchange: 'NASDAQ', asset_class: 'us_equity',
    avg_entry_price: '1', qty, side, market_value: '1', cost_basis: '1',
    unrealized_pl: '0', unrealized_plpc: '0', unrealized_intraday_pl: '0',
    unrealized_intraday_plpc: '0', current_price: '1', lastday_price: '1',
    change_today: '0', asset_marginable: true,
  };
}

function driverMock(over: Partial<broker.BrokerClient> = {}): broker.BrokerClient {
  return {
    listPositions: jest.fn().mockResolvedValue([]),
    listOrders: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: 'o1' }),
    closePosition: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

test('flattenPlan makes a market close per holding, opposite side', () => {
  const holdings: SymbolHolding[] = [
    { account: ira, position: held('AAPL', '100', 'long') },
    { account: paper, position: held('AAPL', '-20', 'short') },
  ];
  const legs = flattenPlan(holdings);
  expect(legs[0].req).toMatchObject({ symbol: 'AAPL', side: 'sell', type: 'market', qty: '100' });
  expect(legs[1].req).toMatchObject({ symbol: 'AAPL', side: 'buy', type: 'market', qty: '20' });
});

test('holdingsForSymbol isolates a rejecting account', async () => {
  jest.spyOn(broker, 'driverFor')
    .mockReturnValueOnce(driverMock({ listPositions: jest.fn().mockRejectedValue(new Error('down')) }))
    .mockReturnValueOnce(driverMock({ listPositions: jest.fn().mockResolvedValue([held('AAPL', '50')]) }));
  const out = await holdingsForSymbol([ira, paper], 'AAPL');
  expect(out).toHaveLength(1);
  expect(out[0].account.id).toBe('p');
});

test('submitFlatten fires each leg via its driver, reports per-leg', async () => {
  jest.spyOn(broker, 'driverFor')
    .mockReturnValueOnce(driverMock({ createOrder: jest.fn().mockResolvedValue({ id: 'o1' }) }))
    .mockReturnValueOnce(driverMock({ createOrder: jest.fn().mockRejectedValue(new AlpacaError(422, 'bad')) }));
  const legs = flattenPlan([
    { account: ira, position: held('AAPL', '100') },
    { account: paper, position: held('AAPL', '20') },
  ]);
  const results = await submitFlatten(legs);
  expect(results[0].ok).toBe(true);
  expect(results[1].ok).toBe(false);
  expect(results[1].error).toContain('bad');
});

test('finishExit returns results + allOk (no suppress)', async () => {
  const legs = flattenPlan([{ account: ira, position: held('AAPL', '100') }]);
  const submit = jest.fn().mockResolvedValue([{ leg: legs[0], ok: true }]);
  const out = await finishExit(legs, submit);
  expect(out.allOk).toBe(true);
  expect(out).not.toHaveProperty('suppressed');
});
