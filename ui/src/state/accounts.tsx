// Accounts, the active account, and the provisioning gate state
// (accounts and credential-provisioning specs).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AccountView } from '../bindings/AccountView';
import type { Outcome } from '../bindings/Outcome';
import { api } from '../ipc';

export type ProvStatus = 'checking' | 'need-passphrase' | 'ready';

type Ctx = {
  accounts: AccountView[];
  activeId: string | null;
  activeAccount: AccountView | null;
  setActiveId: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
  provStatus: ProvStatus;
  provision: (passphrase: string) => Promise<Outcome['outcome']>;
};

const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [activeId, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provStatus, setProvStatus] = useState<ProvStatus>('checking');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const v = await api.listAccounts();
      setAccounts(v.accounts);
      setActive(v.active_id);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await api.provisioningStatus().catch(() => ({ needed: false }));
      if (cancelled) return;
      if (s.needed) {
        setProvStatus('need-passphrase');
      } else {
        await reload();
        if (!cancelled) setProvStatus('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const provision = useCallback(
    async (passphrase: string): Promise<Outcome['outcome']> => {
      let outcome: Outcome['outcome'];
      try {
        outcome = (await api.provision(passphrase)).outcome;
      } catch {
        outcome = 'save-failed';
      }
      if (outcome === 'ok') {
        await reload();
        setProvStatus('ready');
      }
      return outcome;
    },
    [reload],
  );

  const setActiveId = useCallback((id: string) => {
    setActive(id);
    // A failed write is ignored (accounts spec).
    void api.setActiveAccount(id).catch(() => undefined);
  }, []);

  const activeAccount = accounts.find(a => a.id === activeId) ?? null;
  return (
    <AccountCtx.Provider value={{ accounts, activeId, activeAccount, setActiveId, reload, loading, provStatus, provision }}>
      {children}
    </AccountCtx.Provider>
  );
}

export function useAccounts(): Ctx {
  const ctx = useContext(AccountCtx);
  if (!ctx) throw new Error('useAccounts must be used within AccountProvider');
  return ctx;
}
