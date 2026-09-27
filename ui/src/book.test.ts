// Ported from __tests__/book.test.ts (tagging moved to the backend, so the
// "stub tagger" case becomes untagged rows defaulting to Unattributed).
import { expect, test } from 'vitest';
import type { AccountBook } from './bindings/AccountBook';
import type { AccountView } from './bindings/AccountView';
import { bucketByAccount, filterByStrategies, firstError, strategiesPresent, tagAll, usd } from './book';

const ira: AccountView = { id: 'i', name: 'IRA', broker: 'alpaca', is_paper: false, key_last4: 'K' };
const paper: AccountView = { id: 'p', name: 'Paper', broker: 'alpaca', is_paper: true, key_last4: 'K' };
type P = { symbol: string };
const books = (tag: (s: string) => string): AccountBook<P>[] => [
  { account: ira, rows: ['AAPL', 'NVDA'].map(s => ({ item: { symbol: s }, strategy: tag(s) })), error: null },
  { account: paper, rows: [{ item: { symbol: 'TSLA' }, strategy: tag('TSLA') }], error: null },
];

test('rows without a tag are Unattributed and keep account order', () => {
  const t = tagAll(books(() => ''));
  expect(t).toHaveLength(3);
  expect(t.every(r => r.strategy === 'Unattributed')).toBe(true);
  expect(t[0].account.id).toBe('i');
});

test('strategiesPresent lists distinct labels with Unattributed last', () => {
  const t = tagAll(books(s => (s === 'AAPL' ? 'Momentum' : s === 'NVDA' ? 'MeanRev' : 'Unattributed')));
  expect(strategiesPresent(t)).toEqual(['MeanRev', 'Momentum', 'Unattributed']);
});

test('filterByStrategies: all returns everything; a selection narrows', () => {
  const t = tagAll(books(s => (s === 'AAPL' ? 'Momentum' : 'Unattributed')));
  expect(filterByStrategies(t, 'all')).toHaveLength(3);
  const only = filterByStrategies(t, ['Momentum']);
  expect(only.map(r => r.item.symbol)).toEqual(['AAPL']);
});

test('bucketByAccount groups preserving account order', () => {
  const b = bucketByAccount(tagAll(books(() => 'Unattributed')));
  expect(b.map(x => x.account.id)).toEqual(['i', 'p']);
  expect(b.map(x => x.rows.length)).toEqual([2, 1]);
});

test('firstError and usd formatting', () => {
  const bs = books(() => '');
  expect(firstError(bs)).toBeNull();
  bs[1].error = 'Check the API keys for this account.';
  expect(firstError(bs)).toBe('Check the API keys for this account.');
  expect(usd('1234')).toBe('$1,234.00');
  expect(usd(-5.1)).toBe('-$5.10');
  expect(usd('n/a')).toBe('n/a');
});
