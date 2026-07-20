// __tests__/accountsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import AccountsScreen from '../src/screens/AccountsScreen';
import * as ctx from '../src/AccountContext';

jest.mock('../src/AccountContext');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

test('renders account names, the paper badge, and the account id', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [
      { id: 'PA123456', name: 'Paper', key: 'ABCD1234', secret: 'S', broker: 'alpaca', is_paper: true },
    ],
    activeId: 'PA123456',
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
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Paper');
  expect(json).toContain('["paper"]'); // rendered badge Text node for is_paper account
  expect(json).toContain('PA123456'); // account id (broker account number)
  // read-only: no add/edit affordance
  expect(json).not.toContain('Save');
  expect(json).not.toContain('＋');
});

test('a live-only account renders no paper badge', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [
      { id: 'LIVE9999', name: 'Live', key: 'WXYZ5678', secret: 'S', broker: 'alpaca', is_paper: false },
    ],
    activeId: 'LIVE9999',
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
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Live');
  expect(json).toContain('LIVE9999');
  expect(json).not.toContain('["paper"]'); // LIVE account renders no paper badge
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
