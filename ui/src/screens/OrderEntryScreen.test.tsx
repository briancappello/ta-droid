// Ported from __tests__/orderEntryScreen.test.tsx (new-order mode; modify
// mode was unreachable in the RN app and is out of scope), plus review,
// submit, errors, and the double-submit guard.
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { AccountView } from '../bindings/AccountView';
import { mockBackend } from '../test/backend';
import { renderInShell } from '../test/render';
import { OrderEntryScreen } from './OrderEntryScreen';

const paper: AccountView = { id: 'a', name: 'Paper', broker: 'alpaca', is_paper: true, key_last4: 'K' };
const live: AccountView = { id: 'b', name: 'Live', broker: 'alpaca', is_paper: false, key_last4: 'K' };
const routes = [
  { path: '/chart/:ticker', element: <p data-testid="chart" /> },
  { path: '/chart/:ticker/order', element: <OrderEntryScreen /> },
];
const entries = [{ pathname: '/chart/AAPL' }, { pathname: '/chart/AAPL/order', state: { symbol: 'AAPL', accountId: 'a' } }];

function backend(extra = {}) {
  return mockBackend({
    list_accounts: () => ({ accounts: [paper, live], active_id: 'b' }),
    validate_order: ({ form }) => {
      const f = form as { order_type?: string; type: string; limit_price: string; qty: string };
      const errs: string[] = [];
      if (!(Number(f.qty) > 0)) errs.push('Quantity must be a positive number.');
      if ((f.type === 'limit' || f.type === 'stop_limit') && !(Number(f.limit_price) > 0)) errs.push('Limit price is required for limit orders.');
      return errs;
    },
    place_order: () => ({ id: 'o1' }),
    ...extra,
  });
}

const fill = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const click = (id: string) => act(async () => fireEvent.click(screen.getByTestId(id)));

test('opens with the symbol and the account passed from the chart', async () => {
  backend();
  await renderInShell(entries, routes);
  expect((screen.getByTestId('order-symbol') as HTMLInputElement).value).toBe('AAPL');
  expect(screen.getByTestId('account-picker').textContent).toBe('Paper · PAPER ▼');
});

test('price fields appear only for the types that need them', async () => {
  backend();
  await renderInShell(entries, routes);
  expect(screen.queryByTestId('order-limit')).toBeNull();
  await click('type-stop_limit');
  expect(screen.getByTestId('order-limit')).toBeTruthy();
  expect(screen.getByTestId('order-stop')).toBeTruthy();
  await click('type-trailing_stop');
  expect(screen.queryByTestId('order-limit')).toBeNull();
  expect(screen.getByTestId('order-trail')).toBeTruthy();
  await click('amount-notional');
  expect(screen.getByTestId('order-notional')).toBeTruthy();
  expect(screen.queryByTestId('order-qty')).toBeNull();
});

test('validation errors block the review and nothing is sent', async () => {
  const calls = backend();
  await renderInShell(entries, routes);
  await click('type-limit');
  await click('review');
  expect(screen.getAllByTestId('order-error').map(e => e.textContent)).toEqual([
    'Quantity must be a positive number.',
    'Limit price is required for limit orders.',
  ]);
  expect(screen.queryByTestId('review-modal')).toBeNull();
  expect(calls.some(c => c.cmd === 'place_order')).toBe(false);
});

test('review shows the order; submit places it once, notifies, and goes back', async () => {
  let release!: (v: unknown) => void;
  const calls = backend({ place_order: () => new Promise(r => (release = r)) });
  const { router } = await renderInShell(entries, routes);
  fill('order-qty', '2');
  await click('type-limit');
  fill('order-limit', '150');
  await click('tif-gtc');
  await click('review');
  const modal = screen.getByTestId('review-modal').textContent!;
  for (const s of ['Symbol: AAPL', 'Side: BUY', 'Qty: 2', 'Type: LIMIT', 'Limit: 150', 'TIF: GTC', 'Account: Paper']) expect(modal).toContain(s);
  await click('submit');
  expect(screen.getByTestId('submit').textContent).toBe('Submitting…');
  await click('submit');
  expect(calls.filter(c => c.cmd === 'place_order').length).toBe(1);
  expect(calls.find(c => c.cmd === 'place_order')?.args).toMatchObject({ accountId: 'a', form: { symbol: 'AAPL', type: 'limit', limit_price: '150', time_in_force: 'gtc' } });
  await act(async () => release({ id: 'o1' }));
  expect(router.state.location.pathname).toBe('/chart/AAPL');
  expect(screen.getByTestId('notice').textContent).toBe('Order submitted');
});

test('a broker error shows its message and stays on the form', async () => {
  backend({ place_order: () => { throw { message: 'Rate limited by Alpaca, retry shortly.' }; } });
  const { router } = await renderInShell(entries, routes);
  fill('order-qty', '1');
  await click('review');
  await click('submit');
  expect(screen.getByTestId('submit-error').textContent).toBe('Rate limited by Alpaca, retry shortly.');
  expect(router.state.location.pathname).toBe('/chart/AAPL/order');
});

test('with no account selected, submit says so', async () => {
  mockBackend({ list_accounts: () => ({ accounts: [], active_id: null }), validate_order: () => [] });
  await renderInShell([{ pathname: '/chart/AAPL' }, { pathname: '/chart/AAPL/order', state: {} }], routes);
  fill('order-qty', '1');
  await click('review');
  await click('submit');
  expect(screen.getByTestId('submit-error').textContent).toBe('Select an account.');
});
