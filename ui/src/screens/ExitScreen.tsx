// Exit a symbol across every account (trading spec: exit a symbol).
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Leg } from '../bindings/Leg';
import type { LegResult } from '../bindings/LegResult';
import type { NewOrderRequest } from '../bindings/NewOrderRequest';
import type { OrderType } from '../bindings/OrderType';
import { SubScreen } from '../components/Screen';
import { useDrawer } from '../components/Shell';
import { api, errorMessage } from '../ipc';
import styles from './ExitScreen.module.css';

const TYPES: { label: string; value: OrderType }[] = [
  { label: 'Market', value: 'market' },
  { label: 'Limit', value: 'limit' },
  { label: 'Stop', value: 'stop' },
];
const needsPrice = (t: OrderType) => t === 'limit' || t === 'stop';

export function ExitScreen() {
  const { ticker = '' } = useParams();
  const navigate = useNavigate();
  const { notify } = useDrawer();
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<LegResult[]>([]);
  const exited = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    api.flattenLegs(ticker).then(
      l => alive && setLegs(l),
      () => alive && setLegs([]),
    );
    return () => {
      alive = false;
    };
  }, [ticker]);

  const edit = (accountId: string, patch: Partial<NewOrderRequest>) =>
    setLegs(prev => prev && prev.map(l => (l.account_id === accountId ? { ...l, req: { ...l.req, ...patch } } : l)));

  // Switching type drops the price field the new type does not use.
  const onType = (accountId: string, t: OrderType) =>
    edit(accountId, {
      type: t,
      ...(t !== 'limit' && { limit_price: null }),
      ...(t !== 'stop' && { stop_price: null }),
    });

  const exitAll = async () => {
    if (!legs || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const out = await api.submitFlatten(legs);
      exited.current += out.results.filter(r => r.ok).length;
      if (out.all_ok) {
        notify(`Flat — Exited ${exited.current} account(s).`);
        navigate(-1);
        return;
      }
      // Only the failed legs stay; the next "Exit all" resends just those.
      setLegs(out.remaining);
      setFailed(out.results.filter(r => !r.ok));
    } catch (e) {
      setFailed([{ account_id: '', account_name: 'Exit', ok: false, error: errorMessage(e) }]);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  if (legs === null) return <SubScreen title="Go flat" testId="screen-exit" />;

  if (legs.length === 0 && failed.length === 0) {
    return (
      <SubScreen title="Go flat — 0 accounts" testId="screen-exit">
        <div className={styles.empty} data-testid="no-position">
          <span>No open position.</span>
          <button className={styles.cancel} style={{ flex: 'none', padding: '10px 32px' }} onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </SubScreen>
    );
  }

  return (
    <SubScreen title={`Go flat — ${legs.length} accounts`} testId="screen-exit">
      <div className={styles.root}>
        <div className={styles.list}>
          {legs.map(leg => {
            const { req } = leg;
            const open = expanded === leg.account_id;
            const price = req.type === 'stop' ? req.stop_price : req.limit_price;
            return (
              <div key={leg.account_id} className={styles.leg} data-testid={`leg-${leg.account_id}`}>
                <button className={styles.legHead} onClick={() => setExpanded(open ? null : leg.account_id)}>
                  <span className={styles.account}>{leg.account_name}</span>
                  <span className={styles.orderText} data-testid="leg-order">
                    {req.side === 'sell' ? 'Sell' : 'Buy'} {req.qty} · {req.type}
                  </span>
                </button>
                {open && (
                  <div className={styles.editor}>
                    <div className={styles.types}>
                      {TYPES.map(t => (
                        <button
                          key={t.value}
                          className={`${styles.type} ${req.type === t.value ? styles.typeActive : ''}`}
                          data-testid={`leg-type-${t.value}`}
                          onClick={() => onType(leg.account_id, t.value)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <span className={styles.label}>Qty</span>
                    <input className={styles.input} inputMode="decimal" value={req.qty ?? ''} onChange={e => edit(leg.account_id, { qty: e.target.value })} data-testid="leg-qty" />
                    {needsPrice(req.type) && (
                      <>
                        <span className={styles.label}>Price</span>
                        <input
                          className={styles.input}
                          inputMode="decimal"
                          value={price ?? ''}
                          onChange={e => edit(leg.account_id, req.type === 'stop' ? { stop_price: e.target.value } : { limit_price: e.target.value })}
                          data-testid="leg-price"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {failed.length > 0 && (
            <div className={styles.fail} role="alert" data-testid="exit-failures">
              <p className={styles.failTitle}>Some exits failed</p>
              {failed.map(f => (
                <p key={f.account_id} className={styles.failText}>
                  {f.account_name}: {f.error}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancel} onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className={styles.exitAll} onClick={() => void exitAll()} disabled={pending || legs.length === 0} data-testid="exit-all">
            {pending ? 'Exiting…' : 'Exit all'}
          </button>
        </div>
      </div>
    </SubScreen>
  );
}
