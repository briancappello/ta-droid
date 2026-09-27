import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '../components/Screen';
import styles from '../components/ui.module.css';
import { useAccounts } from '../state/accounts';
import { useBackend } from '../state/backend';

function Row({ label, value, onPress, testId }: { label: string; value?: string; onPress: () => void; testId: string }) {
  return (
    <button className={styles.row} onClick={onPress} data-testid={testId}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowRight}>
        {value != null && <span className={styles.rowValue}>{value}</span>}
        <span className={styles.chev}>›</span>
      </span>
    </button>
  );
}

/** Settings: "Accounts — N linked" and "Backend — <active profile>". */
export function SettingsScreen() {
  const navigate = useNavigate();
  const { accounts } = useAccounts();
  const { activeProfile, loadProfiles } = useBackend();
  useEffect(() => {
    void loadProfiles().catch(() => undefined);
  }, [loadProfiles]);
  return (
    <Screen title="Settings" testId="screen-settings">
      <Row label="Accounts" value={`${accounts.length} linked`} onPress={() => navigate('accounts')} testId="to-accounts" />
      <Row label="Backend" value={activeProfile ?? '…'} onPress={() => navigate('backend')} testId="to-backend" />
    </Screen>
  );
}
