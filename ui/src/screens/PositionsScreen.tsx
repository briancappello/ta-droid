// Positions across every account (trading spec: positions screen).
import { useNavigate } from 'react-router';
import { usd } from '../book';
import { Screen } from '../components/Screen';
import { StrategyFilter } from '../components/StrategyFilter';
import ui from '../components/ui.module.css';
import { api } from '../ipc';
import { useAccounts } from '../state/accounts';
import styles from './Book.module.css';
import { NoAccounts } from './NoAccounts';
import { useBook } from './useBook';

const color = (n: number) => (n >= 0 ? '#4caf50' : '#f44336');

export function PositionsScreen() {
  const navigate = useNavigate();
  const { accounts } = useAccounts();
  const { buckets, options, selection, setSelection, error, refresh } = useBook(api.positions);

  return (
    <Screen title="Positions" testId="screen-positions" onRefresh={refresh}>
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
          {buckets.map(b => {
            const pl = b.rows.reduce((sum, r) => sum + Number(r.item.unrealized_pl), 0);
            return (
              <section key={b.account.id} className={styles.bucket} data-testid={`bucket-${b.account.id}`}>
                <div className={styles.bucketHeader}>
                  <span className={styles.bucketName}>
                    {b.account.name}
                    {b.account.is_paper && <span className={ui.paper}>paper</span>}
                  </span>
                  <span className={styles.bucketMeta} style={{ color: color(pl) }} data-testid="bucket-pl">
                    {usd(pl)}
                  </span>
                </div>
                {b.rows.map((r, i) => {
                  const p = r.item;
                  return (
                    <button
                      key={`${p.symbol}-${i}`}
                      className={styles.row}
                      data-testid={`position-${b.account.id}-${p.symbol}`}
                      onClick={() => navigate(`/chart/${encodeURIComponent(p.symbol)}`)}
                    >
                      <span className={styles.left}>
                        <span className={styles.symbol}>{p.symbol}</span>
                        <span className={styles.sub}>
                          {p.qty} @ {usd(p.avg_entry_price)}
                        </span>
                      </span>
                      <span className={styles.right}>
                        <span className={styles.value}>{usd(p.market_value)}</span>
                        <span className={styles.sub} style={{ color: color(Number(p.unrealized_pl)) }}>
                          {usd(p.unrealized_pl)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </>
      )}
    </Screen>
  );
}
