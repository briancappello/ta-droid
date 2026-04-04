import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { fetchQuotes, apiQuoteToStockQuote, type StockQuote } from '../api';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Portfolio'>;
};

const TABS = ['QUOTES', 'HOLDINGS', 'DETAILS'] as const;

// --- Formatting ---

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatChange(change: number): string {
  const prefix = change >= 0 ? '+ ' : '- ';
  return prefix + formatPrice(Math.abs(change));
}

function formatPercent(pct: number): string {
  const prefix = pct >= 0 ? '+' : '';
  return prefix + pct.toFixed(2) + '%';
}

// --- Components ---

function HeaderBar({
  onAddPress,
  onRefreshPress,
}: {
  onAddPress: () => void;
  onRefreshPress: () => void;
}) {
  return (
    <View style={styles.headerBar}>
      <Text style={styles.headerMenuIcon}>☰</Text>
      <View style={styles.headerTitleContainer}>
        <Text style={styles.headerTitle}>My Portfolio</Text>
        <Text style={styles.headerDropdown}> ▼</Text>
      </View>
      <View style={styles.headerActions}>
        <TouchableOpacity onPress={onRefreshPress}>
          <Text style={styles.headerIcon}>↻</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onAddPress}>
          <Text style={styles.headerIcon}>＋</Text>
        </TouchableOpacity>
        <Text style={styles.headerIcon}>⋮</Text>
      </View>
    </View>
  );
}

function TabBar({
  activeTab,
  onTabPress,
}: {
  activeTab: string;
  onTabPress: (tab: string) => void;
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
            {tab}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ColumnHeaders() {
  return (
    <View style={styles.columnHeaders}>
      <Text style={styles.colHeaderLeft}>▼ Ticker</Text>
      <Text style={styles.colHeaderCenter}>Last Price ⇅</Text>
      <Text style={styles.colHeaderRight}>Change ⇅</Text>
    </View>
  );
}

function StockRow({
  item,
  onPress,
}: {
  item: StockQuote;
  onPress: () => void;
}) {
  const isPositive = item.change >= 0;
  const changeColor = isPositive ? '#4caf50' : '#f44336';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
      <View style={styles.stockRow}>
        <View style={styles.stockRowMain}>
          <View style={styles.stockLeft}>
            <Text style={styles.tickerText}>{item.ticker}</Text>
            <Text style={styles.nameText} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <View style={styles.stockCenter}>
            <Text style={styles.priceText}>{formatPrice(item.lastPrice)}</Text>
            <Text style={styles.timeText}>{item.time}</Text>
          </View>
          <View style={styles.stockRight}>
            <Text style={[styles.changeText, { color: changeColor }]}>
              {formatChange(item.change)}
            </Text>
            <Text style={[styles.percentText, { color: changeColor }]}>
              {formatPercent(item.changePercent)}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function AddTickerModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (ticker: string) => void;
}) {
  const [ticker, setTicker] = useState('');

  const handleAdd = () => {
    const trimmed = ticker.trim().toUpperCase();
    if (trimmed) {
      onAdd(trimmed);
      setTicker('');
      onClose();
    }
  };

  const handleCancel = () => {
    setTicker('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Add Ticker</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="e.g. AAPL"
            placeholderTextColor="#666"
            value={ticker}
            onChangeText={setTicker}
            autoCapitalize="characters"
            autoFocus
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={handleCancel}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalAddButton,
                !ticker.trim() && styles.modalAddButtonDisabled,
              ]}
              onPress={handleAdd}
              disabled={!ticker.trim()}
            >
              <Text style={styles.modalAddText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// --- Screen ---

export default function PortfolioScreen({ navigation }: Props) {
  const safeAreaInsets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<string>('QUOTES');
  const [tickers, setTickers] = useState<string[]>([
    'AAPL',
    'GOOG',
    'MSFT',
    'AMZN',
    'TSLA',
    'INTC',
    'QQQ',
    'VTI',
  ]);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const refreshQuotes = useCallback(async () => {
    if (tickers.length === 0) {
      return;
    }
    setLoading(true);
    try {
      const apiQuotes = await fetchQuotes(tickers);
      setQuotes(apiQuotes.map(apiQuoteToStockQuote));
    } catch (e) {
      console.warn('Failed to fetch quotes:', e);
    } finally {
      setLoading(false);
    }
  }, [tickers]);

  useEffect(() => {
    refreshQuotes();
  }, [refreshQuotes]);

  const handleAddTicker = (ticker: string) => {
    if (tickers.includes(ticker)) {
      return;
    }
    setTickers(prev => [...prev, ticker]);
  };

  return (
    <View style={[styles.container, { paddingTop: safeAreaInsets.top }]}>
      <HeaderBar
        onAddPress={() => setModalVisible(true)}
        onRefreshPress={refreshQuotes}
      />
      <TabBar activeTab={activeTab} onTabPress={setActiveTab} />
      <ColumnHeaders />
      {loading && quotes.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196f3" />
        </View>
      ) : (
        <FlatList
          data={quotes}
          keyExtractor={item => item.ticker}
          renderItem={({ item }) => (
            <StockRow
              item={item}
              onPress={() =>
                navigation.navigate('Chart', { ticker: item.ticker })
              }
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          style={styles.list}
        />
      )}
      <AddTickerModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onAdd={handleAddTicker}
      />
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e',
  },
  headerMenuIcon: {
    color: '#ffffff',
    fontSize: 22,
    marginRight: 12,
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerDropdown: {
    color: '#ffffff',
    fontSize: 12,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
  },
  headerIcon: {
    color: '#ffffff',
    fontSize: 20,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: '#2196f3',
  },
  tabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#2196f3',
  },
  columnHeaders: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  colHeaderLeft: {
    flex: 1,
    color: '#aaa',
    fontSize: 12,
  },
  colHeaderCenter: {
    flex: 1,
    color: '#aaa',
    fontSize: 12,
    textAlign: 'right',
  },
  colHeaderRight: {
    flex: 1,
    color: '#aaa',
    fontSize: 12,
    textAlign: 'right',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    flex: 1,
  },
  stockRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e',
  },
  stockRowMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stockLeft: {
    flex: 1,
  },
  tickerText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  nameText: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  stockCenter: {
    flex: 1,
    alignItems: 'flex-end',
  },
  priceText: {
    color: '#ffffff',
    fontSize: 16,
  },
  timeText: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  stockRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  changeText: {
    fontSize: 16,
    fontWeight: '500',
  },
  percentText: {
    fontSize: 11,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#2a2a4a',
    marginHorizontal: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '85%',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#1a1a2e',
    color: '#ffffff',
    fontSize: 16,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#555',
  },
  modalCancelText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },
  modalAddButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2196f3',
  },
  modalAddButtonDisabled: {
    backgroundColor: '#333',
  },
  modalAddText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
