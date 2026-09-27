import { useNavigate } from 'react-router';
import ui from '../components/ui.module.css';
import styles from './Book.module.css';

export function NoAccounts() {
  const navigate = useNavigate();
  return (
    <div className={styles.emptyBox} data-testid="no-accounts">
      <span>Add an account to start trading.</span>
      <button className={ui.link} onClick={() => navigate('/settings/accounts')}>
        Go to Accounts
      </button>
    </div>
  );
}
