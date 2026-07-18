import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useAccounts } from '../AccountContext';
import { AccountPicker } from '../components/AccountPicker';
import {
  AlpacaError,
  cancelOrder,
  closePosition,
  listOpenOrders,
  listPositions,
  type AlpacaOrder,
  type AlpacaPosition,
} from '../alpaca';

type Tab = 'POSITIONS' | 'ORDERS';
const TABS: Tab[] = ['POSITIONS', 'ORDERS'];

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

const Separator = () => <View style={styles.separator} />;
const EmptyPositions = () => (
  <Text style={styles.emptyText}>No open positions.</Text>
);
const EmptyOrders = () => <Text style={styles.emptyText}>No open orders.</Text>;

function TabBar({
  activeTab,
  onTabPress,
}: {
  activeTab: Tab;
  onTabPress: (tab: Tab) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {TABS.map(tab => (
        <TouchableOpacity
          key={tab}
          style={[styles.tab, activeTab === tab && styles.activeTab]}
          onPress={() => onTabPress(tab)}
        >
          <Text
            style={[styles.tabText, activeTab === tab && styles.activeTabText]}
          >
            {tab === 'ORDERS' ? 'OPEN ORDERS' : tab}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function PositionRow({
  item,
  onPress,
}: {
  item: AlpacaPosition;
  onPress: () => void;
}) {
  const pl = Number(item.unrealized_pl);
  const plColor = pl >= 0 ? '#4caf50' : '#f44336';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.symbolText}>{item.symbol}</Text>
          <Text style={styles.subText}>
            {item.qty} @ {formatMoney(item.avg_entry_price)}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.valueText}>{formatMoney(item.market_value)}</Text>
          <Text style={[styles.plText, { color: plColor }]}>
            {pl >= 0 ? '+' : ''}
            {formatMoney(item.unrealized_pl)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function OrderRow({
  item,
  onPress,
}: {
  item: AlpacaOrder;
  onPress: () => void;
}) {
  const price =
    item.limit_price ?? item.stop_price ?? item.trail_percent ?? null;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.symbolText}>{item.symbol}</Text>
          <Text style={styles.subText}>
            {item.side.toUpperCase()} {item.type} · {item.qty ?? item.notional}
          </Text>
        </View>
        <View style={styles.rowRight}>
          {price != null && (
            <Text style={styles.valueText}>{formatMoney(price)}</Text>
          )}
          <Text style={styles.subText}>{item.status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function TradingScreen({ navigation }: { navigation: any }) {
  // Read insets from context with a null-safe fallback so the screen renders
  // even outside a SafeAreaProvider (e.g. under the jest smoke test).
  const insets = React.useContext(SafeAreaInsetsContext) ?? { top: 0 };
  const { accounts, activeId, activeAccount, setActiveId } = useAccounts();
  const [tab, setTab] = useState<Tab>('POSITIONS');
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!activeAccount) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (tab === 'POSITIONS') {
        setPositions(await listPositions(activeAccount));
      } else {
        setOrders(await listOpenOrders(activeAccount));
      }
    } catch (e) {
      // ponytail: security — log only e.message, never account/headers/init.
      const message =
        e instanceof AlpacaError ? e.message : 'Something went wrong.';
      console.warn('Trading fetch failed:', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeAccount, tab]);

  // Fetch on mount / active-account / tab change, and refetch whenever the
  // drawer screen regains focus. `addListener` is guarded so the screen still
  // renders when navigation is a bare test stub.
  useEffect(() => {
    load();
    const unsub = navigation.addListener?.('focus', load);
    return unsub;
  }, [load, navigation]);

  const goToOrderEntry = (params: {
    symbol?: string;
    order?: AlpacaOrder;
  }) => {
    navigation.navigate('PortfolioStack', {
      screen: 'OrderEntry',
      params: { accountId: activeId, ...params },
    });
  };

  const runWrite = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      // ponytail: security — log only e.message, never account/headers/init.
      const message =
        e instanceof AlpacaError ? e.message : 'Something went wrong.';
      console.warn('Trading action failed:', message);
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const onPositionPress = (p: AlpacaPosition) => {
    if (!activeAccount) {
      return;
    }
    const account = activeAccount;
    Alert.alert(p.symbol, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close position',
        style: 'destructive',
        onPress: () => runWrite(() => closePosition(account, p.symbol)),
      },
      { text: 'New order', onPress: () => goToOrderEntry({ symbol: p.symbol }) },
    ]);
  };

  const onOrderPress = (o: AlpacaOrder) => {
    if (!activeAccount) {
      return;
    }
    const account = activeAccount;
    Alert.alert(`${o.symbol} order`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Modify', onPress: () => goToOrderEntry({ order: o }) },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: () => runWrite(() => cancelOrder(account, o.id)),
      },
    ]);
  };

  if (!activeAccount) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Trading</Text>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Add an account to start trading.</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Accounts')}>
            <Text style={styles.link}>Go to Accounts</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <View style={styles.pickerWrap}>
          <AccountPicker
            accounts={accounts}
            selectedId={activeId}
            onSelect={setActiveId}
          />
        </View>
        {/* ponytail: refresh button only. Pull-to-refresh (RefreshControl on
            FlatList) is omitted — its element breaks react-test-renderer's
            JSON.stringify(toJSON()) smoke test. Add back with a native test
            harness that doesn't serialize the tree. */}
        <TouchableOpacity onPress={load} disabled={pending}>
          <Text style={styles.refresh}>↻</Text>
        </TouchableOpacity>
      </View>

      <TabBar activeTab={tab} onTabPress={setTab} />

      {error != null && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}

      {loading && positions.length === 0 && orders.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#2196f3" />
        </View>
      ) : tab === 'POSITIONS' ? (
        <FlatList
          data={positions}
          keyExtractor={p => p.symbol}
          renderItem={({ item }) => (
            <PositionRow item={item} onPress={() => onPositionPress(item)} />
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={EmptyPositions}
        />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          renderItem={({ item }) => (
            <OrderRow item={item} onPress={() => onOrderPress(item)} />
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={EmptyOrders}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => goToOrderEntry({})}
        disabled={pending}
      >
        <Text style={styles.fabText}>＋ New Order</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  menuIcon: { color: '#fff', fontSize: 22 },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: 'bold' },
  pickerWrap: { flex: 1 },
  refresh: { color: '#2196f3', fontSize: 22 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  activeTab: { borderBottomWidth: 3, borderBottomColor: '#2196f3' },
  tabText: { color: '#888', fontSize: 13, fontWeight: '600' },
  activeTabText: { color: '#2196f3' },
  banner: {
    backgroundColor: '#f44336',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerText: { color: '#fff', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#1a1a2e',
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  symbolText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  subText: { color: '#999', fontSize: 12, marginTop: 2 },
  valueText: { color: '#fff', fontSize: 15 },
  plText: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  separator: {
    height: 1,
    backgroundColor: '#2a2a4a',
    marginHorizontal: 12,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  link: { color: '#2196f3', fontSize: 14, fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: '#2196f3',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
  },
  fabText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
