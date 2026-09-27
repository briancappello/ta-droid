// Backend health and profiles (backend-profiles spec).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ProfileView } from '../bindings/ProfileView';
import { api } from '../ipc';

export type BackendHealth = 'up' | 'down' | 'unknown';
export type HealthByBackend = { marketstore: BackendHealth; fatechan: BackendHealth };

const UNKNOWN: HealthByBackend = { marketstore: 'unknown', fatechan: 'unknown' };
export const POLL_MS = 20_000;

type Ctx = {
  health: HealthByBackend;
  setHealth: (h: HealthByBackend) => void;
  refresh: () => Promise<void>;
  profiles: ProfileView[];
  activeProfile: string | null;
  /** Load the profile list (Backend and Settings screens call this). */
  loadProfiles: () => Promise<void>;
  /** Switch profiles: persisted by the backend, then health re-probes. */
  selectProfile: (name: string) => Promise<void>;
};

const BackendCtx = createContext<Ctx | null>(null);

export function BackendProvider({ children, poll = false }: { children: ReactNode; poll?: boolean }) {
  const [health, setHealth] = useState<HealthByBackend>(UNKNOWN);
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // The backend probes both in parallel and never fails either.
      setHealth(await api.health());
    } catch {
      setHealth({ marketstore: 'down', fatechan: 'down' });
    }
  }, []);

  useEffect(() => {
    if (!poll) return;
    // refresh() sets state only after the IPC call resolves, not during the
    // effect, so this does not cause a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [poll, refresh]);

  const loadProfiles = useCallback(async () => {
    const v = await api.listProfiles();
    setProfiles(v.profiles);
    setActiveProfile(v.active);
  }, []);

  const selectProfile = useCallback(
    async (name: string) => {
      const v = await api.setActiveProfile(name);
      setProfiles(v.profiles);
      setActiveProfile(v.active);
      setHealth(UNKNOWN);
      await refresh();
    },
    [refresh],
  );

  return (
    <BackendCtx.Provider value={{ health, setHealth, refresh, profiles, activeProfile, loadProfiles, selectProfile }}>
      {children}
    </BackendCtx.Provider>
  );
}

export function useBackend(): Ctx {
  const ctx = useContext(BackendCtx);
  if (!ctx) throw new Error('useBackend must be used within BackendProvider');
  return ctx;
}
