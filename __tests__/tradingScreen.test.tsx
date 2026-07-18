// __tests__/tradingScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import TradingScreen from '../src/screens/TradingScreen';
import * as ctx from '../src/AccountContext';
import * as alpaca from '../src/alpaca';

jest.mock('../src/AccountContext');
jest.mock('../src/alpaca');

const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [{ id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' }],
    activeId: 'a',
    activeAccount: { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' },
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (alpaca.listPositions as jest.Mock).mockResolvedValue([
    {
      symbol: 'AAPL',
      qty: '100',
      avg_entry_price: '189.20',
      market_value: '19000',
      unrealized_pl: '1240',
      side: 'long',
      current_price: '190',
    },
  ]);
  (alpaca.listOpenOrders as jest.Mock).mockResolvedValue([]);
});

test('renders positions for the active account', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<TradingScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('AAPL');
});

test('prompts to add an account when none is active', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [],
    activeId: null,
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<TradingScreen navigation={nav} />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Add an account');
});
