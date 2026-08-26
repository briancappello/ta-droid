// __tests__/settingsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import SettingsScreen from '../src/screens/SettingsScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [
      { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' },
      { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', env: 'live' },
    ],
    activeId: 'a',
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: { marketstore: 'up', fatechan: 'up' },
    setHealth: () => {},
    refresh: async () => {},
  });
});

test('renders Accounts and Backend rows with account count', async () => {
  const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<SettingsScreen navigation={nav} />);
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Accounts');
  expect(json).toContain('Backend');
  expect(json).toContain('2 linked');
});
