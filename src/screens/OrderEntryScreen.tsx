import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAccounts } from '../AccountContext';
import { AccountPicker } from '../components/AccountPicker';
import {
  validateOrderForm,
  toNewOrderRequest,
  type OrderFormValues,
} from '../orderValidation';
import {
  createOrder,
  replaceOrder,
  AlpacaError,
  type Account,
  type AlpacaOrder,
  type OrderSide,
  type OrderType,
  type ReplaceOrderRequest,
  type TimeInForce,
} from '../alpaca';

type RouteParams = {
  accountId?: string;
  symbol?: string;
  order?: AlpacaOrder;
};

type Props = {
  route: { params?: RouteParams };
  navigation: { goBack: () => void };
};

const ORDER_TYPES: OrderType[] = [
  'market',
  'limit',
  'stop',
  'stop_limit',
  'trailing_stop',
];
const TIF_VALUES: TimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'opg', 'cls'];

function initialValues(params: RouteParams | undefined): OrderFormValues {
  const order = params?.order;
  if (order) {
    return {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      time_in_force: order.time_in_force,
      qty: order.qty ?? '',
      notional: order.notional ?? '',
      limit_price: order.limit_price ?? '',
      stop_price: order.stop_price ?? '',
      trail_percent: order.trail_percent ?? '',
      extended_hours: false,
      useNotional: order.qty == null && order.notional != null,
    };
  }
  return {
    symbol: params?.symbol ?? '',
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    qty: '',
    notional: '',
    limit_price: '',
    stop_price: '',
    trail_percent: '',
    extended_hours: false,
    useNotional: false,
  };
}

const needsLimit = (t: OrderType) => t === 'limit' || t === 'stop_limit';
const needsStop = (t: OrderType) => t === 'stop' || t === 'stop_limit';
const needsTrail = (t: OrderType) => t === 'trailing_stop';

