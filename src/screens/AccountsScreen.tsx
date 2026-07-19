import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccounts } from '../AccountContext';
import { addAccount, updateAccount, deleteAccount } from '../accounts';
import type { Account, AlpacaEnv } from '../alpaca';

type Draft = {
  id: string | null;
  name: string;
  key: string;
  secret: string;
  env: AlpacaEnv;
};

const EMPTY_DRAFT: Draft = { id: null, name: '', key: '', secret: '', env: 'paper' };

export default function AccountsScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { accounts, reload } = useAccounts();
  const [modalVisible, setModalVisible] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setModalVisible(true);
  };
  const openEdit = (a: Account) => {
    setDraft({ id: a.id, name: a.name, key: a.key, secret: a.secret, env: a.env });
    setModalVisible(true);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.key.trim() || !draft.secret.trim()) {
      Alert.alert('Missing fields', 'Name, key, and secret are required.');
      return;
    }
    if (draft.id) {
      await updateAccount({
        id: draft.id,
        name: draft.name.trim(),
        key: draft.key.trim(),
        secret: draft.secret.trim(),
        env: draft.env,
      });
    } else {
      await addAccount({
        name: draft.name.trim(),
        key: draft.key.trim(),
        secret: draft.secret.trim(),
        env: draft.env,
      });
    }
    await reload();
    setModalVisible(false);
  };

  const remove = (a: Account) =>
    Alert.alert('Delete account', `Delete "${a.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteAccount(a.id);
          await reload();
        },
      },
    ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.menuIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Accounts</Text>
        <TouchableOpacity onPress={openAdd}>
          <Text style={styles.add}>＋</Text>
        </TouchableOpacity>
      </View>
      {accounts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No accounts yet. Tap ＋ to add one.</Text>
        </View>
      ) : (
        <FlatList
          data={accounts}
          keyExtractor={a => a.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openEdit(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowSub}>
                  {item.env.toUpperCase()} · ••••{item.key.slice(-4)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(item)}>
                <Text style={styles.delete}>Delete</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {draft.id ? 'Edit Account' : 'Add Account'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor="#666"
              value={draft.name}
              onChangeText={t => setDraft(d => ({ ...d, name: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="API Key ID"
              placeholderTextColor="#666"
              autoCapitalize="none"
              value={draft.key}
              onChangeText={t => setDraft(d => ({ ...d, key: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="API Secret"
              placeholderTextColor="#666"
              autoCapitalize="none"
              secureTextEntry
              value={draft.secret}
              onChangeText={t => setDraft(d => ({ ...d, secret: t }))}
            />
            <View style={styles.envRow}>
              {(['paper', 'live'] as AlpacaEnv[]).map(e => (
                <TouchableOpacity
                  key={e}
                  style={[styles.envBtn, draft.env === e && styles.envBtnActive]}
                  onPress={() => setDraft(d => ({ ...d, env: e }))}
                >
                  <Text
                    style={[
                      styles.envText,
                      draft.env === e && styles.envTextActive,
                    ]}
                  >
                    {e.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  add: { color: '#fff', fontSize: 22 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#888', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  rowName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  rowSub: { color: '#999', fontSize: 12, marginTop: 2 },
  delete: { color: '#f44336', fontSize: 13, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '88%',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  input: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    fontSize: 16,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  envRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  envBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  envBtnActive: { backgroundColor: '#2196f3', borderColor: '#2196f3' },
  envText: { color: '#aaa', fontWeight: '600' },
  envTextActive: { color: '#fff' },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  cancel: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2196f3',
  },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
