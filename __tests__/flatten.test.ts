// __tests__/flatten.test.ts
import { flattenPlan, submitFlatten, finishExit, holdingsForSymbol, type SymbolHolding } from '../src/flatten';
import * as alpaca from '../src/alpaca';
import type { Account, AlpacaPosition } from '../src/alpaca';
import { postExitSuppress } from '../src/techan';

jest.mock('../src/alpaca', () => ({
  ...jest.requireActual('../src/alpaca'),
  createOrder: jest.fn(),
  listPositions: jest.fn(),
}));
jest.mock('../src/techan');

const ira: Account = { id: 'i', name: 'IRA', key: 'K', secret: 'S', env: 'live' };
const paper: Account = { id: 'p', name: 'Paper', key: 'K', secret: 'S', env: 'paper' };

function held(symbol: string, qty: string, side = 'long'): AlpacaPosition {
  return { symbol, qty, avg_entry_price: '1', market_value: '1', unrealized_pl: '0', side, current_price: '1' };
}

test('flattenPlan makes a market close per holding, opposite side', () => {
  const holdings: SymbolHolding[] = [
    { account: ira, position: held('AAPL', '100', 'long') },
    { account: paper, position: held('AAPL', '-20', 'short') },
  ];
  const legs = flattenPlan(holdings);
  expect(legs).toHaveLength(2);
  expect(legs[0].req).toMatchObject({ symbol: 'AAPL', side: 'sell', type: 'market', qty: '100' });
  expect(legs[1].req).toMatchObject({ symbol: 'AAPL', side: 'buy', type: 'market', qty: '20' });
});

test('submitFlatten fires all legs independently and reports per-leg', async () => {
  (alpaca.createOrder as jest.Mock)
    .mockResolvedValueOnce({ id: 'o1' })
    .mockRejectedValueOnce(new alpaca.AlpacaError(422, 'bad'));
  const holdings: SymbolHolding[] = [
    { account: ira, position: held('AAPL', '100', 'long') },
    { account: paper, position: held('AAPL', '20', 'long') },
  ];
  const results = await submitFlatten(flattenPlan(holdings));
  expect(results).toHaveLength(2);
  expect(results[0].ok).toBe(true);
  expect(results[1].ok).toBe(false);
  expect(results[1].error).toContain('bad');
});

test('finishExit fires suppress with flattened account ids and reports suppressed', async () => {
  const legs = flattenPlan([{ account: ira, position: held('AAPL', '100', 'long') }]);
  const submit = jest.fn().mockResolvedValue([{ leg: legs[0], ok: true }]);
  const suppress = jest.fn().mockResolvedValue(true);
  const out = await finishExit(legs, 'AAPL', submit, suppress);
  expect(out.allOk).toBe(true);
  expect(out.suppressed).toBe(true);
  expect(suppress).toHaveBeenCalledWith('AAPL', ['i']);
});

test('finishExit never lets a throwing suppress affect the flatten result', async () => {
  const legs = flattenPlan([{ account: ira, position: held('AAPL', '100', 'long') }]);
  const submit = jest.fn().mockResolvedValue([{ leg: legs[0], ok: true }]);
  const suppress = jest.fn().mockRejectedValue(new Error('backend down'));
  const out = await finishExit(legs, 'AAPL', submit, suppress);
  expect(out.allOk).toBe(true); // flatten still authoritative
  expect(out.suppressed).toBe(false); // suppress failed, swallowed
});

test('finishExit with real postExitSuppress: backend down leaves flatten authoritative', async () => {
  (postExitSuppress as jest.Mock).mockResolvedValue(false); // backend down
  const legs = flattenPlan([{ account: ira, position: held('AAPL', '100', 'long') }]);
  const submit = jest.fn().mockResolvedValue([{ leg: legs[0], ok: true }]);
  const out = await finishExit(legs, 'AAPL', submit, postExitSuppress);
  expect(out.allOk).toBe(true);
  expect(out.suppressed).toBe(false);
  expect(postExitSuppress).toHaveBeenCalledWith('AAPL', ['i']);
});

test('holdingsForSymbol isolates a rejecting account and returns only holders', async () => {
  (alpaca.listPositions as jest.Mock)
    .mockRejectedValueOnce(new Error('account down'))
    .mockResolvedValueOnce([held('AAPL', '50', 'long')]);
  const out = await holdingsForSymbol([ira, paper], 'AAPL');
  expect(out).toHaveLength(1);
  expect(out[0].account.id).toBe('p'); // paper
  expect(out[0].position.symbol).toBe('AAPL');
});
