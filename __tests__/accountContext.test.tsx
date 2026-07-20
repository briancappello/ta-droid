// __tests__/accountContext.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { AccountProvider, useAccounts } from '../src/AccountContext';
import * as accounts from '../src/accounts';
import * as Keychain from 'react-native-keychain';

jest.mock('react-native-keychain');
jest.mock('../src/accounts');

const A = { id: 'a', name: 'Paper', key: 'K', secret: 'S', broker: 'alpaca' as const, is_paper: true };
const B = { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', broker: 'alpaca' as const, is_paper: false };

function Probe({ onReady }: { onReady: (v: ReturnType<typeof useAccounts>) => void }) {
  const v = useAccounts();
  onReady(v);
  return <Text>{v.activeAccount?.name ?? 'none'}</Text>;
}

beforeEach(() => {
  (accounts.loadAccounts as jest.Mock).mockResolvedValue([A, B]);
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
});

test('provider loads accounts and defaults active to the first', async () => {
  let latest: ReturnType<typeof useAccounts> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <AccountProvider>
        <Probe onReady={v => (latest = v)} />
      </AccountProvider>,
    );
  });
  expect(latest!.accounts).toHaveLength(2);
  expect(latest!.activeAccount?.id).toBe('a');
});

test('setActiveId switches the active account', async () => {
  let latest: ReturnType<typeof useAccounts> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <AccountProvider>
        <Probe onReady={v => (latest = v)} />
      </AccountProvider>,
    );
  });
  await act(async () => {
    latest!.setActiveId('b');
  });
  expect(latest!.activeAccount?.id).toBe('b');
});
