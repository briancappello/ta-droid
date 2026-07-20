// __tests__/strategyTagger.test.ts
import { taggerFromMap } from '../src/strategyTagger';
import type { Account } from '../src/alpaca';

const ira: Account = { id: 'i', name: 'IRA', broker: 'alpaca', is_paper: false, key: 'K', secret: 'S' };
const paper: Account = { id: 'p', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S' };

test('tags by (broker, account, symbol), Unattributed otherwise', () => {
  const tag = taggerFromMap([
    { broker_id: 'alpaca', account_id: 'i', symbol: 'AAPL', strategy: 'Momentum' },
  ]);
  expect(tag({ symbol: 'AAPL' }, ira)).toBe('Momentum');
  expect(tag({ symbol: 'AAPL' }, paper)).toBe('Unattributed'); // different account
  expect(tag({ symbol: 'NVDA' }, ira)).toBe('Unattributed');   // different symbol
});
