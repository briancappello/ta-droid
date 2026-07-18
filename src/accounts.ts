// src/accounts.ts
import * as Keychain from 'react-native-keychain';
import type { Account, AlpacaEnv } from './alpaca';

export type AccountMeta = { id: string; name: string; env: AlpacaEnv };

const META_SERVICE = 'alpaca.accounts.meta';
const secretService = (id: string) => `alpaca.account.${id}`;

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function loadMeta(): Promise<AccountMeta[]> {
  const entry = await Keychain.getGenericPassword({ service: META_SERVICE });
  if (!entry) {
    return [];
  }
  try {
    return JSON.parse(entry.password) as AccountMeta[];
  } catch {
    return [];
  }
}

async function saveMeta(meta: AccountMeta[]): Promise<void> {
  await Keychain.setGenericPassword('meta', JSON.stringify(meta), {
    service: META_SERVICE,
  });
}

export async function loadAccounts(): Promise<Account[]> {
  const meta = await loadMeta();
  const accounts: Account[] = [];
  for (const m of meta) {
    const secret = await Keychain.getGenericPassword({
      service: secretService(m.id),
    });
    if (!secret) {
      continue;
    }
    accounts.push({
      id: m.id,
      name: m.name,
      env: m.env,
      key: secret.username,
      secret: secret.password,
    });
  }
  return accounts;
}

export async function addAccount(input: {
  name: string;
  key: string;
  secret: string;
  env: AlpacaEnv;
}): Promise<Account> {
  const id = newId();
  await Keychain.setGenericPassword(input.key, input.secret, {
    service: secretService(id),
  });
  const meta = await loadMeta();
  meta.push({ id, name: input.name, env: input.env });
  await saveMeta(meta);
  return { id, name: input.name, env: input.env, key: input.key, secret: input.secret };
}

export async function updateAccount(account: Account): Promise<void> {
  await Keychain.setGenericPassword(account.key, account.secret, {
    service: secretService(account.id),
  });
  const meta = await loadMeta();
  const idx = meta.findIndex(m => m.id === account.id);
  const next = { id: account.id, name: account.name, env: account.env };
  if (idx >= 0) {
    meta[idx] = next;
  } else {
    meta.push(next);
  }
  await saveMeta(meta);
}

export async function deleteAccount(id: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: secretService(id) });
  const meta = (await loadMeta()).filter(m => m.id !== id);
  await saveMeta(meta);
}
