// src/screens/WatchlistsScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { WatchlistPicker } from '../components/WatchlistPicker';
import {
  fetchWatchlists,
  fetchWatchlistEntries,
  toWatchRow,
  watchlistStreamKey,
  type Watchlist,
  type WatchRow,
} from '../watchlists';
import { formatMoney, formatPercent } from '../format';
import { stream } from '../marketstoreStream';

export default function WatchlistsScreen({ navigation }: { navigation: any }) {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const ls = await fetchWatchlists();
      setLists(ls);
      setSelectedId(ls[0]?.id ?? null);
    } catch (e: any) {
      console.warn('Watchlists fetch failed:', e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setRows([]);
      return;
    }
    let alive = true;
    // Instant REST paint (already includes price + pct_change).
    fetchWatchlistEntries(selectedId)
      .then(r => {
        if (alive) {
          setRows(r);
        }
      })
      .catch(() => {});
    // Live re-ranking + prices.
    const off = stream.subscribe([watchlistStreamKey(selectedId)], msg => {
      if (msg.data.msg_type === 'watchlist_update') {
        const syms: any[] = msg.data.payload?.symbols ?? [];
        if (alive) {
          setRows(syms.map(toWatchRow));
        }
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [selectedId]);

  const header = (
    <AppHeader
      title="Watchlists"
      onMenuPress={() => navigation.openDrawer()}
      onRefreshPress={load}
      onBackendPress={() =>
        navigation.navigate('SettingsStack', { screen: 'Backend' })
      }
    />
  );

  if (loaded && lists.length === 0) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Watchlists unavailable.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <WatchlistPicker
        lists={lists}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <ScrollView>
        {rows.map((row, i) => {
          const up = (row.changePct ?? 0) >= 0;
          const color = up ? '#4caf50' : '#f44336';
          const sign = up ? '+' : '';
          return (
            <TouchableOpacity
              key={`${row.symbol}-${i}`}
              style={styles.row}
              onPress={() =>
                navigation.navigate('ChartStack', {
                  screen: 'Chart',
                  params: { ticker: row.symbol },
                })
              }
            >
              <Text style={styles.symbol}>{row.symbol}</Text>
              <Text style={[styles.change, { color }]}>
                {row.price != null ? formatMoney(row.price) : '--'}
                {row.change != null
                  ? `  ${sign}${formatMoney(row.change, row.price ?? row.change)}`
                  : ''}
                {row.changePct != null
                  ? ` (${sign}${formatPercent(row.changePct)}%)`
                  : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#8a97b0', fontSize: 15 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#22314f',
  },
  symbol: { color: '#fff', fontSize: 15, fontWeight: '600' },
  change: { fontSize: 14, fontWeight: '600' },
});
