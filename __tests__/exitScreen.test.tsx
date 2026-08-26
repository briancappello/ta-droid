// __tests__/exitScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ExitScreen from '../src/screens/ExitScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as flatten from '../src/flatten';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/flatten');

const account = { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' as const };

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [account], activeId: 'a', activeAccount: account,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: { marketstore: 'up', fatechan: 'up' }, setHealth: () => {}, refresh: async () => {},
  });
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([
    { account, position: {
      symbol: 'AAPL', qty: '100', avg_entry_price: '189', market_value: '19000',
      unrealized_pl: '1240', side: 'long', current_price: '190',
    } },
  ]);
  (flatten.flattenPlan as jest.Mock).mockReturnValue([
    { account, req: { symbol: 'AAPL', side: 'sell', type: 'market', time_in_force: 'day', qty: '100' } },
  ]);
});

test('lists the account exit leg for the symbol', async () => {
  const route = { params: { symbol: 'AAPL' } } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ExitScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('IRA');
  expect(json).toContain('Go flat');
});
