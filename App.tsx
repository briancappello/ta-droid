/**
 * Stock Portfolio App
 *
 * @format
 */

import React, { useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PositionsScreen from './src/screens/PositionsScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import WatchlistsScreen from './src/screens/WatchlistsScreen';
import ChartScreen from './src/screens/ChartScreen';
import OrderEntryScreen from './src/screens/OrderEntryScreen';
import ExitScreen from './src/screens/ExitScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BackendSettingsScreen from './src/screens/BackendSettingsScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import { AccountProvider, useAccounts } from './src/AccountContext';
import { BackendProvider } from './src/BackendContext';
import type { Order } from './src/broker';

// Consumed by the ChartStack (below) — Chart/OrderEntry/Exit routes.
export type RootStackParamList = {
  Chart: { ticker: string };
  OrderEntry: { accountId?: string; symbol?: string; order?: Order };
  Exit: { symbol: string };
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  Accounts: undefined;
  Backend: undefined;
};

export type RootDrawerParamList = {
  Positions: undefined;
  Orders: undefined;
  Watchlists: undefined;
  SettingsStack: undefined;
  ChartStack: undefined;
};

const Drawer = createDrawerNavigator<RootDrawerParamList>();
const SettingsNav = createNativeStackNavigator<SettingsStackParamList>();
const ChartNav = createNativeStackNavigator<RootStackParamList>();

function ChartStack() {
  return (
    <ChartNav.Navigator screenOptions={{ headerShown: false }}>
      <ChartNav.Screen name="Chart" component={ChartScreen} />
      <ChartNav.Screen name="OrderEntry" component={OrderEntryScreen} />
      <ChartNav.Screen name="Exit" component={ExitScreen} />
    </ChartNav.Navigator>
  );
}

function SettingsStack() {
  return (
    <SettingsNav.Navigator screenOptions={{ headerShown: false }}>
      <SettingsNav.Screen name="SettingsHome" component={SettingsScreen} />
      <SettingsNav.Screen name="Accounts" component={AccountsScreen} />
      <SettingsNav.Screen name="Backend" component={BackendSettingsScreen} />
    </SettingsNav.Navigator>
  );
}

function ProvisioningGate({ children }: { children: React.ReactNode }) {
  const { provStatus, provision } = useAccounts();
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);
  if (provStatus === 'checking') {
    return null; // brief; splash acceptable
  }
  if (provStatus === 'need-passphrase') {
    return (
      <View style={gateStyles.c}>
        <Text style={gateStyles.t}>Enter provisioning passphrase</Text>
        <TextInput
          style={gateStyles.input}
          secureTextEntry
          autoCapitalize="none"
          value={pass}
          onChangeText={setPass}
        />
        {error && <Text style={gateStyles.err}>Incorrect passphrase.</Text>}
        <TouchableOpacity
          style={gateStyles.btn}
          onPress={async () => {
            const ok = await provision(pass);
            if (!ok) {
              setError(true);
              setPass('');
            }
          }}
        >
          <Text style={gateStyles.btnText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return <>{children}</>;
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
        <AccountProvider>
          <ProvisioningGate>
          <BackendProvider poll>
            <NavigationContainer>
              <Drawer.Navigator
                initialRouteName="Watchlists"
                backBehavior="history"
                screenOptions={{
                  headerShown: false,
                  drawerStyle: { backgroundColor: '#16213e' },
                  drawerActiveTintColor: '#2196f3',
                  drawerInactiveTintColor: '#ccc',
                }}
              >
                <Drawer.Screen name="Positions" component={PositionsScreen} />
                <Drawer.Screen name="Orders" component={OrdersScreen} />
                <Drawer.Screen name="Watchlists" component={WatchlistsScreen} />
                <Drawer.Screen
                  name="SettingsStack"
                  component={SettingsStack}
                  options={{ title: 'Settings' }}
                />
                <Drawer.Screen
                  name="ChartStack"
                  component={ChartStack}
                  options={{ drawerItemStyle: { display: 'none' } }}
                />
              </Drawer.Navigator>
            </NavigationContainer>
          </BackendProvider>
          </ProvisioningGate>
        </AccountProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const gateStyles = StyleSheet.create({
  c: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#1a1a2e',
  },
  t: { color: '#fff', fontSize: 18, marginBottom: 16, textAlign: 'center' },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  err: { color: '#ff6b6b', marginBottom: 12, textAlign: 'center' },
  btn: {
    backgroundColor: '#2196f3',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default App;
