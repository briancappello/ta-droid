// __tests__/ordersScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import OrdersScreen from '../src/screens/OrdersScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as broker from '../src/broker';
import type { Order } from '../src/broker';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/strategyTagger', () => ({
  loadTagger: async () => () => 'Unattributed',
}));

const nav = { navigate: jest.fn(), openDrawer: jest.fn(), addListener: undefined } as any;

function order(id: string, symbol: string): Order {
  return {
    id, client_order_id: 'c', created_at: '', updated_at: null, submitted_at: null,
    filled_at: null, expired_at: null, canceled_at: null, failed_at: null,
    replaced_at: null, replaced_by: null, replaces: null, asset_id: 'x',
    symbol, asset_class: 'us_equity', notional: null, qty: '10', filled_qty: '0',
    filled_avg_price: null, order_class: 'simple', type: 'limit', side: 'buy',
    position_intent: 'buy_to_open', time_in_force: 'day', limit_price: '390',
    stop_price: null, status: 'new', extended_hours: false, trail_percent: null,
    trail_price: null, hwm: null, ratio_qty: null,
    expires_at: '', legs: null, order_type: 'limit',
  };
}

const liveAccount = { id: 'a', name: 'IRA', broker: 'alpaca' as const, is_paper: false, key: 'K', secret: 'S' };
const paperAccount = { id: 'p', name: 'PaperAcct', broker: 'alpaca' as const, is_paper: true, key: 'K', secret: 'S' };

function mockDriver(orders: Order[]) {
  jest.spyOn(broker, 'driverFor').mockReturnValue({
    listPositions: jest.fn().mockResolvedValue([]),
    listOrders: jest.fn().mockResolvedValue(orders),
    createOrder: jest.fn().mockResolvedValue({ id: 'o1' } as any),
    closePosition: jest.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [liveAccount],
    activeId: 'a', activeAccount: liveAccount,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  mockDriver([order('o1', 'MSFT')]);
});

test('renders orders grouped by account', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<OrdersScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('MSFT');
  expect(json).toContain('IRA');
});

test('a live account shows no paper badge', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<OrdersScreen navigation={nav} />);
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
  mockDriver([order('o1', 'MSFT')]);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<OrdersScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('paper');
});
