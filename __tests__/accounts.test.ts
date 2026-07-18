// __tests__/accounts.test.ts
import {
  loadAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
} from '../src/accounts';
import * as Keychain from 'react-native-keychain';

jest.mock('react-native-keychain');

// In-memory fake keychain keyed by service.
let store: Record<string, { username: string; password: string }>;

beforeEach(() => {
  store = {};
  (Keychain.setGenericPassword as jest.Mock).mockImplementation(
    async (username: string, password: string, opts: { service: string }) => {
      store[opts.service] = { username, password };
      return true;
    },
  );
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    async (opts: { service: string }) => store[opts.service] ?? false,
  );
  (Keychain.resetGenericPassword as jest.Mock).mockImplementation(
    async (opts: { service: string }) => {
      delete store[opts.service];
      return true;
    },
  );
});

test('addAccount persists and loadAccounts returns it with secrets', async () => {
  const created = await addAccount({
    name: 'Paper',
    key: 'PKEY',
    secret: 'PSECRET',
    env: 'paper',
  });
  expect(created.id).toBeTruthy();
  const loaded = await loadAccounts();
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({
    name: 'Paper',
    key: 'PKEY',
    secret: 'PSECRET',
    env: 'paper',
  });
});

test('the metadata blob never contains secrets', async () => {
  await addAccount({ name: 'IRA', key: 'LKEY', secret: 'LSECRET', env: 'live' });
  const metaBlob = store['alpaca.accounts.meta'].password;
  expect(metaBlob).not.toContain('LKEY');
  expect(metaBlob).not.toContain('LSECRET');
});

test('updateAccount changes name/env and secrets', async () => {
  const a = await addAccount({
    name: 'Old',
    key: 'K',
    secret: 'S',
    env: 'paper',
  });
  await updateAccount({ ...a, name: 'New', env: 'live', secret: 'S2' });
  const loaded = await loadAccounts();
  expect(loaded[0]).toMatchObject({ name: 'New', env: 'live', secret: 'S2' });
});

test('deleteAccount removes meta and secret entry', async () => {
  const a = await addAccount({
    name: 'Temp',
    key: 'K',
    secret: 'S',
    env: 'paper',
  });
  await deleteAccount(a.id);
  expect(await loadAccounts()).toHaveLength(0);
  expect(store[`alpaca.account.${a.id}`]).toBeUndefined();
});
