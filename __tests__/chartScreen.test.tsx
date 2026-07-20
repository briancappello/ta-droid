// __tests__/chartScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ChartScreen from '../src/screens/ChartScreen';
import * as ctx from '../src/AccountContext';
import * as flatten from '../src/flatten';
import { fetchHistory } from '../src/api';

jest.mock('../src/AccountContext');
jest.mock('../src/flatten');
jest.mock('../src/api');
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const account = { id: 'a', name: 'IRA', broker: 'alpaca' as const, is_paper: false, key: 'K', secret: 'S' };

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [account], activeId: 'a', activeAccount: account,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (fetchHistory as jest.Mock).mockResolvedValue({ columns: [], index: [], data: [] });
});

test('shows Exit and a positions strip when the symbol is held', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([
    { account, position: {
      symbol: 'AAPL', qty: '100', avg_entry_price: '189.20', market_value: '19000',
      unrealized_pl: '1240', side: 'long', current_price: '190',
    } },
  ]);
  const route = { params: { ticker: 'AAPL' } } as any;
  const nav = { navigate: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Exit');
  expect(json).toContain('IRA');
});

test('no Exit button when the symbol is not held', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([]);
  const route = { params: { ticker: 'SMCI' } } as any;
  const nav = { navigate: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).not.toContain('Exit');
});
