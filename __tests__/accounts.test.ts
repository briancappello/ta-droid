// __tests__/accounts.test.ts
import Config from 'react-native-config';
import { loadAccounts } from '../src/accounts';
import { readCred } from '../src/secretsBackend';

jest.mock('../src/secretsBackend');

const creds: Record<string, { key: string; secret: string }> = {
  'alpaca:PA1': { key: 'PKEY', secret: 'PSECRET' },
};

beforeEach(() => {
  (readCred as jest.Mock).mockImplementation(
    async (serviceKey: string) => creds[serviceKey] ?? null,
  );
  (Config as { ACCOUNTS_JSON?: string }).ACCOUNTS_JSON = JSON.stringify([
    { broker: 'alpaca', id: 'PA1', name: 'Paper', is_paper: true },
  ]);
});

test('loadAccounts joins build config with provisioned creds', async () => {
  const loaded = await loadAccounts();
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({
    id: 'PA1',
    name: 'Paper',
    broker: 'alpaca',
    is_paper: true,
    key: 'PKEY',
    secret: 'PSECRET',
  });
});

test('accounts with no provisioned cred are skipped', async () => {
  (Config as { ACCOUNTS_JSON?: string }).ACCOUNTS_JSON = JSON.stringify([
    { broker: 'alpaca', id: 'PA1', name: 'Paper', is_paper: true },
    { broker: 'alpaca', id: 'NOPE', name: 'Unprovisioned', is_paper: false },
  ]);
  const loaded = await loadAccounts();
  expect(loaded).toHaveLength(1);
  expect(loaded[0].id).toBe('PA1');
});

test('malformed ACCOUNTS_JSON yields no accounts', async () => {
  (Config as { ACCOUNTS_JSON?: string }).ACCOUNTS_JSON = 'not json';
  expect(await loadAccounts()).toHaveLength(0);
});
