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

import PortfolioScreen from './src/screens/PortfolioScreen';
import ChartScreen from './src/screens/ChartScreen';
import OrderEntryScreen from './src/screens/OrderEntryScreen';
import TradingScreen from './src/screens/TradingScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import { AccountProvider } from './src/AccountContext';
import type { AlpacaOrder } from './src/alpaca';

export type RootStackParamList = {
  Portfolio: undefined;
  Chart: { ticker: string };
  OrderEntry: { accountId?: string; symbol?: string; order?: AlpacaOrder };
};

export type RootDrawerParamList = {
  PortfolioStack: undefined;
  Trading: undefined;
  Accounts: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<RootDrawerParamList>();

const stackScreenOptions = {
  headerStyle: { backgroundColor: '#1a1a2e' },
  headerTintColor: '#ffffff',
  headerTitleStyle: { fontWeight: 'bold' as const },
  contentStyle: { backgroundColor: '#1a1a2e' },
};

function PortfolioStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chart"
        component={ChartScreen}
        options={({ route }) => ({ title: route.params.ticker })}
      />
      <Stack.Screen
        name="OrderEntry"
        component={OrderEntryScreen}
        options={{ title: 'Order' }}
      />
    </Stack.Navigator>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
        <AccountProvider>
          <NavigationContainer>
            <Drawer.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: '#1a1a2e' },
                headerTintColor: '#ffffff',
                drawerStyle: { backgroundColor: '#16213e' },
                drawerActiveTintColor: '#2196f3',
                drawerInactiveTintColor: '#ccc',
              }}
            >
              <Drawer.Screen
                name="PortfolioStack"
                component={PortfolioStack}
                options={{ title: 'Portfolio', headerShown: false }}
              />
            <Drawer.Screen
              name="Trading"
              component={TradingScreen}
              options={{ headerShown: false }}
            />
            <Drawer.Screen
              name="Accounts"
              component={AccountsScreen}
              options={{ headerShown: false }}
            />
            </Drawer.Navigator>
          </NavigationContainer>
        </AccountProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
