// src/components/StrategyFilter.tsx
import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type StrategySelection = string[] | 'all';

export function strategyLabel(selection: StrategySelection): string {
  if (selection === 'all') {
    return 'All';
  }
  if (selection.length === 1) {
    return selection[0];
  }
  return `${selection.length} strategies`;
}

export function toggle(
  selection: StrategySelection,
  option: string,
  options: string[],
  onChange: (s: StrategySelection) => void,
) {
  let next: string[];
  if (selection === 'all') {
    next = [option];
  } else if (selection.includes(option)) {
    next = selection.filter(o => o !== option);
  } else {
    next = [...selection, option];
  }
  if (next.length === 0 || next.length === options.length) {
    onChange('all');
  } else {
    onChange(next);
  }
}

export function StrategyFilter({
  options,
  selection,
  onChange,
}: {
  options: string[];
  selection: StrategySelection;
  onChange: (s: StrategySelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const isAll = selection === 'all';
  const has = (o: string) => (selection === 'all' ? false : selection.includes(o));

  return (
    <View>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText}>Strategy: {strategyLabel(selection)} ▾</Text>
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
            <TouchableOpacity
              style={[styles.item, styles.head]}
              onPress={() => onChange('all')}
            >
              <View style={[styles.box, isAll && styles.boxOn]}>
                {isAll && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={styles.itemText}>All strategies</Text>
            </TouchableOpacity>
            {options.map(o => (
              <TouchableOpacity
                key={o}
                style={styles.item}
                onPress={() => toggle(selection, o, options, onChange)}
              >
                <View style={[styles.box, has(o) && styles.boxOn]}>
                  {has(o) && <Text style={styles.check}>✓</Text>}
                </View>
                <Text style={styles.itemText}>{o}</Text>
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
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: '#22314f' },
  head: { backgroundColor: '#12233f' },
  box: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: '#5a7bb0', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#2196f3', borderColor: '#2196f3' },
  check: { color: '#fff', fontSize: 10 },
  itemText: { color: '#e6ecf5', fontSize: 13 },
});
