import { SubScreen } from '../components/Screen';
import styles from '../components/ui.module.css';
import { useAccounts } from '../state/accounts';

/** Read-only list of provisioned accounts (accounts spec). */
export function AccountsScreen() {
  const { accounts } = useAccounts();
  return (
    <SubScreen title="Accounts" testId="screen-accounts">
      {accounts.length === 0 ? (
        <p className={styles.empty}>No accounts provisioned. Configure ACCOUNTS_JSON and provision credentials.</p>
      ) : (
        accounts.map(a => (
          <div key={a.id} className={styles.item} data-testid={`account-${a.id}`}>
            <div className={styles.itemTitle}>
              {a.name}
              {a.is_paper && <span className={styles.paper}>paper</span>}
            </div>
            <div className={styles.sub}>
              {a.id} · ••••{a.key_last4}
            </div>
          </div>
        ))
      )}
    </SubScreen>
  );
}
