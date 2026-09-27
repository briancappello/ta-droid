import { useEffect, useState } from 'react';
import { SubScreen } from '../components/Screen';
import styles from '../components/ui.module.css';
import { errorMessage } from '../ipc';
import { useBackend } from '../state/backend';

/** Backend profile picker (backend-profiles spec). Header values never show. */
export function BackendScreen() {
  const { profiles, activeProfile, loadProfiles, selectProfile, health } = useBackend();
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    void loadProfiles().catch(e => setError(errorMessage(e)));
  }, [loadProfiles]);

  return (
    <SubScreen title="Backend" testId="screen-backend">
      {error && <div className={styles.banner}>{error}</div>}
      {profiles.map(p => {
        const active = p.name === activeProfile;
        return (
          <button
            key={p.name}
            className={styles.row}
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
            aria-pressed={active}
            disabled={switching != null}
            data-testid={`profile-${p.name}`}
            onClick={async () => {
              if (active) return;
              setSwitching(p.name);
              setError(null);
              try {
                await selectProfile(p.name);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setSwitching(null);
              }
            }}
          >
            <span className={styles.rowLabel} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {active ? '● ' : '○ '}
                {p.name}
              </span>
              <span className={styles.rowValue} data-testid={`profile-${p.name}-flags`}>
                {[p.has_auth ? 'auth' : null, p.has_custom_ca ? 'custom CA' : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={styles.sub}>MarketStore {p.marketstore_url}</span>
            <span className={styles.sub}>fa-techan {p.fatechan_url}</span>
            {active && (
              <span className={styles.sub} data-testid="active-health">
                MS {health.marketstore} · FA {health.fatechan}
              </span>
            )}
          </button>
        );
      })}
    </SubScreen>
  );
}
