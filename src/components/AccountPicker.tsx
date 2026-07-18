// src/components/AccountPicker.tsx
import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Account } from '../alpaca';

function label(a: Account): string {
  return `${a.name} · ${a.env.toUpperCase()}`;
}

export function AccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: Account[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find(a => a.id === selectedId) ?? null;

  return (
    <View>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText}>
          {selected ? label(selected) : 'Select account'} ▼
        </Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.menu}>
            {accounts.map(a => (
              <TouchableOpacity
                key={a.id}
                style={[styles.item, a.id === selectedId && styles.itemActive]}
                onPress={() => {
                  onSelect(a.id);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.itemText,
                    a.id === selectedId && styles.itemTextActive,
                  ]}
                >
                  {label(a)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#1a1a2e',
  },
  buttonText: { color: '#2196f3', fontSize: 13, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 200,
    overflow: 'hidden',
  },
  item: { paddingVertical: 12, paddingHorizontal: 20 },
  itemActive: { backgroundColor: '#2196f3' },
  itemText: { color: '#ccc', fontSize: 14 },
  itemTextActive: { color: '#ffffff', fontWeight: 'bold' },
});
