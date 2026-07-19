// src/screens/OrdersScreen.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';

export default function OrdersScreen({ navigation }: { navigation: any }) {
  return (
    <View style={styles.c}>
      <AppHeader
        title="Orders"
        onMenuPress={() => navigation.openDrawer()}
        onBackendPress={() =>
          navigation.navigate('SettingsStack', { screen: 'Backend' })
        }
      />
      <Text style={styles.t}>Orders</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#1a1a2e' },
  t: { color: '#8a97b0', padding: 16 },
});
