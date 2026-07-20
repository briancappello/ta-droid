import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccounts } from '../AccountContext';

// Accounts are build-time (react-native-config) + Keystore-provisioned; this
// screen is a read-only viewer. Editing happens via the encrypted blob + `.env`.
// ponytail: no CRUD — add/edit/delete moved to build-time provisioning.
export default function AccountsScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { accounts } = useAccounts();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.menuIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Accounts</Text>
      </View>
      {accounts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No accounts provisioned. Configure ACCOUNTS_JSON and provision credentials.
          </Text>
        </View>
      ) : (
        <FlatList
          data={accounts}
          keyExtractor={a => a.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowName}>
                {item.name}{' '}
                {item.is_paper && <Text style={styles.paper}>paper</Text>}
              </Text>
              <Text style={styles.rowSub}>
                {item.id} · ••••{item.key.slice(-4)}
              </Text>
            </View>
          )}
        />
      )}
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
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: '#888', fontSize: 14, textAlign: 'center' },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  rowName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  paper: { color: '#8a97b0', fontSize: 12, fontWeight: '400' },
  rowSub: { color: '#999', fontSize: 12, marginTop: 2 },
});
