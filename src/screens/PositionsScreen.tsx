// src/screens/PositionsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAccounts } from '../AccountContext';
import { AppHeader } from '../components/AppHeader';
import {
  StrategyFilter,
  type StrategySelection,
} from '../components/StrategyFilter';
import {
  bucketByAccount,
  filterByStrategies,
  strategiesPresent,
  tagAll,
  type Tagged,
} from '../book';
import {
  AlpacaError,
  listPositions,
  type AlpacaPosition,
} from '../alpaca';
import { loadTagger } from '../strategyTagger';

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return value;
  }
  const prefix = n < 0 ? '-$' : '$';
  return (
    prefix +
    Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function PositionsScreen({ navigation }: { navigation: any }) {
  const { accounts } = useAccounts();
  const [tagged, setTagged] = useState<Tagged<AlpacaPosition>[]>([]);
  const [selection, setSelection] = useState<StrategySelection>('all');
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled(
      accounts.map(a => listPositions(a)),
    );
    let firstError: string | null = null;
    const perAccount = accounts.map((account, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        return { account, items: r.value };
      }
      const reason = r.reason;
      const message =
        reason instanceof AlpacaError ? reason.message : 'Something went wrong.';
      if (firstError == null) {
        firstError = message;
      }
      console.warn('Positions fetch failed:', message);
      return { account, items: [] as AlpacaPosition[] };
    });
    setError(firstError);
    const strategyOf = await loadTagger();
    setTagged(tagAll(perAccount, strategyOf));
    setLoading(false);
  }, [accounts]);

  useEffect(() => {
    load();
    const unsub = navigation.addListener?.('focus', load);
    return () => unsub?.();
  }, [load, navigation]);

  const options = useMemo(() => strategiesPresent(tagged), [tagged]);
  const buckets = useMemo(
    () => bucketByAccount(filterByStrategies(tagged, selection)),
    [tagged, selection],
  );

  if (accounts.length === 0) {
    return (
      <View style={styles.container}>
        <AppHeader
          title="Positions"
          onMenuPress={() => navigation.openDrawer()}
          onRefreshPress={load}
          onBackendPress={() =>
            navigation.navigate('SettingsStack', { screen: 'Backend' })
          }
        />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Add an account to start trading.</Text>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('SettingsStack', { screen: 'Accounts' })
            }
          >
            <Text style={styles.link}>Go to Accounts</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader
        title="Positions"
        onMenuPress={() => navigation.openDrawer()}
        onRefreshPress={load}
        onBackendPress={() =>
          navigation.navigate('SettingsStack', { screen: 'Backend' })
        }
      />
      <StrategyFilter
        options={options}
        selection={selection}
        onChange={setSelection}
      />
      {error != null && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}
      <ScrollView>
        {buckets.map(bucket => {
          const pl = bucket.rows.reduce(
            (sum, row) => sum + Number(row.item.unrealized_pl),
            0,
          );
          const plColor = pl >= 0 ? '#4caf50' : '#f44336';
          return (
            <View key={bucket.account.id} style={styles.bucket}>
              <View style={styles.bucketHeader}>
                <Text style={styles.bucketName}>
                  {bucket.account.name}{' '}
                  <Text style={styles.env}>
                    ({bucket.account.env === 'live' ? 'live' : 'paper'})
                  </Text>
                </Text>
                <Text style={[styles.bucketPl, { color: plColor }]}>
                  {formatMoney(String(pl))}
                </Text>
              </View>
              {bucket.rows.map((row, i) => {
                const p = row.item;
                const rowColor =
                  Number(p.unrealized_pl) >= 0 ? '#4caf50' : '#f44336';
                return (
                  <TouchableOpacity
                    key={`${p.symbol}-${i}`}
                    style={styles.row}
                    onPress={() =>
                      navigation.navigate('ChartStack', {
                        screen: 'Chart',
                        params: { ticker: p.symbol },
                      })
                    }
                  >
                    <View style={styles.rowLeft}>
                      <Text style={styles.symbol}>{p.symbol}</Text>
                      <Text style={styles.sub}>
                        {p.qty} @ {formatMoney(p.avg_entry_price)}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.value}>
                        {formatMoney(p.market_value)}
                      </Text>
                      <Text style={[styles.sub, { color: rowColor }]}>
                        {formatMoney(p.unrealized_pl)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: '#8a97b0', fontSize: 15 },
  link: { color: '#2196f3', fontSize: 15, fontWeight: '600' },
  banner: { backgroundColor: '#3a1414', padding: 12, marginHorizontal: 12, borderRadius: 6 },
  bannerText: { color: '#f44336', fontSize: 13 },
  bucket: { marginBottom: 12 },
  bucketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16213e',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bucketName: { color: '#e6ecf5', fontSize: 15, fontWeight: '700' },
  env: { color: '#8a97b0', fontSize: 12, fontWeight: '400' },
  bucketPl: { fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#22314f',
  },
  rowLeft: { gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  symbol: { color: '#fff', fontSize: 15, fontWeight: '600' },
  value: { color: '#e6ecf5', fontSize: 14 },
  sub: { color: '#8a97b0', fontSize: 12 },
});

export default PositionsScreen;
