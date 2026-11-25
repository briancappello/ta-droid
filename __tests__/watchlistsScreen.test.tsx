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
const actual = jest.requireActual('../src/watchlists');
const noMeta = { session: null, basis: null, tradingDate: null };

beforeEach(() => {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: { marketstore: 'up', fatechan: 'up' }, setHealth: () => {}, refresh: async () => {},
  });
  (watchlists.fetchWatchlists as jest.Mock).mockResolvedValue([
    { id: 'w1', name: 'Breakouts' }, { id: 'w2', name: 'Oversold' },
  ]);
  (watchlists.fetchWatchlistEntries as jest.Mock).mockResolvedValue({
    meta: noMeta,
    rows: [
      { symbol: 'SMCI', price: 42, priceUp: true, changePct: 3.5, changeUp: true, aggPct: null },
    ],
  });
  // The label helpers are pure; use the real ones.
  for (const fn of ['toWatchMeta', 'sessionLabel', 'basisLabel', 'priorCloseLabel', 'openLabel']) {
    ((watchlists as any)[fn] as jest.Mock).mockImplementation(actual[fn]);
  }
  (watchlists.watchlistStreamKey as jest.Mock).mockImplementation(
    (id: string) => `WATCHLISTS/1Min/${id}`,
  );
  (watchlists.toWatchRow as jest.Mock).mockImplementation((s: any) => ({
    symbol: s.symbol,
    price: s.price ?? null,
    priceUp: null,
    changePct: null,
    changeUp: null,
    aggPct: s.avg_pct_change ?? null,
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

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  return tree;
};

test('hides session/basis when an older server omits them', async () => {
  const json = JSON.stringify((await render()).toJSON());
  expect(json).toContain('SMCI');
  expect(json).not.toContain('session');
  expect(json).not.toContain('basis');
  expect(json).not.toContain('Price vs');
});

test('shows session, basis and the traditional meaning of prior_close/open', async () => {
  (watchlists.fetchWatchlistEntries as jest.Mock).mockResolvedValue({
    meta: { session: 'regular', basis: 'traditional', tradingDate: '2026-11-25' },
    rows: [],
  });
  const json = JSON.stringify((await render()).toJSON());
  expect(json).toContain('Regular session · Traditional basis · 2026-11-25');
  expect(json).toContain('Price vs previous day close, change since regular open');
});

test('a watchlist_update push replaces the metadata (session basis)', async () => {
  let onMsg!: (m: any) => void;
  (streamMod.stream as any).subscribe = jest.fn((_keys, cb) => {
    onMsg = cb;
    return () => {};
  });
  const tree = await render();
  await act(async () => {
    onMsg({
      data: {
        msg_type: 'watchlist_update',
        payload: {
          name: 'w1',
          symbols: [{ symbol: 'NVDA', price: 10 }],
          basis: 'session',
          session: 'premarket',
          trading_date: '2026-11-25',
          as_of: 1764054000,
        },
      },
    });
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('NVDA');
  expect(json).toContain('Premarket session · Session basis · 2026-11-25');
  expect(json).toContain('Price vs previous after-hours close, change since premarket open');
});

test('a push from an older server, without metadata, hides it', async () => {
  (watchlists.fetchWatchlistEntries as jest.Mock).mockResolvedValue({
    meta: { session: 'regular', basis: 'session', tradingDate: '2026-11-25' },
    rows: [],
  });
  let onMsg!: (m: any) => void;
  (streamMod.stream as any).subscribe = jest.fn((_keys, cb) => {
    onMsg = cb;
    return () => {};
  });
  const tree = await render();
  expect(JSON.stringify(tree.toJSON())).toContain('premarket close');
  await act(async () => {
    onMsg({ data: { msg_type: 'watchlist_update', payload: { symbols: [{ symbol: 'NVDA', price: 10 }] } } });
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('NVDA');
  expect(json).not.toContain('basis');
  expect(json).not.toContain('Price vs');
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
