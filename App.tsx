/**
 * Stock Portfolio App
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
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
import { AccountProvider } from './src/AccountContext';
import { BackendProvider } from './src/BackendContext';
import type { AlpacaOrder } from './src/alpaca';

// Consumed by the ChartStack (below) — Chart/OrderEntry/Exit routes.
export type RootStackParamList = {
  Chart: { ticker: string };
  OrderEntry: { accountId?: string; symbol?: string; order?: AlpacaOrder };
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

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
        <AccountProvider>
          <BackendProvider poll>
            <NavigationContainer>
              <Drawer.Navigator
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
        </AccountProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
