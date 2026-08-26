// src/BackendContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { pingHealth } from './techan';
import { pingMarketstore } from './marketstore';

export type BackendHealth = 'up' | 'down' | 'unknown';
export type BackendName = 'marketstore' | 'fatechan';
export type HealthByBackend = Record<BackendName, BackendHealth>;

const UNKNOWN: HealthByBackend = {
  marketstore: 'unknown',
  fatechan: 'unknown',
};

type Ctx = {
  health: HealthByBackend;
  setHealth: (h: HealthByBackend) => void;
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
  const [health, setHealth] = useState<HealthByBackend>(UNKNOWN);

  const refresh = useCallback(async () => {
    // Probe each backend independently so one being down never blocks the
    // other — the app stays usable on MarketStore alone.
    const [ms, fa] = await Promise.all([pingMarketstore(), pingHealth()]);
    setHealth({
      marketstore: ms ? 'up' : 'down',
      fatechan: fa ? 'up' : 'down',
    });
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
