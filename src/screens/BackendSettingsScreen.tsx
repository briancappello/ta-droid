// src/screens/BackendSettingsScreen.tsx
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Config from 'react-native-config';
import { AppHeader } from '../components/AppHeader';

// ponytail: Phase 1 keeps host/port/auth in local state only. Keychain
// persistence + applying it to the fa-techan client lands in Task 15.
export default function BackendSettingsScreen({ navigation }: { navigation: any }) {
  const initial = Config.API_BASE_URL ?? '';
  const [host, setHost] = useState(initial);
  const [port, setPort] = useState('');
  const [auth, setAuth] = useState('');

  return (
    <View style={styles.container}>
      <AppHeader title="Backend" onMenuPress={() => navigation.goBack()} />
      <View style={styles.body}>
        <TextInput
          style={styles.input}
          placeholder="Host / base URL"
          placeholderTextColor="#666"
          autoCapitalize="none"
          value={host}
          onChangeText={setHost}
        />
        <TextInput
          style={styles.input}
          placeholder="Port"
          placeholderTextColor="#666"
          keyboardType="number-pad"
          value={port}
          onChangeText={setPort}
        />
        <TextInput
          style={styles.input}
          placeholder="Auth token"
          placeholderTextColor="#666"
          autoCapitalize="none"
          secureTextEntry
          value={auth}
          onChangeText={setAuth}
        />
        <TouchableOpacity style={styles.save}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  body: { padding: 16, gap: 12 },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    fontSize: 15,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  save: {
    backgroundColor: '#2196f3',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
