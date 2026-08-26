// __tests__/positionsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import PositionsScreen from '../src/screens/PositionsScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as broker from '../src/broker';
import type { Position } from '../src/broker';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/strategyTagger', () => ({
  loadTagger: async () => () => 'Unattributed',
}));

const nav = { navigate: jest.fn(), openDrawer: jest.fn(), addListener: undefined } as any;

function held(symbol: string, qty: string, side: 'long' | 'short' = 'long'): Position {
  return {
    asset_id: 'x', symbol, exchange: 'NASDAQ', asset_class: 'us_equity',
    avg_entry_price: '189.20', qty, side, market_value: '19000', cost_basis: '18920',
    unrealized_pl: '1240', unrealized_plpc: '0', unrealized_intraday_pl: '0',
    unrealized_intraday_plpc: '0', current_price: '190', lastday_price: '188',
    change_today: '0', asset_marginable: true,
  };
}

const liveAccount = { id: 'a', name: 'IRA', broker: 'alpaca' as const, is_paper: false, key: 'K', secret: 'S' };
const paperAccount = { id: 'p', name: 'PaperAcct', broker: 'alpaca' as const, is_paper: true, key: 'K', secret: 'S' };

function mockDriver(positions: Position[]) {
  jest.spyOn(broker, 'driverFor').mockReturnValue({
    listPositions: jest.fn().mockResolvedValue(positions),
    listOrders: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: 'o1' } as any),
    closePosition: jest.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [liveAccount],
    activeId: 'a',
    activeAccount: liveAccount,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: { marketstore: 'up', fatechan: 'up' }, setHealth: () => {}, refresh: async () => {},
  });
  mockDriver([held('AAPL', '100')]);
});

test('renders positions grouped by account', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<PositionsScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('AAPL');
  expect(json).toContain('IRA');
});

test('a live account shows no paper badge', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<PositionsScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).not.toContain('paper');
});

test('a paper account shows the paper badge', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [paperAccount],
    activeId: 'p', activeAccount: paperAccount,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  mockDriver([held('AAPL', '100')]);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<PositionsScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('paper');
});

test('prompts to add an account when none exist', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [], activeId: null, activeAccount: null,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<PositionsScreen navigation={nav} />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Add an account');
});
