// Order entry with review and submit (trading spec: order entry form,
// validation, review and submit).
import { useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { OrderForm } from '../bindings/OrderForm';
import type { OrderSide } from '../bindings/OrderSide';
import type { OrderType } from '../bindings/OrderType';
import type { TimeInForce } from '../bindings/TimeInForce';
import { AccountPicker } from '../components/AccountPicker';
import { Modal } from '../components/Modal';
import { SubScreen } from '../components/Screen';
import { useDrawer } from '../components/Shell';
import { api, errorMessage } from '../ipc';
import { useAccounts } from '../state/accounts';
import styles from './OrderEntryScreen.module.css';

const ORDER_TYPES: OrderType[] = ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'];
const TIF_VALUES: TimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'opg', 'cls'];
const needsLimit = (t: OrderType) => t === 'limit' || t === 'stop_limit';
const needsStop = (t: OrderType) => t === 'stop' || t === 'stop_limit';
const needsTrail = (t: OrderType) => t === 'trailing_stop';

export type OrderEntryState = { symbol?: string; accountId?: string | null };

function Pills<T extends string>({ values, selected, onSelect, testId }: { values: T[]; selected: T; onSelect: (v: T) => void; testId: string }) {
  return (
    <div className={styles.row}>
      {values.map(v => (
        <button
          key={v}
          type="button"
          className={`${styles.pill} ${v === selected ? styles.pillActive : ''}`}
          aria-pressed={v === selected}
          data-testid={`${testId}-${v}`}
          onClick={() => onSelect(v)}
        >
          {v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} inputMode="decimal" placeholder="0" value={value} onChange={e => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

export function OrderEntryScreen() {
  const navigate = useNavigate();
  const { notify } = useDrawer();
  const { ticker } = useParams();
  const state = (useLocation().state ?? {}) as OrderEntryState;
  const { accounts, activeId } = useAccounts();

  const [values, setValues] = useState<OrderForm>({
    symbol: state.symbol ?? ticker ?? '',
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    qty: '',
    notional: '',
    limit_price: '',
    stop_price: '',
    trail_percent: '',
    extended_hours: false,
    use_notional: false,
  });
  const [accountId, setAccountId] = useState<string | null>(state.accountId ?? activeId ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  // A ref, not state: a second tap in the same frame must see it at once.
  const inFlight = useRef(false);

  const account = accounts.find(a => a.id === accountId) ?? null;
  const set = <K extends keyof OrderForm>(key: K, value: OrderForm[K]) => setValues(v => ({ ...v, [key]: value }));

  const review = async () => {
    setSubmitError(null);
    const errs = await api.validateOrder(values).catch(e => [errorMessage(e)]);
    setErrors(errs);
    if (errs.length === 0) setReviewing(true);
  };

  const confirm = async () => {
    if (inFlight.current) return;
    if (!account) {
      setReviewing(false);
      setSubmitError('Select an account.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      await api.placeOrder(account.id, values);
      setReviewing(false);
      notify('Order submitted');
      navigate(-1);
    } catch (e) {
      setReviewing(false);
      setSubmitError(errorMessage(e, 'Failed to submit order.'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const t = values.type;
  return (
    <SubScreen title="New Order" testId="screen-order">
      <form
        className={styles.form}
        onSubmit={e => {
          e.preventDefault();
          void review();
        }}
      >
        <div className={styles.field}>
          <span className={styles.label}>Account</span>
          <AccountPicker accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
        </div>
        <label className={styles.field}>
          <span className={styles.label}>Symbol</span>
          <input
            className={styles.input}
            placeholder="Symbol"
            autoCapitalize="characters"
            spellCheck={false}
            value={values.symbol}
            onChange={e => set('symbol', e.target.value)}
            data-testid="order-symbol"
          />
        </label>
        <div className={styles.field}>
          <span className={styles.label}>Side</span>
          <Pills<OrderSide> values={['buy', 'sell']} selected={values.side} onSelect={v => set('side', v)} testId="side" />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Amount</span>
          <div className={styles.row}>
            <button type="button" className={`${styles.pill} ${!values.use_notional ? styles.pillActive : ''}`} onClick={() => set('use_notional', false)} data-testid="amount-qty">
              QTY
            </button>
            <button type="button" className={`${styles.pill} ${values.use_notional ? styles.pillActive : ''}`} onClick={() => set('use_notional', true)} data-testid="amount-notional">
              NOTIONAL
            </button>
          </div>
        </div>
        {values.use_notional ? (
          <NumberField label="Notional ($)" value={values.notional} onChange={v => set('notional', v)} testId="order-notional" />
        ) : (
          <NumberField label="Quantity" value={values.qty} onChange={v => set('qty', v)} testId="order-qty" />
        )}
        <div className={styles.field}>
          <span className={styles.label}>Type</span>
          <Pills<OrderType> values={ORDER_TYPES} selected={t} onSelect={v => set('type', v)} testId="type" />
        </div>
        {needsLimit(t) && <NumberField label="Limit Price" value={values.limit_price} onChange={v => set('limit_price', v)} testId="order-limit" />}
        {needsStop(t) && <NumberField label="Stop Price" value={values.stop_price} onChange={v => set('stop_price', v)} testId="order-stop" />}
        {needsTrail(t) && <NumberField label="Trail Percent" value={values.trail_percent} onChange={v => set('trail_percent', v)} testId="order-trail" />}
        <div className={styles.field}>
          <span className={styles.label}>Time in force</span>
          <Pills<TimeInForce> values={TIF_VALUES} selected={values.time_in_force} onSelect={v => set('time_in_force', v)} testId="tif" />
        </div>
        <div className={styles.field}>
          <button type="button" className={styles.toggle} onClick={() => set('extended_hours', !values.extended_hours)} data-testid="extended-hours">
            Extended Hours: {values.extended_hours ? 'ON' : 'OFF'}
          </button>
        </div>
        {errors.map(e => (
          <p key={e} className={styles.error} role="alert" data-testid="order-error">
            {e}
          </p>
        ))}
        {submitError && (
          <p className={styles.error} role="alert" data-testid="submit-error">
            {submitError}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={pending} data-testid="review">
          Review Order
        </button>
      </form>
      {reviewing && (
        <Modal onClose={() => !pending && setReviewing(false)} testId="review-modal">
          <div className={styles.review}>
            <h2 className={styles.reviewTitle}>Confirm Order</h2>
            <p className={styles.reviewLine}>Symbol: {values.symbol.trim().toUpperCase()}</p>
            <p className={styles.reviewLine}>Side: {values.side.toUpperCase()}</p>
            <p className={styles.reviewLine}>{values.use_notional ? `Notional: $${values.notional}` : `Qty: ${values.qty}`}</p>
            <p className={styles.reviewLine}>Type: {t.toUpperCase()}</p>
            {needsLimit(t) && <p className={styles.reviewLine}>Limit: {values.limit_price}</p>}
            {needsStop(t) && <p className={styles.reviewLine}>Stop: {values.stop_price}</p>}
            {needsTrail(t) && <p className={styles.reviewLine}>Trail %: {values.trail_percent}</p>}
            <p className={styles.reviewLine}>TIF: {values.time_in_force.toUpperCase()}</p>
            {account && <p className={styles.reviewLine}>Account: {account.name}</p>}
            <div className={styles.buttons}>
              <button className={styles.cancel} onClick={() => setReviewing(false)} disabled={pending} data-testid="review-cancel">
                Cancel
              </button>
              <button className={styles.confirm} onClick={() => void confirm()} disabled={pending} data-testid="submit">
                {pending ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SubScreen>
  );
}
