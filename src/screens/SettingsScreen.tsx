// src/screens/SettingsScreen.tsx
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { useAccounts } from '../AccountContext';

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value != null && <Text style={styles.rowValue}>{value}</Text>}
        <Text style={styles.chev}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }: { navigation: any }) {
  const { accounts } = useAccounts();
  return (
    <View style={styles.container}>
      <AppHeader title="Settings" onMenuPress={() => navigation.openDrawer()} />
      <ScrollView>
        <Row
          label="Accounts"
          value={`${accounts.length} linked`}
          onPress={() => navigation.navigate('Accounts')}
        />
        <Row
          label="Backend"
          value="host·port·auth"
          onPress={() => navigation.navigate('Backend')}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  rowLabel: { color: '#fff', fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowValue: { color: '#8a97b0', fontSize: 13 },
  chev: { color: '#6b7690', fontSize: 18 },
});