export default function OrderEntryScreen({ route, navigation }: Props) {
  const { accounts, activeId } = useAccounts();
  const params = route.params;
  const modifyMode = Boolean(params?.order);

  const [values, setValues] = useState<OrderFormValues>(() =>
    initialValues(params),
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    params?.accountId ?? activeId ?? null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [pending, setPending] = useState(false);

  const account: Account | null = useMemo(
    () => accounts.find(a => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  const set = <K extends keyof OrderFormValues>(
    key: K,
    value: OrderFormValues[K],
  ) => setValues(v => ({ ...v, [key]: value }));

  const onSubmit = () => {
    setSubmitError(null);
    const errs = validateOrderForm(values);
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setReviewVisible(true);
  };

  const onConfirm = async () => {
    if (!account) {
      setSubmitError('Select an account.');
      setReviewVisible(false);
      return;
    }
    setPending(true);
    try {
      if (modifyMode && params?.order) {
        const req: ReplaceOrderRequest = {};
        if (values.qty.trim()) {
          req.qty = values.qty.trim();
        }
        req.time_in_force = values.time_in_force;
        if (values.limit_price.trim()) {
          req.limit_price = values.limit_price.trim();
        }
        if (values.stop_price.trim()) {
          req.stop_price = values.stop_price.trim();
        }
        if (values.trail_percent.trim()) {
          req.trail = values.trail_percent.trim();
        }
        await replaceOrder(account, params.order.id, req);
      } else {
        await createOrder(account, toNewOrderRequest(values));
      }
      setReviewVisible(false);
      Alert.alert('Order submitted');
      navigation.goBack();
    } catch (e) {
      // Security: only surface e.message — never the account/headers/init.
      setReviewVisible(false);
      setSubmitError(
        e instanceof AlpacaError ? e.message : 'Failed to submit order.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>{modifyMode ? 'Modify Order' : 'New Order'}</Text>

      {!modifyMode && (
        <View style={styles.field}>
          <Text style={styles.label}>Account</Text>
          <AccountPicker
            accounts={accounts}
            selectedId={selectedAccountId}
            onSelect={setSelectedAccountId}
          />
        </View>
      )}
      {modifyMode && account && (
        <Text style={styles.readonly}>Account: {account.name}</Text>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Symbol</Text>
        {modifyMode ? (
          <Text style={styles.readonly}>{values.symbol}</Text>
        ) : (
          <TextInput
            style={styles.input}
            placeholder="Symbol"
            placeholderTextColor="#666"
            autoCapitalize="characters"
            value={values.symbol}
            onChangeText={t => set('symbol', t)}
          />
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Side</Text>
        {modifyMode ? (
          <Text style={styles.readonly}>{values.side.toUpperCase()}</Text>
        ) : (
          <View style={styles.row}>
            {(['buy', 'sell'] as OrderSide[]).map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.pill, values.side === s && styles.pillActive]}
                onPress={() => set('side', s)}
              >
                <Text
                  style={[
                    styles.pillText,
                    values.side === s && styles.pillTextActive,
                  ]}
                >
                  {s.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {!modifyMode && (
        <View style={styles.field}>
          <Text style={styles.label}>Amount</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.pill, !values.useNotional && styles.pillActive]}
              onPress={() => set('useNotional', false)}
            >
              <Text
                style={[
                  styles.pillText,
                  !values.useNotional && styles.pillTextActive,
                ]}
              >
                QTY
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, values.useNotional && styles.pillActive]}
              onPress={() => set('useNotional', true)}
            >
              <Text
                style={[
                  styles.pillText,
                  values.useNotional && styles.pillTextActive,
                ]}
              >
                NOTIONAL
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {values.useNotional && !modifyMode ? (
        <View style={styles.field}>
          <Text style={styles.label}>Notional ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={values.notional}
            onChangeText={t => set('notional', t)}
          />
        </View>
      ) : (
        <View style={styles.field}>
          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={values.qty}
            onChangeText={t => set('qty', t)}
          />
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Type</Text>
        {modifyMode ? (
          <Text style={styles.readonly}>{values.type.toUpperCase()}</Text>
        ) : (
          <View style={styles.wrapRow}>
            {ORDER_TYPES.map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.pill, values.type === t && styles.pillActive]}
                onPress={() => set('type', t)}
              >
                <Text
                  style={[
                    styles.pillText,
                    values.type === t && styles.pillTextActive,
                  ]}
                >
                  {t.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {needsLimit(values.type) && (
        <View style={styles.field}>
          <Text style={styles.label}>Limit Price</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={values.limit_price}
            onChangeText={t => set('limit_price', t)}
          />
        </View>
      )}
      {needsStop(values.type) && (
        <View style={styles.field}>
          <Text style={styles.label}>Stop Price</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={values.stop_price}
            onChangeText={t => set('stop_price', t)}
          />
        </View>
      )}
      {needsTrail(values.type) && (
        <View style={styles.field}>
          <Text style={styles.label}>Trail Percent</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={values.trail_percent}
            onChangeText={t => set('trail_percent', t)}
          />
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Time in Force</Text>
        <View style={styles.wrapRow}>
          {TIF_VALUES.map(t => (
            <TouchableOpacity
              key={t}
              style={[
                styles.pill,
                values.time_in_force === t && styles.pillActive,
              ]}
              onPress={() => set('time_in_force', t)}
            >
              <Text
                style={[
                  styles.pillText,
                  values.time_in_force === t && styles.pillTextActive,
                ]}
              >
                {t.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {!modifyMode && (
        <TouchableOpacity
          style={styles.field}
          onPress={() => set('extended_hours', !values.extended_hours)}
        >
          <Text style={styles.label}>
            Extended Hours: {values.extended_hours ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
      )}

      {errors.map(e => (
        <Text key={e} style={styles.error}>
          {e}
        </Text>
      ))}
      {submitError && <Text style={styles.error}>{submitError}</Text>}

      <TouchableOpacity
        style={[styles.submit, pending && styles.submitDisabled]}
        onPress={onSubmit}
        disabled={pending}
      >
        <Text style={styles.submitText}>
          {modifyMode ? 'Review Changes' : 'Review Order'}
        </Text>
      </TouchableOpacity>

      <Modal visible={reviewVisible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Confirm Order</Text>
            <Text style={styles.reviewLine}>Symbol: {values.symbol}</Text>
            <Text style={styles.reviewLine}>Side: {values.side.toUpperCase()}</Text>
            <Text style={styles.reviewLine}>
              {values.useNotional
                ? `Notional: $${values.notional}`
                : `Qty: ${values.qty}`}
            </Text>
            <Text style={styles.reviewLine}>Type: {values.type.toUpperCase()}</Text>
            {needsLimit(values.type) && (
              <Text style={styles.reviewLine}>Limit: {values.limit_price}</Text>
            )}
            {needsStop(values.type) && (
              <Text style={styles.reviewLine}>Stop: {values.stop_price}</Text>
            )}
            {needsTrail(values.type) && (
              <Text style={styles.reviewLine}>
                Trail %: {values.trail_percent}
              </Text>
            )}
            <Text style={styles.reviewLine}>
              TIF: {values.time_in_force.toUpperCase()}
            </Text>
            {account && (
              <Text style={styles.reviewLine}>Account: {account.name}</Text>
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setReviewVisible(false)}
                disabled={pending}
              >
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, pending && styles.submitDisabled]}
                onPress={onConfirm}
                disabled={pending}
              >
                <Text style={styles.saveText}>
                  {pending ? 'Submitting…' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  readonly: { color: '#fff', fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    fontSize: 16,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  row: { flexDirection: 'row', gap: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  pillActive: { backgroundColor: '#2196f3', borderColor: '#2196f3' },
  pillText: { color: '#aaa', fontWeight: '600', fontSize: 13 },
  pillTextActive: { color: '#fff' },
  error: { color: '#f44336', fontSize: 13, marginBottom: 8 },
  submit: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#2196f3',
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '88%',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  reviewLine: { color: '#ddd', fontSize: 14, marginBottom: 6 },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
  },
  cancel: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2196f3',
  },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
