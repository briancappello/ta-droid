// src/BackendContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';

export type BackendHealth = 'up' | 'down' | 'unknown';

type Ctx = {
  health: BackendHealth;
  setHealth: (h: BackendHealth) => void;
  refresh: () => Promise<void>;
};

const BackendCtx = createContext<Ctx | null>(null);

export function BackendProvider({
  children,
}: {
  children: React.ReactNode;
  poll?: boolean;
}) {
  const [health, setHealth] = useState<BackendHealth>('unknown');

  // ponytail: real fa-techan health ping lands in Phase 4 (Task 16).
  // Until then refresh is a no-op and health is driven by setHealth.
  const refresh = useCallback(async () => {}, []);

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
