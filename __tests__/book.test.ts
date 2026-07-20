// __tests__/book.test.ts
import {
  tagAll,
  stubTagger,
  strategiesPresent,
  filterByStrategies,
  bucketByAccount,
  type StrategyOf,
} from '../src/book';
import type { Account } from '../src/alpaca';
import type { Position } from '../src/broker';

const ira: Account = { id: 'i', name: 'IRA', broker: 'alpaca', is_paper: false, key: 'K', secret: 'S' };
const paper: Account = { id: 'p', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S' };

function pos(symbol: string): Position {
  return {
    asset_id: 'x', symbol, exchange: 'NASDAQ', asset_class: 'us_equity',
    avg_entry_price: '100', qty: '10', side: 'long', market_value: '1000', cost_basis: '1000',
    unrealized_pl: '50', unrealized_plpc: '0', unrealized_intraday_pl: '0',
    unrealized_intraday_plpc: '0', current_price: '105', lastday_price: '100',
    change_today: '0', asset_marginable: true,
  };
}

const perAccount = [
  { account: ira, items: [pos('AAPL'), pos('NVDA')] },
  { account: paper, items: [pos('TSLA')] },
];

test('stubTagger tags everything Unattributed', () => {
  const tagged = tagAll(perAccount, stubTagger<Position>());
  expect(tagged).toHaveLength(3);
  expect(tagged.every(t => t.strategy === 'Unattributed')).toBe(true);
  expect(tagged[0].account.id).toBe('i');
});

test('strategiesPresent lists distinct labels with Unattributed last', () => {
  const strat: StrategyOf<Position> = (p) =>
    p.symbol === 'AAPL' ? 'Momentum' : p.symbol === 'NVDA' ? 'MeanRev' : 'Unattributed';
  const tagged = tagAll(perAccount, strat);
  expect(strategiesPresent(tagged)).toEqual(['MeanRev', 'Momentum', 'Unattributed']);
});

test('filterByStrategies all returns everything; selection narrows', () => {
  const strat: StrategyOf<Position> = (p) =>
    p.symbol === 'AAPL' ? 'Momentum' : 'Unattributed';
  const tagged = tagAll(perAccount, strat);
  expect(filterByStrategies(tagged, 'all')).toHaveLength(3);
  const only = filterByStrategies(tagged, ['Momentum']);
  expect(only).toHaveLength(1);
  expect(only[0].item.symbol).toBe('AAPL');
});

test('bucketByAccount groups preserving account order', () => {
  const tagged = tagAll(perAccount, stubTagger<Position>());
  const buckets = bucketByAccount(tagged);
  expect(buckets.map(b => b.account.id)).toEqual(['i', 'p']);
  expect(buckets[0].rows).toHaveLength(2);
  expect(buckets[1].rows).toHaveLength(1);
});
