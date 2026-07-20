// __tests__/orderEntryScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import OrderEntryScreen from '../src/screens/OrderEntryScreen';
import * as ctx from '../src/AccountContext';

jest.mock('../src/AccountContext');
jest.mock('../src/alpaca');
// AccountPicker still reads the removed `env` field; B4 repoints it to is_paper.
// ponytail: stub it here so this screen's test doesn't depend on B4 landing first.
jest.mock('../src/components/AccountPicker', () => ({ AccountPicker: () => null }));

const account = { id: 'a', name: 'Paper', broker: 'alpaca' as const, is_paper: true, key: 'K', secret: 'S' };

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [account],
    activeId: 'a',
    activeAccount: account,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
});

test('renders a New Order form with the symbol from params', async () => {
  const route = { params: { accountId: 'a', symbol: 'AAPL' } } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <OrderEntryScreen route={route} navigation={nav} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('AAPL');
});

test('modify mode shows read-only symbol from the order', async () => {
  const route = {
    params: {
      accountId: 'a',
      order: {
        id: 'o1',
        symbol: 'TSLA',
        qty: '10',
        notional: null,
        side: 'buy',
        type: 'limit',
        time_in_force: 'day',
        limit_price: '240',
        stop_price: null,
        trail_percent: null,
        status: 'new',
      },
    },
  } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <OrderEntryScreen route={route} navigation={nav} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('TSLA');
});
