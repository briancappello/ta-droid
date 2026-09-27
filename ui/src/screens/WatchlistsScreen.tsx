import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { WatchRow } from '../bindings/WatchRow';
import type { WatchlistRef } from '../bindings/WatchlistRef';
import { Screen } from '../components/Screen';
import { WatchlistPicker } from '../components/WatchlistPicker';
import { formatMoney, formatPercent } from '../format';
import { api, live } from '../ipc';
import styles from './WatchlistsScreen.module.css';

const GREEN = '#4caf50';
const RED = '#f44336';

function signed(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${formatPercent(pct)}%`;
}

/** Watchlists (market-data spec): REST paint, then live re-ranking. */
export function WatchlistsScreen() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<WatchlistRef[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const ls = await api.watchlists();
      setLists(ls);
      setSelectedId(cur => (cur && ls.some(l => l.id === cur) ? cur : (ls[0]?.id ?? null)));
    } catch {
      setLists([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state after IPC resolves.
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    // A failed entries fetch is ignored; the stream may still fill the rows.
    api.watchlistEntries(selectedId).then(
      r => alive && setRows(r),
      () => undefined,
    );
    const off = live.watchlist(selectedId, r => alive && setRows(r));
    return () => {
      alive = false;
      off();
      setRows([]);
    };
  }, [selectedId]);

  if (loaded && lists.length === 0) {
    return (
      <Screen title="Watchlists" testId="screen-watchlists" onRefresh={load}>
        <p className={styles.unavailable} data-testid="watchlists-unavailable">
          Watchlists unavailable.
        </p>
      </Screen>
    );
  }

  return (
    <Screen title="Watchlists" testId="screen-watchlists" onRefresh={load}>
      <div className={styles.pickerRow}>
        <WatchlistPicker lists={lists} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      {rows.map((row, i) => {
        const priceColor = row.price_up == null ? undefined : row.price_up ? GREEN : RED;
        return (
          <button
            key={`${row.symbol}-${i}`}
            className={styles.row}
            data-testid={`watch-row-${row.symbol}`}
            onClick={() => navigate(`/chart/${encodeURIComponent(row.symbol)}`)}
          >
            <span className={styles.symbol}>{row.symbol}</span>
            <span className={styles.quote}>
              {row.price != null ? (
                <>
                  <span className={`${styles.price} ${priceColor ? '' : styles.neutral}`} style={{ color: priceColor }} data-testid="price">
                    {formatMoney(row.price)}
                  </span>
                  {row.change_pct != null && (
                    <span className={styles.change} style={{ color: row.change_up ? GREEN : RED }} data-testid="change">
                      {signed(row.change_pct)}
                    </span>
                  )}
                </>
              ) : row.agg_pct != null ? (
                <span className={styles.price} style={{ color: row.agg_pct >= 0 ? GREEN : RED }} data-testid="agg">
                  {signed(row.agg_pct)}
                </span>
              ) : (
                <span className={`${styles.price} ${styles.neutral}`}>--</span>
              )}
            </span>
          </button>
        );
      })}
    </Screen>
  );
}
