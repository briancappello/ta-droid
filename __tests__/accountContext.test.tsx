// __tests__/accountContext.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import Config from 'react-native-config';
import { AccountProvider, useAccounts } from '../src/AccountContext';
import * as accounts from '../src/accounts';
import { readFingerprint } from '../src/secretsBackend';
import * as Keychain from 'react-native-keychain';

jest.mock('react-native-keychain');
jest.mock('../src/accounts');
jest.mock('../src/secretsBackend');

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
  (readFingerprint as jest.Mock).mockResolvedValue(null);
  // Default: no blob → provisioning gate resolves 'ready'.
  (Config as { CREDENTIALS_BLOB_JSON?: string }).CREDENTIALS_BLOB_JSON = undefined;
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
  expect(latest!.provStatus).toBe('ready');
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

test('a blob whose fingerprint differs from stored requires a passphrase', async () => {
  // blob is read at AccountContext module-eval time, so set Config then re-require.
  (Config as { CREDENTIALS_BLOB_JSON?: string }).CREDENTIALS_BLOB_JSON =
    JSON.stringify({ salt: 's', nonce: 'n', ciphertext: 'c', fingerprint: 'FP_SHIPPED' });

  let status: string | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('react-native-keychain');
    jest.doMock('../src/accounts');
    jest.doMock('../src/secretsBackend');
    const R = require('react');
    const RTR = require('react-test-renderer');
    const acc = require('../src/accounts');
    const sb = require('../src/secretsBackend');
    (acc.loadAccounts as jest.Mock).mockResolvedValue([A, B]);
    (sb.readFingerprint as jest.Mock).mockResolvedValue('FP_STORED');
    const { AccountProvider: FreshProvider, useAccounts: useFresh } =
      require('../src/AccountContext');

    function FreshProbe() {
      status = useFresh().provStatus;
      return null;
    }

    await RTR.act(async () => {
      RTR.create(R.createElement(FreshProvider, null, R.createElement(FreshProbe)));
    });
  });
  expect(status).toBe('need-passphrase');
});
