// __tests__/watchlistsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import WatchlistsScreen from '../src/screens/WatchlistsScreen';
import * as backend from '../src/BackendContext';
import * as techan from '../src/techan';
import * as api from '../src/api';

jest.mock('../src/BackendContext');
jest.mock('../src/techan');
jest.mock('../src/api');

const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;

beforeEach(() => {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (techan.fetchWatchlists as jest.Mock).mockResolvedValue([
    { id: 'w1', name: 'Breakouts' }, { id: 'w2', name: 'Oversold' },
  ]);
  (techan.fetchWatchlistSymbols as jest.Mock).mockResolvedValue(['SMCI']);
  (api.fetchQuotes as jest.Mock).mockResolvedValue([
    { ticker: 'SMCI', date: '2026-01-01', open: 1, high: 1, low: 1, close: 42, volume: 1, prev_close: 40 },
  ]);
  (api.apiQuoteToStockQuote as jest.Mock).mockImplementation((q) => ({
    ticker: q.ticker, name: q.ticker, lastPrice: q.close, change: 2, changePercent: 5, time: '9:41',
  }));
});

test('renders the selected watchlist and its symbols', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Breakouts');
  expect(json).toContain('SMCI');
});

test('shows unavailable when there are no lists', async () => {
  (techan.fetchWatchlists as jest.Mock).mockResolvedValue([]);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('unavailable');
});
