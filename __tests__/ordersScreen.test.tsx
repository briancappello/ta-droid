// __tests__/ordersScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import OrdersScreen from '../src/screens/OrdersScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as alpaca from '../src/alpaca';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/alpaca');

const nav = { navigate: jest.fn(), openDrawer: jest.fn(), addListener: undefined } as any;

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [{ id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' }],
    activeId: 'a', activeAccount: { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' },
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (alpaca.listOpenOrders as jest.Mock).mockResolvedValue([
    {
      id: 'o1', symbol: 'MSFT', qty: '10', notional: null, side: 'buy',
      type: 'limit', time_in_force: 'day', limit_price: '390', stop_price: null,
      trail_percent: null, status: 'new',
    },
  ]);
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
