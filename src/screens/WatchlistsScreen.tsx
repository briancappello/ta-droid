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
  fetchWatchlistSymbols,
  type Watchlist,
} from '../watchlists';
import { apiQuoteToStockQuote, fetchQuotes, type StockQuote } from '../api';
import { formatMoney, formatPercent } from '../format';

export default function WatchlistsScreen({ navigation }: { navigation: any }) {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<StockQuote[]>([]);
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
    (async () => {
      try {
        const symbols = await fetchWatchlistSymbols(selectedId);
        const quotes = await fetchQuotes(symbols);
        if (alive) {
          setRows(quotes.map(apiQuoteToStockQuote));
        }
      } catch (e: any) {
        console.warn('Watchlist symbols fetch failed:', e.message);
      }
    })();
    return () => {
      alive = false;
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
          const color = row.change >= 0 ? '#4caf50' : '#f44336';
          const sign = row.change >= 0 ? '+' : '';
          return (
            <TouchableOpacity
              key={`${row.ticker}-${i}`}
              style={styles.row}
              onPress={() =>
                navigation.navigate('ChartStack', {
                  screen: 'Chart',
                  params: { ticker: row.ticker },
                })
              }
            >
              <Text style={styles.symbol}>{row.ticker}</Text>
              <Text style={[styles.change, { color }]}>
                {sign}
                {formatMoney(row.change, row.lastPrice)} ({sign}
                {formatPercent(row.changePercent)}%)
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
