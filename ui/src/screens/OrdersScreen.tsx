// Working orders across every account (trading spec: orders screen).
import { useNavigate } from 'react-router';
import { Screen } from '../components/Screen';
import { StrategyFilter } from '../components/StrategyFilter';
import ui from '../components/ui.module.css';
import { api } from '../ipc';
import { useAccounts } from '../state/accounts';
import styles from './Book.module.css';
import { NoAccounts } from './NoAccounts';
import { useBook } from './useBook';

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function OrdersScreen() {
  const navigate = useNavigate();
  const { accounts } = useAccounts();
  const { buckets, options, selection, setSelection, error, refresh } = useBook(api.orders);

  return (
    <Screen title="Orders" testId="screen-orders" onRefresh={refresh}>
      {accounts.length === 0 ? (
        <NoAccounts />
      ) : (
        <>
          <div className={styles.filterRow}>
            <StrategyFilter options={options} selection={selection} onChange={setSelection} />
          </div>
          {error && (
            <div className={ui.banner} role="alert" data-testid="book-error">
              {error}
            </div>
          )}
          {buckets.map(b => (
            <section key={b.account.id} className={styles.bucket} data-testid={`bucket-${b.account.id}`}>
              <div className={styles.bucketHeader}>
                <span className={styles.bucketName}>
                  {b.account.name}
                  {b.account.is_paper && <span className={ui.paper}>paper</span>}
                </span>
                <span className={styles.bucketMeta}>{b.rows.length} working</span>
              </div>
              {b.rows.map(r => {
                const o = r.item;
                const size = o.qty ?? o.notional ?? '';
                const price = o.limit_price ?? o.stop_price;
                return (
                  <button
                    key={o.id}
                    className={styles.row}
                    data-testid={`order-${o.id}`}
                    onClick={() => navigate(`/chart/${encodeURIComponent(o.symbol)}`)}
                  >
                    <span className={styles.left}>
                      <span className={styles.symbol}>{o.symbol}</span>
                      <span className={styles.sub}>
                        {capitalize(o.side)} {o.type}
                      </span>
                    </span>
                    <span className={styles.right}>
                      <span className={styles.value}>
                        {size}
                        {price != null ? ` @ ${price}` : ''}
                      </span>
                      <span className={styles.sub}>{o.status}</span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </>
      )}
    </Screen>
  );
}
