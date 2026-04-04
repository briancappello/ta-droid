/**
 * Stock Portfolio App
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PortfolioScreen from './src/screens/PortfolioScreen';
import ChartScreen from './src/screens/ChartScreen';

export type RootStackParamList = {
  Portfolio: undefined;
  Chart: { ticker: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#ffffff',
            headerTitleStyle: { fontWeight: 'bold' },
            contentStyle: { backgroundColor: '#1a1a2e' },
          }}
        >
          <Stack.Screen
            name="Portfolio"
            component={PortfolioScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Chart"
            component={ChartScreen}
            options={({ route }) => ({
              title: route.params.ticker,
            })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
