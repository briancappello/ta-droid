// __tests__/watchlistsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import WatchlistsScreen from '../src/screens/WatchlistsScreen';
import * as backend from '../src/BackendContext';
import * as watchlists from '../src/watchlists';
import * as streamMod from '../src/marketstoreStream';

jest.mock('../src/BackendContext');
jest.mock('../src/watchlists');
jest.mock('../src/marketstoreStream');

const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;

beforeEach(() => {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: { marketstore: 'up', fatechan: 'up' }, setHealth: () => {}, refresh: async () => {},
  });
  (watchlists.fetchWatchlists as jest.Mock).mockResolvedValue([
    { id: 'w1', name: 'Breakouts' }, { id: 'w2', name: 'Oversold' },
  ]);
  (watchlists.fetchWatchlistEntries as jest.Mock).mockResolvedValue([
    { symbol: 'SMCI', price: 42, change: 2, changePct: 5 },
  ]);
  (watchlists.watchlistStreamKey as jest.Mock).mockImplementation(
    (id: string) => `WATCHLISTS/1Min/${id}`,
  );
  (watchlists.toWatchRow as jest.Mock).mockImplementation((s: any) => ({
    symbol: s.symbol,
    price: s.price ?? null,
    change: null,
    changePct: s.pct_change ?? null,
  }));
  (streamMod.stream as any).subscribe = jest.fn(() => () => {});
});

test('renders the selected watchlist with streamed price rows', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Breakouts');
  expect(json).toContain('SMCI');
  expect(json).toContain('42.00');
});

test('shows unavailable when there are no lists', async () => {
  (watchlists.fetchWatchlists as jest.Mock).mockResolvedValue([]);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('unavailable');
});
