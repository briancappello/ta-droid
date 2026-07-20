// __tests__/accountsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import AccountsScreen from '../src/screens/AccountsScreen';
import * as ctx from '../src/AccountContext';

jest.mock('../src/AccountContext');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

test('renders the accounts list from context', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [
      { id: 'a', name: 'Paper', key: 'ABCD1234', secret: 'S', broker: 'alpaca', is_paper: true },
    ],
    activeId: 'a',
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountsScreen navigation={{ openDrawer: () => {} } as any} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Paper');
});

test('renders the empty state with no accounts', async () => {
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
    tree = ReactTestRenderer.create(
      <AccountsScreen navigation={{ openDrawer: () => {} } as any} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('No accounts');
});
