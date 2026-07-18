// src/AccountContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as Keychain from 'react-native-keychain';
import type { Account } from './alpaca';
import { loadAccounts } from './accounts';

const ACTIVE_SERVICE = 'alpaca.active';

type Ctx = {
  accounts: Account[];
  activeId: string | null;
  activeAccount: Account | null;
  setActiveId: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
};

const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    reload();
  }, [reload]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    Keychain.setGenericPassword('active', id, {
      service: ACTIVE_SERVICE,
    }).catch(() => {});
  }, []);

  const activeAccount = accounts.find(a => a.id === activeId) ?? null;

  return (
    <AccountCtx.Provider
      value={{ accounts, activeId, activeAccount, setActiveId, reload, loading }}
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
