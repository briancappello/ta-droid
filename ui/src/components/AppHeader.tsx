import type { ReactNode } from 'react';
import { useBackend, type BackendHealth } from '../state/backend';
import styles from './AppHeader.module.css';

export function dotColor(h: BackendHealth): string {
  if (h === 'up') return '#4caf50';
  if (h === 'down') return '#f44336';
  return '#9e9e9e';
}

/** Shared screen header (app-shell spec): menu, title, actions, MS/FA pill. */
export function AppHeader({
  title,
  onMenuPress,
  onRefreshPress,
  onBackendPress,
  right,
}: {
  title: string;
  onMenuPress: () => void;
  onRefreshPress?: () => void;
  onBackendPress?: () => void;
  right?: ReactNode;
}) {
  const { health } = useBackend();
  return (
    <header className={styles.bar}>
      <button className={styles.menu} onClick={onMenuPress} aria-label="Menu" data-testid="menu">
        ☰
      </button>
      <h1 className={styles.title} style={{ margin: 0 }}>
        {title}
      </h1>
      {right}
      <button
        className={styles.chip}
        onClick={onBackendPress}
        disabled={!onBackendPress}
        aria-label="Backend health"
        data-testid="health-pill"
      >
        <span className={styles.dot} data-testid="dot-ms" data-health={health.marketstore} style={{ background: dotColor(health.marketstore) }} />
        <span className={styles.chipText}>MS</span>
        <span className={styles.dot} data-testid="dot-fa" data-health={health.fatechan} style={{ background: dotColor(health.fatechan) }} />
        <span className={styles.chipText}>FA</span>
      </button>
      {onRefreshPress && (
        <button className={styles.refresh} onClick={onRefreshPress} aria-label="Refresh" data-testid="refresh">
          ↻
        </button>
      )}
    </header>
  );
}
