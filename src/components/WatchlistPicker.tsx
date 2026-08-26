// src/components/WatchlistPicker.tsx
import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Watchlist } from '../watchlists';

export function WatchlistPicker({
  lists,
  selectedId,
  onSelect,
}: {
  lists: Watchlist[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = lists.find(l => l.id === selectedId);
  const label = selected ? selected.name : 'Select';

  return (
    <View>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText}>{label} ▾</Text>
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
            {lists.map(l => {
              const on = l.id === selectedId;
              return (
                <TouchableOpacity
                  key={l.id}
                  style={styles.item}
                  onPress={() => {
                    onSelect(l.id);
                    setOpen(false);
                  }}
                >
                  <View style={[styles.dot, on && styles.dotOn]}>
                    {on && <View style={styles.dotInner} />}
                  </View>
                  <Text style={styles.itemText}>{l.name}</Text>
                </TouchableOpacity>
              );
            })}
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
    borderColor: '#333',
    backgroundColor: '#16213e',
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 8,
  },
  buttonText: { color: '#cbd5e6', fontSize: 12, fontWeight: '600' },
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
    borderColor: '#2a3a5a',
    minWidth: 220,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#22314f',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#5a7bb0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { borderColor: '#2196f3' },
  dotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2196f3',
  },
  itemText: { color: '#e6ecf5', fontSize: 13 },
});
