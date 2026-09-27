// Ported from __tests__/positionsScreen.test.tsx and ordersScreen.test.tsx,
// plus the error banner and the strategy filter on real screens.
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { AccountView } from '../bindings/AccountView';
import { mockBackend } from '../test/backend';
import { renderAt } from '../test/render';
import { OrdersScreen } from './OrdersScreen';
import { PositionsScreen } from './PositionsScreen';

const live: AccountView = { id: 'a', name: 'IRA', broker: 'alpaca', is_paper: false, key_last4: 'K' };
const paper: AccountView = { id: 'p', name: 'PaperAcct', broker: 'alpaca', is_paper: true, key_last4: 'K' };
const pos = (symbol: string, pl = '1240') => ({
  symbol, qty: '100', side: 'long', avg_entry_price: '189.20', market_value: '19000', unrealized_pl: pl,
  asset_id: null, exchange: null, asset_class: null, qty_available: null, cost_basis: null,
  unrealized_plpc: null, current_price: null, lastday_price: null, change_today: null,
});
const ord = (id: string, symbol: string) => ({
  id, client_order_id: 'c', symbol, type: 'limit', side: 'buy', status: 'new', time_in_force: 'day',
  qty: '10', notional: null, filled_qty: '0', limit_price: '390', stop_price: null, trail_percent: null,
  trail_price: null, extended_hours: false, created_at: null,
});
const accounts = (list: AccountView[]) => ({ list_accounts: () => ({ accounts: list, active_id: list[0]?.id ?? null }) });
const routes = [
  { path: '/positions', element: <PositionsScreen /> },
  { path: '/orders', element: <OrdersScreen /> },
  { path: '/chart/:ticker', element: <p data-testid="chart" /> },
  { path: '/settings/accounts', element: <p data-testid="accounts" /> },
];

test('positions render grouped by account with money formatting', async () => {
  mockBackend({ ...accounts([live]), positions: () => [{ account: live, rows: [{ item: pos('AAPL'), strategy: 'Unattributed' }], error: null }] });
  await renderAt('/positions', routes);
  const row = screen.getByTestId('position-a-AAPL');
  expect(row.textContent).toContain('100 @ $189.20');
  expect(row.textContent).toContain('$19,000.00');
  expect(row.textContent).toContain('$1,240.00');
  expect(screen.getByTestId('bucket-a').textContent).toContain('IRA');
  expect(screen.getByTestId('bucket-pl').textContent).toBe('$1,240.00');
});

test('a live account shows no paper badge; a paper account does', async () => {
  mockBackend({ ...accounts([live, paper]), positions: () => [
    { account: live, rows: [{ item: pos('AAPL'), strategy: 'U' }], error: null },
    { account: paper, rows: [{ item: pos('MSFT', '-5'), strategy: 'U' }], error: null },
  ] });
  await renderAt('/positions', routes);
  expect(screen.getByTestId('bucket-a').textContent).not.toContain('paper');
  expect(screen.getByTestId('bucket-p').textContent).toContain('paper');
  expect(screen.getAllByTestId('bucket-pl')[1].style.color).toBe('rgb(244, 67, 54)');
});

test('prompts to add an account when none exist', async () => {
  mockBackend({ positions: () => [] });
  const { router } = await renderAt('/positions', routes);
  expect(screen.getByTestId('no-accounts').textContent).toContain('Add an account to start trading.');
  fireEvent.click(screen.getByText('Go to Accounts'));
  expect(router.state.location.pathname).toBe('/settings/accounts');
});

test('a failing account shows the banner and the others still render', async () => {
  mockBackend({ ...accounts([live, paper]), positions: () => [
    { account: live, rows: [], error: 'Check the API keys for this account.' },
    { account: paper, rows: [{ item: pos('MSFT'), strategy: 'U' }], error: null },
  ] });
  await renderAt('/positions', routes);
  expect(screen.getByTestId('book-error').textContent).toBe('Check the API keys for this account.');
  expect(screen.getByTestId('position-p-MSFT')).toBeTruthy();
});

test('the strategy filter narrows rows and keeps account groups', async () => {
  mockBackend({ ...accounts([live]), positions: () => [
    { account: live, rows: [{ item: pos('AAPL'), strategy: 'Momentum' }, { item: pos('NVDA'), strategy: 'Unattributed' }], error: null },
  ] });
  await renderAt('/positions', routes);
  fireEvent.click(screen.getByTestId('strategy-filter'));
  fireEvent.click(screen.getByTestId('strategy-option-Momentum'));
  expect(screen.getByTestId('strategy-filter').textContent).toBe('Strategy: Momentum ▾');
  expect(screen.queryByTestId('position-a-NVDA')).toBeNull();
  expect(screen.getByTestId('position-a-AAPL')).toBeTruthy();
});

test('refresh reloads, and a row opens its chart', async () => {
  const calls = mockBackend({ ...accounts([live]), positions: () => [{ account: live, rows: [{ item: pos('AAPL'), strategy: 'U' }], error: null }] });
  const { router } = await renderAt('/positions', routes);
  await act(async () => {
    fireEvent.click(screen.getByTestId('refresh'));
  });
  expect(calls.filter(c => c.cmd === 'positions').length).toBe(2);
  fireEvent.click(screen.getByTestId('position-a-AAPL'));
  expect(router.state.location.pathname).toBe('/chart/AAPL');
});

test('orders render grouped by account with a working count', async () => {
  mockBackend({ ...accounts([live]), orders: () => [{ account: live, rows: [{ item: ord('o1', 'MSFT'), strategy: 'U' }], error: null }] });
  await renderAt('/orders', routes);
  const row = screen.getByTestId('order-o1');
  expect(row.textContent).toContain('MSFT');
  expect(row.textContent).toContain('Buy limit');
  expect(row.textContent).toContain('10 @ 390');
  expect(row.textContent).toContain('new');
  expect(screen.getByTestId('bucket-a').textContent).toContain('1 working');
});

test('orders: paper badge only on paper accounts', async () => {
  mockBackend({ ...accounts([paper]), orders: () => [{ account: paper, rows: [{ item: ord('o1', 'MSFT'), strategy: 'U' }], error: null }] });
  await renderAt('/orders', routes);
  expect(screen.getByTestId('bucket-p').textContent).toContain('paper');
});
