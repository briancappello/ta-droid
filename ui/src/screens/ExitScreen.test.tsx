// Ported from __tests__/exitScreen.test.tsx, plus editing, the result paths,
// and retrying only the failed legs.
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { Leg } from '../bindings/Leg';
import { mockBackend } from '../test/backend';
import { renderInShell } from '../test/render';
import { ExitScreen } from './ExitScreen';

const leg = (id: string, name: string, side: 'buy' | 'sell', qty: string): Leg => ({
  account_id: id,
  account_name: name,
  is_paper: false,
  req: { symbol: 'AAPL', side, type: 'market', time_in_force: 'day', qty, client_order_id: `ta-${id}` },
});
const routes = [
  { path: '/chart/:ticker', element: <p data-testid="chart" /> },
  { path: '/chart/:ticker/exit', element: <ExitScreen /> },
];
const entries = ['/chart/AAPL', '/chart/AAPL/exit'];
const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

test('lists one leg per holding account under "Go flat — N accounts"', async () => {
  mockBackend({ flatten_legs: () => [leg('a', 'IRA', 'sell', '100'), leg('b', 'Paper', 'buy', '20')] });
  await renderInShell(entries, routes);
  expect(screen.getByText('Go flat — 2 accounts')).toBeTruthy();
  expect(screen.getByTestId('leg-a').textContent).toContain('IRA');
  expect(screen.getByTestId('leg-a').textContent).toContain('Sell 100 · market');
  expect(screen.getByTestId('leg-b').textContent).toContain('Buy 20 · market');
});

test('no holdings: "No open position." and Cancel goes back', async () => {
  mockBackend({ flatten_legs: () => [] });
  const { router } = await renderInShell(entries, routes);
  expect(screen.getByTestId('no-position').textContent).toContain('No open position.');
  await click(screen.getByText('Cancel'));
  expect(router.state.location.pathname).toBe('/chart/AAPL');
});

test('a leg can be edited: type, qty, and price', async () => {
  const calls = mockBackend({ flatten_legs: () => [leg('a', 'IRA', 'sell', '100')], submit_flatten: ({ legs }) => ({ results: [], remaining: [], all_ok: true, _legs: legs }) });
  await renderInShell(entries, routes);
  await click(screen.getByTestId('leg-a').querySelector('button')!);
  await click(screen.getByTestId('leg-type-limit'));
  fireEvent.change(screen.getByTestId('leg-qty'), { target: { value: '40' } });
  fireEvent.change(screen.getByTestId('leg-price'), { target: { value: '190.5' } });
  await click(screen.getByTestId('exit-all'));
  const sent = calls.find(c => c.cmd === 'submit_flatten')!.args.legs as Leg[];
  expect(sent[0].req).toMatchObject({ type: 'limit', qty: '40', limit_price: '190.5', stop_price: null, client_order_id: 'ta-a' });
});

test('all legs succeed: notice with the count, then back', async () => {
  mockBackend({
    flatten_legs: () => [leg('a', 'IRA', 'sell', '100'), leg('b', 'Paper', 'buy', '20')],
    submit_flatten: () => ({ results: [{ account_id: 'a', account_name: 'IRA', ok: true, error: null }, { account_id: 'b', account_name: 'Paper', ok: true, error: null }], remaining: [], all_ok: true }),
  });
  const { router } = await renderInShell(entries, routes);
  await click(screen.getByTestId('exit-all'));
  expect(router.state.location.pathname).toBe('/chart/AAPL');
  expect(screen.getByTestId('notice').textContent).toBe('Flat — Exited 2 account(s).');
});

test('a partial failure lists the failures and a retry sends only those legs', async () => {
  const a = leg('a', 'IRA', 'sell', '100');
  const b = leg('b', 'Paper', 'buy', '20');
  let attempt = 0;
  const calls = mockBackend({
    flatten_legs: () => [a, b],
    submit_flatten: ({ legs }) =>
      ++attempt === 1
        ? { results: [{ account_id: 'a', account_name: 'IRA', ok: true, error: null }, { account_id: 'b', account_name: 'Paper', ok: false, error: 'scripted rejection' }], remaining: [b], all_ok: false }
        : { results: (legs as Leg[]).map(l => ({ account_id: l.account_id, account_name: l.account_name, ok: true, error: null })), remaining: [], all_ok: true },
  });
  const { router } = await renderInShell(entries, routes);
  await click(screen.getByTestId('exit-all'));
  expect(screen.getByTestId('exit-failures').textContent).toContain('Paper: scripted rejection');
  expect(screen.queryByTestId('leg-a')).toBeNull();
  expect(screen.getByText('Go flat — 1 accounts')).toBeTruthy();
  await click(screen.getByTestId('exit-all'));
  const sends = calls.filter(c => c.cmd === 'submit_flatten').map(c => (c.args.legs as Leg[]).map(l => l.account_id));
  expect(sends).toEqual([['a', 'b'], ['b']]);
  expect(router.state.location.pathname).toBe('/chart/AAPL');
  expect(screen.getByTestId('notice').textContent).toBe('Flat — Exited 2 account(s).');
});
