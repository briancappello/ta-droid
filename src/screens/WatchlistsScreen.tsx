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
  basisLabel,
  fetchWatchlists,
  fetchWatchlistEntries,
  openLabel,
  priorCloseLabel,
  sessionLabel,
  toWatchMeta,
  toWatchRow,
  watchlistStreamKey,
  type Watchlist,
  type WatchMeta,
  type WatchRow,
} from '../watchlists';
import { formatMoney, formatPercent } from '../format';
import { stream } from '../marketstoreStream';

export default function WatchlistsScreen({ navigation }: { navigation: any }) {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [meta, setMeta] = useState<WatchMeta>(toWatchMeta(null));
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
    setMeta(toWatchMeta(null));
    if (!selectedId) {
      setRows([]);
      return;
    }
    let alive = true;
    // Instant REST paint (already includes price + pct_change).
    fetchWatchlistEntries(selectedId)
      .then(r => {
        if (alive) {
          setMeta(r.meta);
          setRows(r.rows);
        }
      })
      .catch(() => {});
    // Live re-ranking + prices.
    const off = stream.subscribe([watchlistStreamKey(selectedId)], msg => {
      if (msg.data.msg_type === 'watchlist_update') {
        const syms: any[] = msg.data.payload?.symbols ?? [];
        if (alive) {
          setMeta(toWatchMeta(msg.data.payload));
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

  // Each part is hidden when the server omits it (older servers).
  const info = [
    sessionLabel(meta.session),
    basisLabel(meta.basis),
    meta.tradingDate,
  ]
    .filter(Boolean)
    .join(' · ');
  const prior = priorCloseLabel(meta);
  const open = openLabel(meta);
  const legend = [prior && `Price vs ${prior}`, open && `change since ${open}`]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.container}>
      {header}
      <WatchlistPicker
        lists={lists}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {(info !== '' || legend !== '') && (
        <View style={styles.meta}>
          {info !== '' && <Text style={styles.metaInfo}>{info}</Text>}
          {legend !== '' && <Text style={styles.metaLegend}>{legend}</Text>}
        </View>
      )}
      <ScrollView>
        {rows.map((row, i) => {
          const green = '#4caf50';
          const red = '#f44336';
          // Price colors against prior_close (its meaning follows the basis,
          // see the legend); the change is from the session's open.
          const priceColor =
            row.priceUp == null ? '#e0e0e0' : row.priceUp ? green : red;
          const changeColor = row.changeUp ? green : red;
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
              <View style={styles.quote}>
                {row.price != null ? (
                  <>
                    <Text style={[styles.price, { color: priceColor }]}>
                      {formatMoney(row.price)}
                    </Text>
                    {row.changePct != null && (
                      <Text style={[styles.change, { color: changeColor }]}>
                        {row.changePct >= 0 ? '+' : ''}
                        {formatPercent(row.changePct)}%
                      </Text>
                    )}
                  </>
                ) : row.aggPct != null ? (
                  <Text
                    style={[
                      styles.price,
                      { color: row.aggPct >= 0 ? green : red },
                    ]}
                  >
                    {row.aggPct >= 0 ? '+' : ''}
                    {formatPercent(row.aggPct)}%
                  </Text>
                ) : (
                  <Text style={[styles.price, { color: '#e0e0e0' }]}>--</Text>
                )}
              </View>
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
  meta: { paddingHorizontal: 12, paddingBottom: 8 },
  metaInfo: { color: '#cbd5e6', fontSize: 12, fontWeight: '600' },
  metaLegend: { color: '#8a97b0', fontSize: 11, marginTop: 2 },
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
  quote: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  price: { fontSize: 16, fontWeight: '700' },
  change: { fontSize: 12, fontWeight: '600' },
});
