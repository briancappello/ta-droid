import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from './AppHeader';
import { useDrawer } from './Shell';
import styles from './Screen.module.css';

/** A top-level drawer screen: shared header plus a scrolling body. */
export function Screen({
  title,
  testId,
  onRefresh,
  right,
  children,
}: {
  title: string;
  testId: string;
  onRefresh?: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { openDrawer } = useDrawer();
  const navigate = useNavigate();
  return (
    <section style={{ display: 'contents' }} data-testid={testId}>
      <AppHeader
        title={title}
        onMenuPress={openDrawer}
        onRefreshPress={onRefresh}
        onBackendPress={() => navigate('/settings/backend')}
        right={right}
      />
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** A pushed screen (stack child): back button plus title. */
export function SubScreen({ title, testId, right, children }: { title: string; testId: string; right?: ReactNode; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <section style={{ display: 'contents' }} data-testid={testId}>
      <div className={styles.subbar}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back" data-testid="back">
          ‹
        </button>
        <h1 className={styles.subtitle}>{title}</h1>
        {right}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
