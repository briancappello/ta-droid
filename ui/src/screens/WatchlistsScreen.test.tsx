// Ported from __tests__/watchlistsScreen.test.tsx, plus live updates and the
// subscription lifecycle.
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { WatchRow } from '../bindings/WatchRow';
import { channelSender, mockBackend } from '../test/backend';
import { renderAt } from '../test/render';
import { WatchlistsScreen } from './WatchlistsScreen';

const row = (o: Partial<WatchRow>): WatchRow => ({
  symbol: 'X', price: null, price_up: null, change_pct: null, change_up: null, agg_pct: null, ...o,
});

function lists() {
  let push: ((rows: WatchRow[]) => void) | null = null;
  let nextSub = 1;
  const calls = mockBackend({
    watchlists: () => [
      { id: 'w1', name: 'Breakouts' },
      { id: 'w2', name: 'Oversold' },
    ],
    watchlist_entries: ({ id }) =>
      id === 'w1'
        ? [row({ symbol: 'SMCI', price: 42, price_up: true, change_pct: 3.5, change_up: true }), row({ symbol: 'PENNY', price: 0.42, price_up: false, change_pct: -1.25, change_up: false })]
        : [row({ symbol: 'Industrials', agg_pct: 8.07 }), row({ symbol: 'NODATA' })],
    subscribe_watchlist: ({ onRows }) => {
      push = channelSender<WatchRow[]>(onRows);
      return nextSub++;
    },
  });
  return { calls, push: (r: WatchRow[]) => push!(r) };
}

const routes = [
  { path: '/watchlists', element: <WatchlistsScreen /> },
  { path: '/chart/:ticker', element: <p data-testid="chart" /> },
];

test('renders the first watchlist with prices, colors, and signed change', async () => {
  lists();
  await renderAt('/watchlists', routes);
  expect(screen.getByTestId('watchlist-picker').textContent).toBe('Breakouts ▾');
  const smci = screen.getByTestId('watch-row-SMCI');
  expect(smci.textContent).toContain('42.00');
  expect(smci.textContent).toContain('+3.50%');
  expect((smci.querySelector('[data-testid="price"]') as HTMLElement).style.color).toBe('rgb(76, 175, 80)');
  const penny = screen.getByTestId('watch-row-PENNY');
  expect(penny.textContent).toContain('0.4200');
  expect(penny.textContent).toContain('-1.25%');
  expect((penny.querySelector('[data-testid="change"]') as HTMLElement).style.color).toBe('rgb(244, 67, 54)');
});

test('shows unavailable when there are no lists or listing fails', async () => {
  mockBackend({ watchlists: () => [] });
  await renderAt('/watchlists', routes);
  expect(screen.getByTestId('watchlists-unavailable').textContent).toBe('Watchlists unavailable.');
});

test('listing failure is also unavailable', async () => {
  mockBackend({ watchlists: () => { throw { message: "Can't reach market data — check your connection." }; } });
  await renderAt('/watchlists', routes);
  expect(screen.getByText('Watchlists unavailable.')).toBeTruthy();
});

test('a watchlist_update replaces every row', async () => {
  const b = lists();
  await renderAt('/watchlists', routes);
  await act(async () => b.push([row({ symbol: 'NEW', price: 10, price_up: true, change_pct: 0, change_up: true })]));
  expect(screen.queryByTestId('watch-row-SMCI')).toBeNull();
  expect(screen.getByTestId('watch-row-NEW').textContent).toContain('+0.00%');
});

test('switching list unsubscribes the old stream; aggregates and empty rows render', async () => {
  const b = lists();
  await renderAt('/watchlists', routes);
  fireEvent.click(screen.getByTestId('watchlist-picker'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('watchlist-option-w2'));
  });
  await act(async () => {});
  expect(b.calls.filter(c => c.cmd === 'subscribe_watchlist').map(c => c.args.id)).toEqual(['w1', 'w2']);
  expect(b.calls.filter(c => c.cmd === 'unsubscribe').map(c => c.args.id)).toEqual([1]);
  expect(screen.getByTestId('watch-row-Industrials').textContent).toContain('+8.07%');
  expect(screen.getByTestId('watch-row-NODATA').textContent).toContain('--');
});

test('tapping a row opens its chart', async () => {
  lists();
  const { router } = await renderAt('/watchlists', routes);
  fireEvent.click(screen.getByTestId('watch-row-SMCI'));
  expect(router.state.location.pathname).toBe('/chart/SMCI');
});

test('leaving the screen unsubscribes', async () => {
  const b = lists();
  const { unmount } = await renderAt('/watchlists', routes);
  unmount();
  await act(async () => {});
  expect(b.calls.filter(c => c.cmd === 'unsubscribe').length).toBe(1);
});
