// src/BackendContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { pingHealth } from './techan';

export type BackendHealth = 'up' | 'down' | 'unknown';

type Ctx = {
  health: BackendHealth;
  setHealth: (h: BackendHealth) => void;
  refresh: () => Promise<void>;
};

const BackendCtx = createContext<Ctx | null>(null);

export function BackendProvider({
  children,
  poll = false,
}: {
  children: React.ReactNode;
  poll?: boolean;
}) {
  const [health, setHealth] = useState<BackendHealth>('unknown');

  const refresh = useCallback(async () => {
    const ok = await pingHealth();
    setHealth(ok ? 'up' : 'down');
  }, []);

  useEffect(() => {
    if (!poll) {
      return;
    }
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [poll, refresh]);

  return (
    <BackendCtx.Provider value={{ health, setHealth, refresh }}>
      {children}
    </BackendCtx.Provider>
  );
}

export function useBackend(): Ctx {
  const ctx = useContext(BackendCtx);
  if (!ctx) {
    throw new Error('useBackend must be used within BackendProvider');
  }
  return ctx;
}
