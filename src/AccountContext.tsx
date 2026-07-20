// src/AccountContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as Keychain from 'react-native-keychain';
import Config from 'react-native-config';
import type { Account } from './alpaca';
import { loadAccounts } from './accounts';
import { provisioningAction, runProvisioning, type EncryptedBlob } from './provisioning';
import { secretsDeps, readFingerprint } from './secretsBackend';

const ACTIVE_SERVICE = 'alpaca.active';

const blob: EncryptedBlob | null = (() => {
  try {
    return JSON.parse(Config.CREDENTIALS_BLOB_JSON ?? 'null');
  } catch {
    return null;
  }
})();

type ProvStatus = 'checking' | 'need-passphrase' | 'ready';

type Ctx = {
  accounts: Account[];
  activeId: string | null;
  activeAccount: Account | null;
  setActiveId: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
  provStatus: ProvStatus;
  provision: (passphrase: string) => Promise<boolean>;
};

const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provStatus, setProvStatus] = useState<ProvStatus>('checking');

  const reload = useCallback(async () => {
    setLoading(true);
    const loaded = await loadAccounts();
    setAccounts(loaded);
    const persisted = await Keychain.getGenericPassword({
      service: ACTIVE_SERVICE,
    });
    const persistedId = persisted ? persisted.password : null;
    const valid = loaded.find(a => a.id === persistedId);
    setActiveIdState(valid ? valid.id : loaded[0]?.id ?? null);
    setLoading(false);
  }, []);

  const checkProvisioning = useCallback(async () => {
    if (!blob) {
      setProvStatus('ready');
      return;
    } // no blob → nothing to provision
    const stored = await readFingerprint();
    setProvStatus(
      provisioningAction(blob.fingerprint, stored) === 'provision'
        ? 'need-passphrase'
        : 'ready',
    );
  }, []);

  const provision = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!blob) {
        return true;
      }
      const res = await runProvisioning(blob, passphrase, secretsDeps);
      if (res.ok) {
        await reload();
        setProvStatus('ready');
        return true;
      }
      return false; // bad passphrase — caller re-prompts
    },
    [reload],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    checkProvisioning();
  }, [checkProvisioning]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    Keychain.setGenericPassword('active', id, {
      service: ACTIVE_SERVICE,
    }).catch(() => {});
  }, []);

  const activeAccount = accounts.find(a => a.id === activeId) ?? null;

  return (
    <AccountCtx.Provider
      value={{ accounts, activeId, activeAccount, setActiveId, reload, loading, provStatus, provision }}
    >
      {children}
    </AccountCtx.Provider>
  );
}

export function useAccounts(): Ctx {
  const ctx = useContext(AccountCtx);
  if (!ctx) {
    throw new Error('useAccounts must be used within AccountProvider');
  }
  return ctx;
}
