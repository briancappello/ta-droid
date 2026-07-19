// src/screens/PositionsScreen.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';

export default function PositionsScreen({ navigation }: { navigation: any }) {
  return (
    <View style={styles.c}>
      <AppHeader
        title="Positions"
        onMenuPress={() => navigation.openDrawer()}
        onBackendPress={() =>
          navigation.navigate('SettingsStack', { screen: 'Backend' })
        }
      />
      <Text style={styles.t}>Positions</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#1a1a2e' },
  t: { color: '#8a97b0', padding: 16 },
});
