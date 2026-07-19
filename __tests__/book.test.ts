// __tests__/book.test.ts
import {
  tagAll,
  stubTagger,
  strategiesPresent,
  filterByStrategies,
  bucketByAccount,
  type StrategyOf,
} from '../src/book';
import type { Account, AlpacaPosition } from '../src/alpaca';

const ira: Account = { id: 'i', name: 'IRA', key: 'K', secret: 'S', env: 'live' };
const paper: Account = { id: 'p', name: 'Paper', key: 'K', secret: 'S', env: 'paper' };

function pos(symbol: string): AlpacaPosition {
  return {
    symbol,
    qty: '10',
    avg_entry_price: '100',
    market_value: '1000',
    unrealized_pl: '50',
    side: 'long',
    current_price: '105',
  };
}

const perAccount = [
  { account: ira, items: [pos('AAPL'), pos('NVDA')] },
  { account: paper, items: [pos('TSLA')] },
];

test('stubTagger tags everything Unattributed', () => {
  const tagged = tagAll(perAccount, stubTagger<AlpacaPosition>());
  expect(tagged).toHaveLength(3);
  expect(tagged.every(t => t.strategy === 'Unattributed')).toBe(true);
  expect(tagged[0].account.id).toBe('i');
});

test('strategiesPresent lists distinct labels with Unattributed last', () => {
  const strat: StrategyOf<AlpacaPosition> = (p) =>
    p.symbol === 'AAPL' ? 'Momentum' : p.symbol === 'NVDA' ? 'MeanRev' : 'Unattributed';
  const tagged = tagAll(perAccount, strat);
  expect(strategiesPresent(tagged)).toEqual(['MeanRev', 'Momentum', 'Unattributed']);
});

test('filterByStrategies all returns everything; selection narrows', () => {
  const strat: StrategyOf<AlpacaPosition> = (p) =>
    p.symbol === 'AAPL' ? 'Momentum' : 'Unattributed';
  const tagged = tagAll(perAccount, strat);
  expect(filterByStrategies(tagged, 'all')).toHaveLength(3);
  const only = filterByStrategies(tagged, ['Momentum']);
  expect(only).toHaveLength(1);
  expect(only[0].item.symbol).toBe('AAPL');
});

test('bucketByAccount groups preserving account order', () => {
  const tagged = tagAll(perAccount, stubTagger<AlpacaPosition>());
  const buckets = bucketByAccount(tagged);
  expect(buckets.map(b => b.account.id)).toEqual(['i', 'p']);
  expect(buckets[0].rows).toHaveLength(2);
  expect(buckets[1].rows).toHaveLength(1);
});
