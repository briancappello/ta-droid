// Ported from __tests__/chartScreen.test.tsx, plus ranges, states, and live
// bars. The canvas panes are stubbed (jsdom has no canvas); G3 draws them.
import { act, fireEvent, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { expect, test, vi } from 'vitest';
import type { LiveBar } from '../bindings/LiveBar';
import { channelSender, mockBackend } from '../test/backend';
import { renderAt } from '../test/render';
import { ChartScreen } from './ChartScreen';

const pushed: unknown[] = [];
vi.mock('../chart/ChartPanes', () => ({
  ChartPanes: forwardRef(function Stub(props: { range: string; series: { candles: unknown[] } }, ref) {
    useImperativeHandle(ref, () => ({ pushBar: (b: unknown) => pushed.push(b) }));
    return <div data-testid="chart-panes" data-range={props.range} data-bars={props.series.candles.length} />;
  }),
}));

const COLS = ['open', 'high', 'low', 'close', 'volume', 'sma20', 'sma100', 'sma200', 'bbands_upper', 'bbands_lower', 'macd', 'macd_signal', 'macd_difference', 'rsi'];
const DAY = 86_400_000;
const days = (n: number) => Array.from({ length: n }, (_, i) => Date.UTC(2026, 8, 25) - (n - 1 - i) * DAY);
const hist = (index: number[]) => ({ columns: COLS, index, data: index.map((_, i) => [1, 2, 0.5, 100 + i, 10, null, null, null, null, null, null, null, null, null]) });

const holding = { account_id: 'a', account_name: 'IRA', is_paper: false, qty: '100', avg_entry_price: '189.20', unrealized_pl: '1240' };
const routes = [
  { path: '/chart/:ticker', element: <ChartScreen /> },
  { path: '/chart/:ticker/order', element: <p data-testid="order" /> },
  { path: '/chart/:ticker/exit', element: <p data-testid="exit-screen" /> },
];

test('shows Exit and a positions strip when the symbol is held', async () => {
  mockBackend({ symbol_holdings: () => [holding], history: () => hist(days(5)) });
  await renderAt('/chart/AAPL', routes);
  expect(screen.getByTestId('exit')).toBeTruthy();
  expect(screen.getByTestId('positions-strip').textContent).toBe('IRA · 100 @ 189.20+1240');
});

test('no Exit button or strip when the symbol is not held', async () => {
  mockBackend();
  await renderAt('/chart/SMCI', routes);
  expect(screen.queryByTestId('exit')).toBeNull();
  expect(screen.queryByTestId('positions-strip')).toBeNull();
});

test('subscribes to the ticker OHLCV stream for the current frequency', async () => {
  const calls = mockBackend();
  await renderAt('/chart/AAPL', routes);
  expect(calls.find(c => c.cmd === 'subscribe_bars')?.args).toMatchObject({ symbol: 'AAPL', timeframe: '1D' });
});

test('header shows the ticker; Trade opens order entry with the active account', async () => {
  mockBackend({ list_accounts: () => ({ accounts: [], active_id: 'a' }) });
  const { router } = await renderAt('/chart/SMCI', routes);
  expect((screen.getByTestId('symbol-input') as HTMLInputElement).value).toBe('SMCI');
  fireEvent.click(screen.getByTestId('trade'));
  expect(router.state.location.pathname).toBe('/chart/SMCI/order');
  expect(router.state.location.state).toEqual({ symbol: 'SMCI', accountId: 'a' });
});

test('typing a symbol and pressing Enter switches the chart', async () => {
  const calls = mockBackend();
  const { router } = await renderAt('/chart/AAPL', routes);
  const input = screen.getByTestId('symbol-input');
  fireEvent.change(input, { target: { value: 'tsla' } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  expect(router.state.location.pathname).toBe('/chart/TSLA');
  expect(calls.filter(c => c.cmd === 'history').map(c => c.args.symbol)).toContain('TSLA');
});

test('an empty or unchanged submit, or leaving the field, snaps back', async () => {
  mockBackend();
  const { router } = await renderAt('/chart/AAPL', routes);
  const input = screen.getByTestId('symbol-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input.value).toBe('AAPL');
  fireEvent.change(input, { target: { value: 'MS' } });
  fireEvent.blur(input);
  expect(input.value).toBe('AAPL');
  expect(router.state.location.pathname).toBe('/chart/AAPL');
});

test('opens at 1Y daily; a range change resets the frequency', async () => {
  const calls = mockBackend({ history: () => hist(days(5)) });
  await renderAt('/chart/AAPL', routes);
  expect(screen.getByTestId('range-1Y').getAttribute('aria-pressed')).toBe('true');
  expect(calls.filter(c => c.cmd === 'history').at(-1)?.args).toMatchObject({ freq: 'D' });
  await act(async () => {
    fireEvent.click(screen.getByTestId('range-1D'));
  });
  expect(screen.getByTestId('freq-picker').textContent).toBe('1min ▼');
  expect(calls.filter(c => c.cmd === 'history').at(-1)?.args).toMatchObject({ freq: '1min' });
  expect(calls.filter(c => c.cmd === 'subscribe_bars').at(-1)?.args).toMatchObject({ timeframe: '1Min' });
});

test('the window ends at the latest bar and the last price is the last close', async () => {
  mockBackend({ history: () => hist(days(400)) });
  await renderAt('/chart/AAPL', routes);
  // 1Y keeps bars within 365 days of the latest: 366 of the 400 daily bars.
  expect(screen.getByTestId('chart-panes').getAttribute('data-bars')).toBe('366');
  expect(screen.getByTestId('last-price').textContent).toBe('499.00');
});

test('loading spinner, then the error text or the empty-range message', async () => {
  let reject!: (e: unknown) => void;
  mockBackend({ history: () => new Promise((_, r) => (reject = r)) });
  await renderAt('/chart/NOPE', routes);
  expect(screen.getByTestId('chart-loading')).toBeTruthy();
  await act(async () => reject({ message: 'symbol not found' }));
  expect(screen.getByTestId('chart-error').textContent).toBe('symbol not found');
});

test('no bars shows the empty-range message', async () => {
  mockBackend();
  await renderAt('/chart/EMPTY', routes);
  expect(screen.getByTestId('chart-error').textContent).toBe('No data available for this range');
});

test('a live bar updates the last price and is pushed to the chart', async () => {
  let send!: (b: LiveBar) => void;
  mockBackend({
    history: () => hist(days(5)),
    subscribe_bars: ({ onBar }) => {
      send = channelSender<LiveBar>(onBar);
      return 1;
    },
  });
  await renderAt('/chart/AAPL', routes);
  pushed.length = 0;
  const epoch = Date.UTC(2026, 8, 25, 15, 0) / 1000;
  await act(async () => send({ symbol: 'AAPL', open: 1, high: 2, low: 1, close: 123.456, volume: 5, epoch }));
  expect(screen.getByTestId('last-price').textContent).toBe('123.46');
  expect(pushed).toEqual([{ time: epoch - 4 * 3600, open: 1, high: 2, low: 1, close: 123.456, volume: 5 }]);
});
