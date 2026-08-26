// src/components/AppHeader.tsx
import React, { useContext } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useBackend, type BackendHealth } from '../BackendContext';

function dotColor(h: BackendHealth): string {
  if (h === 'up') {
    return '#4caf50';
  }
  if (h === 'down') {
    return '#f44336';
  }
  return '#9e9e9e';
}

export function AppHeader({
  title,
  onMenuPress,
  onRefreshPress,
  onBackendPress,
  right,
}: {
  title: string;
  onMenuPress: () => void;
  onRefreshPress?: () => void;
  onBackendPress?: () => void;
  right?: React.ReactNode;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0 };
  const { health } = useBackend();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <TouchableOpacity onPress={onMenuPress} hitSlop={8}>
        <Text style={styles.menu}>☰</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right}
      <TouchableOpacity
        style={styles.chip}
        onPress={onBackendPress}
        disabled={!onBackendPress}
        hitSlop={8}
      >
        <View
          style={[styles.dot, { backgroundColor: dotColor(health.marketstore) }]}
        />
        <Text style={styles.chipText}>MS</Text>
        <View
          style={[styles.dot, { backgroundColor: dotColor(health.fatechan) }]}
        />
        <Text style={styles.chipText}>FA</Text>
      </TouchableOpacity>
      {onRefreshPress != null && (
        <TouchableOpacity onPress={onRefreshPress} hitSlop={8}>
          <Text style={styles.refresh}>↻</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: '#1a1a2e',
  },
  menu: { color: '#fff', fontSize: 22 },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: 'bold' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1c2740',
    borderColor: '#2c3a58',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: '#93a1b8', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  refresh: { color: '#2196f3', fontSize: 18 },
});
