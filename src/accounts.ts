// src/accounts.ts
import Config from 'react-native-config';
import type { Account } from './alpaca';
import type { BrokerId } from './broker';
import { readCred } from './secretsBackend';

type AccountConfig = { broker: BrokerId; id: string; name: string; is_paper: boolean };

function parseAccountsConfig(): AccountConfig[] {
  try {
    return JSON.parse(Config.ACCOUNTS_JSON ?? '[]') as AccountConfig[];
  } catch {
    return [];
  }
}

// Accounts = non-secret build config joined with Keystore-provisioned creds.
// An account with no provisioned cred is skipped (provisioning not yet run).
export async function loadAccounts(): Promise<Account[]> {
  const cfgs = parseAccountsConfig();
  const out: Account[] = [];
  for (const c of cfgs) {
    const cred = await readCred(`${c.broker}:${c.id}`);
    if (!cred) {
      continue;
    }
    out.push({ id: c.id, name: c.name, broker: c.broker, is_paper: c.is_paper, key: cred.key, secret: cred.secret });
  }
  return out;
}
