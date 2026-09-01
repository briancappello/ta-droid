// __tests__/chartScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ChartScreen from '../src/screens/ChartScreen';
import * as ctx from '../src/AccountContext';
import * as flatten from '../src/flatten';
import { fetchHistory } from '../src/api';
import { stream } from '../src/marketstoreStream';

jest.mock('../src/AccountContext');
jest.mock('../src/flatten');
jest.mock('../src/api');
jest.mock('../src/marketstoreStream', () => ({
  stream: { subscribe: jest.fn(() => () => {}) },
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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

test('subscribes to the ticker OHLCV stream', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([]);
  const route = { params: { ticker: 'AAPL' } } as any;
  const nav = { navigate: jest.fn() } as any;
  await act(async () => {
    ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  const keys = (stream.subscribe as jest.Mock).mock.calls.map(c => c[0][0]);
  expect(keys.some((k: string) => k.startsWith('AAPL/') && k.endsWith('/OHLCV'))).toBe(true);
});

test('header shows the ticker; Trade opens OrderEntry and nav opens the drawer', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([]);
  const route = { params: { ticker: 'SMCI' } } as any;
  const nav = { navigate: jest.fn(), dispatch: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('SMCI');

  const trade = tree.root.findAll(n => n.props.accessibilityLabel === 'Trade')[0];
  act(() => trade.props.onPress());
  expect(nav.navigate).toHaveBeenCalledWith(
    'OrderEntry',
    expect.objectContaining({ symbol: 'SMCI' }),
  );

  const menu = tree.root.findAll(
    n => n.props.accessibilityLabel === 'Open navigation menu',
  )[0];
  act(() => menu.props.onPress());
  expect(nav.dispatch).toHaveBeenCalled();
});

test('typing a symbol and submitting switches the chart via setParams', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([]);
  const route = { params: { ticker: 'AAPL' } } as any;
  const nav = { navigate: jest.fn(), setParams: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  const find = () =>
    tree.root.findAll(n => n.props.accessibilityLabel === 'Switch symbol')[0];
  expect(find().props.value).toBe('AAPL'); // shows the live ticker, not blank
  act(() => find().props.onChangeText('tsla'));
  act(() => find().props.onSubmitEditing());
  expect(nav.setParams).toHaveBeenCalledWith({ ticker: 'TSLA' });
});

test('symbol input snaps back to the ticker on a no-op submit', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([]);
  const route = { params: { ticker: 'AAPL' } } as any;
  const nav = { navigate: jest.fn(), setParams: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  const find = () =>
    tree.root.findAll(n => n.props.accessibilityLabel === 'Switch symbol')[0];
  act(() => find().props.onChangeText(''));
  act(() => find().props.onSubmitEditing());
  expect(nav.setParams).not.toHaveBeenCalled();
  expect(find().props.value).toBe('AAPL');
});
