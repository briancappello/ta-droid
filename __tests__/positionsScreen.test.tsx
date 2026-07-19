// __tests__/positionsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import PositionsScreen from '../src/screens/PositionsScreen';
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
    activeId: 'a',
    activeAccount: { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' },
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (alpaca.listPositions as jest.Mock).mockResolvedValue([
    {
      symbol: 'AAPL', qty: '100', avg_entry_price: '189.20',
      market_value: '19000', unrealized_pl: '1240', side: 'long', current_price: '190',
    },
  ]);
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
