// src/screens/ExitScreen.tsx
import React, { useContext, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { useAccounts } from '../AccountContext';
import {
  finishExit,
  flattenPlan,
  holdingsForSymbol,
  submitFlatten,
  type FlattenLeg,
  type SubmitResult,
  type SymbolHolding,
} from '../flatten';
import type { OrderType } from '../alpaca';
import { postExitSuppress } from '../techan';

const TYPES: { label: string; value: OrderType }[] = [
  { label: 'Market', value: 'market' },
  { label: 'Limit', value: 'limit' },
  { label: 'Stop', value: 'stop' },
];

const needsPrice = (t: OrderType): boolean => t === 'limit' || t === 'stop';

export default function ExitScreen({
  route,
  navigation,
}: {
  route: { params: { symbol: string } };
  navigation: any;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? { bottom: 0 };
  const { accounts } = useAccounts();
  const { symbol } = route.params;

  const [holdings, setHoldings] = useState<SymbolHolding[]>([]);
  const [legs, setLegs] = useState<FlattenLeg[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<SubmitResult[]>([]);

  useEffect(() => {
    holdingsForSymbol(accounts, symbol)
      .then(h => {
        setHoldings(h);
        setLegs(flattenPlan(h));
      })
      .catch((e: Error) => {
        console.warn('holdingsForSymbol failed:', e.message);
        setHoldings([]);
        setLegs([]);
      });
  }, [accounts, symbol]);

  const editLeg = (i: number, patch: Partial<FlattenLeg['req']>) => {
    setLegs(prev =>
      prev.map((l, idx) =>
        idx === i ? { ...l, req: { ...l.req, ...patch } } : l,
      ),
    );
  };

  const onType = (i: number, t: OrderType) => {
    const patch: Partial<FlattenLeg['req']> = { type: t };
    if (t === 'limit') {
      patch.stop_price = undefined;
    } else if (t === 'stop') {
      patch.limit_price = undefined;
    } else {
      patch.limit_price = undefined;
      patch.stop_price = undefined;
    }
    editLeg(i, patch);
  };

  const onPrice = (i: number, t: OrderType, v: string) => {
    editLeg(i, t === 'stop' ? { stop_price: v } : { limit_price: v });
  };

  const onExitAll = async () => {
    setPending(true);
    const { results, allOk } = await finishExit(
      legs,
      symbol,
      submitFlatten,
      postExitSuppress,
    );
    setPending(false);
    if (allOk) {
      Alert.alert('Flat', `Exited ${legs.length} account(s).`);
      navigation.goBack();
    } else {
      setFailed(results.filter(r => !r.ok));
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <AppHeader
        title={`Go flat — ${legs.length} accounts`}
        onMenuPress={() => navigation.goBack()}
      />
      {holdings.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No open position.</Text>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView style={styles.list}>
            {legs.map((leg, i) => {
              const { req } = leg;
              const expanded = expandedIndex === i;
              const orderText = `${req.side === 'sell' ? 'Sell' : 'Buy'} ${
                req.qty
              } · ${req.type}`;
              const price =
                req.type === 'stop' ? req.stop_price : req.limit_price;
              return (
                <View key={leg.account.id} style={styles.row}>
                  <TouchableOpacity
                    onPress={() => setExpandedIndex(expanded ? null : i)}
                  >
                    <Text style={styles.accountName}>{leg.account.name}</Text>
                    <Text style={styles.orderText}>{orderText}</Text>
                  </TouchableOpacity>
                  {expanded && (
                    <View style={styles.editor}>
                      <View style={styles.typeRow}>
                        {TYPES.map(t => {
                          const active = req.type === t.value;
                          return (
                            <TouchableOpacity
                              key={t.value}
                              style={[
                                styles.typeBtn,
                                active && styles.typeBtnActive,
                              ]}
                              onPress={() => onType(i, t.value)}
                            >
                              <Text
                                style={
                                  active
                                    ? styles.typeTextActive
                                    : styles.typeText
                                }
                              >
                                {t.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={styles.label}>Qty</Text>
                      <TextInput
                        style={styles.input}
                        value={req.qty}
                        keyboardType="decimal-pad"
                        placeholder="Qty"
                        placeholderTextColor="#666"
                        onChangeText={v => editLeg(i, { qty: v })}
                      />
                      {needsPrice(req.type) && (
                        <>
                          <Text style={styles.label}>Price</Text>
                          <TextInput
                            style={styles.input}
                            value={price ?? ''}
                            keyboardType="decimal-pad"
                            placeholder="Price"
                            placeholderTextColor="#666"
                            onChangeText={v => onPrice(i, req.type, v)}
                          />
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            {failed.length > 0 && (
              <View style={styles.failBox}>
                <Text style={styles.failTitle}>Some exits failed</Text>
                {failed.map(f => (
                  <Text key={f.leg.account.id} style={styles.failText}>
                    {f.leg.account.name}: {f.error}
                  </Text>
                ))}
              </View>
            )}
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exitBtn, pending && styles.exitBtnDisabled]}
              onPress={onExitAll}
              disabled={pending}
            >
              <Text style={styles.exitText}>
                {pending ? 'Exiting…' : 'Exit all'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1a1a2e' },
  list: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 },
  emptyText: { color: '#aaa', fontSize: 16 },
  row: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  accountName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  orderText: { color: '#93a1b8', fontSize: 14, marginTop: 4 },
  editor: { marginTop: 14, gap: 6 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: '#2196f3', borderColor: '#2196f3' },
  typeText: { color: '#aaa', fontWeight: '600' },
  typeTextActive: { color: '#fff', fontWeight: '600' },
  label: { color: '#93a1b8', fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    fontSize: 16,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  failBox: {
    margin: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f44336',
    backgroundColor: '#2a1618',
  },
  failTitle: { color: '#f44336', fontSize: 15, fontWeight: '700', marginBottom: 6 },
  failText: { color: '#f44336', fontSize: 13, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    padding: 16,
  },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  cancelText: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  exitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#f44336',
  },
  exitBtnDisabled: { opacity: 0.5 },
  exitText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
