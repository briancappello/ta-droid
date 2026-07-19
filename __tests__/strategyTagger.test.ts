// __tests__/strategyTagger.test.ts
import { taggerFromMap } from '../src/strategyTagger';
import type { Account } from '../src/alpaca';

const ira: Account = { id: 'i', name: 'IRA', key: 'K', secret: 'S', env: 'live' };
const paper: Account = { id: 'p', name: 'Paper', key: 'K', secret: 'S', env: 'paper' };

test('tags by (account, symbol), Unattributed otherwise', () => {
  const tag = taggerFromMap([
    { account_id: 'i', symbol: 'AAPL', strategy: 'Momentum' },
  ]);
  expect(tag({ symbol: 'AAPL' }, ira)).toBe('Momentum');
  expect(tag({ symbol: 'AAPL' }, paper)).toBe('Unattributed');
  expect(tag({ symbol: 'NVDA' }, ira)).toBe('Unattributed');
});
