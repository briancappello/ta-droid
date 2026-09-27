// App shell: drawer navigation over the routed screens (app-shell spec).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import styles from './Shell.module.css';

export const DRAWER_ITEMS = [
  { label: 'Chart', path: '/chart', match: '/chart' },
  { label: 'Positions', path: '/positions', match: '/positions' },
  { label: 'Orders', path: '/orders', match: '/orders' },
  { label: 'Watchlists', path: '/watchlists', match: '/watchlists' },
  { label: 'Settings', path: '/settings', match: '/settings' },
] as const;

type Ctx = {
  openDrawer: () => void;
  /** Show a short message over whatever screen is current (e.g. after going back). */
  notify: (message: string) => void;
};
const DrawerCtx = createContext<Ctx>({ openDrawer: () => undefined, notify: () => undefined });

export const NOTICE_MS = 3000;

/** Screens call this from their header's menu button. */
export function useDrawer(): Ctx {
  return useContext(DrawerCtx);
}

export function Shell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const openDrawer = useCallback(() => setOpen(true), []);
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const notify = useCallback((text: string) => setNotice({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <DrawerCtx.Provider value={{ openDrawer, notify }}>
      <div className={styles.shell}>
        <div className={styles.screen}>
          <Outlet />
        </div>
        {notice && (
          <div className={styles.notice} role="status" data-testid="notice" onClick={() => setNotice(null)}>
            {notice.text}
          </div>
        )}
        {open && (
          <>
            <div className={styles.scrim} onClick={() => setOpen(false)} data-testid="drawer-scrim" />
            <nav className={styles.drawer} aria-label="Main" data-testid="drawer">
              {DRAWER_ITEMS.map(item => {
                const active = pathname.startsWith(item.match);
                return (
                  <button
                    key={item.path}
                    className={`${styles.item} ${active ? styles.active : ''}`}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                    onClick={() => {
                      setOpen(false);
                      if (!active) navigate(item.path);
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </>
        )}
      </div>
    </DrawerCtx.Provider>
  );
}
