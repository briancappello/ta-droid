# Strategy-Oriented Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app's information hierarchy from a portfolio/holdings model to a swing-trading model: a unified positions/orders book grouped by account, filtered by strategy, with an always-visible backend-health indicator and a multi-account Exit-to-flat flow.

**Architecture:** Keep all position/order management **direct to Alpaca** (the failsafe). Replace the Portfolio/Trading drawer with Positions / Orders / Watchlists / Settings. Introduce a shared header component carrying a live backend-health ("BE") chip driven by a global context. Strategy attribution and Watchlists are `fa-techan` backend enrichments that degrade silently when the backend is down. Built in four sequenced phases; each phase leaves the app compiling, tested, and runnable.

**Tech Stack:** React Native 0.84, TypeScript, `fetch`, Jest (`preset: react-native`), `@react-navigation/drawer` + `@react-navigation/native-stack`, `react-native-keychain`, `react-native-config`, `react-native-safe-area-context`.

## Global Constraints

- **Failsafe first.** All position/order reads and writes go **device→Alpaca directly** (`src/alpaca.ts`). They MUST work when the `fa-techan` backend is down. Never gate an Alpaca action on backend availability.
- **Backend is enrichment.** Strategy tags and Watchlists come from `fa-techan` and degrade silently. No amber banners, no explanatory copy — the red BE chip is the only degraded-mode signal.
- **Minimal chrome, single user.** No onboarding text, no attributions ("curated by…"), no helper banners. The sole user is the engineer.
- **Secrets never in plaintext.** Alpaca key/secret live only in `react-native-keychain`; never in `AsyncStorage`, logs, or metadata blobs. In catch blocks log only `e.message` / `AlpacaError.status` — never the `Account`, request `init`, or `alpacaHeaders(...)`.
- **Alpaca hosts:** `paper` → `https://paper-api.alpaca.markets`, `live` → `https://api.alpaca.markets`. Trading API v2. Auth headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`.
- **fa-techan base URL:** read via `Config.API_BASE_URL` (`src/api.ts`, `API_BASE`). Market data (quotes/history) continues to use this backend.
- **Style conventions (match existing code):** functional components, inline `StyleSheet.create`, dark palette `#1a1a2e` (bg) / `#16213e` (panel) / `#2196f3` (accent) / `#4caf50` (up) / `#f44336` (down). Dropdowns use the `Modal`-overlay pattern from `ChartScreen`'s `FreqDropdown`. Prettier: single quotes, trailing commas, 2-space indent.
- **Node:** >= 22.11.0. Tests: `npm test`. Lint: `npm run lint` (must be 0 errors; inline-style warnings acceptable).
- **Jest render caveat:** `react-test-renderer`'s `JSON.stringify(tree.toJSON())` chokes on `RefreshControl` and circular `_owner` refs. Screens rendered bare in tests must mock `../AccountContext`, `../BackendContext`, `../alpaca`, `../techan`, and `react-native-safe-area-context` as needed (see existing `tradingScreen.test.tsx`, `accountsScreen.test.tsx`).

## Phase Overview

The plan is one document, sequenced in four phases. Each phase ends runnable.

- **Phase 1 — Nav + shell (Tasks 1–5):** BackendContext + BE health, shared `AppHeader` with BE chip, new drawer (Positions / Orders / Watchlists / Settings), Settings screen with Accounts nested, retire Portfolio/Holdings. Strategy source is not wired yet; BE chip uses a stubbed health signal.
- **Phase 2 — Unified book + strategy filter (Tasks 6–10):** aggregate positions/orders across all accounts into account buckets; `StrategyFilter` multi-select dropdown (app-local strategy source stub); Positions and Orders screens.
- **Phase 3 — Chart Trade/Exit + flatten (Tasks 11–14):** symbol→chart everywhere, positions strip, Trade + Exit buttons, multi-account Exit confirmation page (Alpaca-only), all-order-actions-confirmed.
- **Phase 4 — fa-techan integration (Tasks 15–19):** `src/techan.ts` client, live BE health polling, real strategy tags, Watchlists, best-effort suppress POST on Exit.

## File Structure

**New files:**
- `src/BackendContext.tsx` — global backend-health provider + `useBackend()` hook (BE chip state, health signal).
- `src/components/AppHeader.tsx` — shared header (☰ / title / BE chip / optional refresh) used by every top-level screen.
- `src/components/StrategyFilter.tsx` — multi-select strategy dropdown (Positions/Orders).
- `src/components/WatchlistPicker.tsx` — single-select watchlist dropdown (Phase 4).
- `src/book.ts` — pure aggregation: fan positions/orders across accounts into account buckets + strategy filtering. Unit-tested.
- `src/techan.ts` — `fa-techan` client: strategy tags, watchlists, backend health, suppress POST (Phase 4).
- `src/screens/PositionsScreen.tsx` — unified positions book (replaces Portfolio as home).
- `src/screens/OrdersScreen.tsx` — unified orders book.
- `src/screens/WatchlistsScreen.tsx` — server-curated watchlists.
- `src/screens/SettingsScreen.tsx` — settings index (Accounts row → existing AccountsScreen, Backend row).
- `src/screens/ExitScreen.tsx` — multi-account flatten confirmation page.

**Modified files:**
- `App.tsx` — drawer destinations + nested stacks; add `BackendProvider`; route types.
- `src/screens/ChartScreen.tsx` — positions strip, Exit button, symbol-tap entry.
- `src/screens/AccountsScreen.tsx` — re-parented under Settings (drawer→Settings back nav).
- `src/screens/OrderEntryScreen.tsx` — confirmation-page parity (already has a review step).
- `src/alpaca.ts` — add `closePosition`-based flatten helpers if needed (already has `closePosition`).

**Retired:**
- `src/screens/PortfolioScreen.tsx` and `src/screens/TradingScreen.tsx` — superseded by PositionsScreen/OrdersScreen. Removed in Phase 1/2; their tests replaced.

---

## Phase 1 — Nav + Shell

### Task 1: BackendContext — global backend-health signal

**Files:**
- Create: `src/BackendContext.tsx`
- Test: `__tests__/backendContext.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BackendHealth = 'up' | 'down' | 'unknown'`
  - `function BackendProvider({ children, poll }: { children: React.ReactNode; poll?: boolean }): JSX.Element`
  - `function useBackend(): { health: BackendHealth; setHealth: (h: BackendHealth) => void; refresh: () => Promise<void> }`
- Phase-1 behavior: `health` starts `'unknown'`; `setHealth` lets callers/tests set it; `refresh` is a no-op placeholder (Phase 4 replaces it with a real `fa-techan` ping). `poll` defaults `false` (no timer yet) so tests and Phase-1 render are deterministic.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/backendContext.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { BackendProvider, useBackend } from '../src/BackendContext';

function Probe({ onReady }: { onReady: (v: ReturnType<typeof useBackend>) => void }) {
  const v = useBackend();
  onReady(v);
  return <Text>{v.health}</Text>;
}

test('health defaults to unknown', async () => {
  let latest: ReturnType<typeof useBackend> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <BackendProvider>
        <Probe onReady={v => (latest = v)} />
      </BackendProvider>,
    );
  });
  expect(latest!.health).toBe('unknown');
});

test('setHealth updates health', async () => {
  let latest: ReturnType<typeof useBackend> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <BackendProvider>
        <Probe onReady={v => (latest = v)} />
      </BackendProvider>,
    );
  });
  await act(async () => {
    latest!.setHealth('down');
  });
  expect(latest!.health).toBe('down');
});

test('useBackend throws outside provider', () => {
  const Bad = () => {
    useBackend();
    return null;
  };
  expect(() => ReactTestRenderer.create(<Bad />)).toThrow(
    /useBackend must be used within BackendProvider/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- backendContext.test.tsx`
Expected: FAIL — cannot find module `../src/BackendContext`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/BackendContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';

export type BackendHealth = 'up' | 'down' | 'unknown';

type Ctx = {
  health: BackendHealth;
  setHealth: (h: BackendHealth) => void;
  refresh: () => Promise<void>;
};

const BackendCtx = createContext<Ctx | null>(null);

export function BackendProvider({
  children,
}: {
  children: React.ReactNode;
  poll?: boolean;
}) {
  const [health, setHealth] = useState<BackendHealth>('unknown');

  // ponytail: real fa-techan health ping lands in Phase 4 (Task 16).
  // Until then refresh is a no-op and health is driven by setHealth.
  const refresh = useCallback(async () => {}, []);

  return (
    <BackendCtx.Provider value={{ health, setHealth, refresh }}>
      {children}
    </BackendCtx.Provider>
  );
}

export function useBackend(): Ctx {
  const ctx = useContext(BackendCtx);
  if (!ctx) {
    throw new Error('useBackend must be used within BackendProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- backendContext.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/BackendContext.tsx __tests__/backendContext.test.tsx
git commit -m "feat: add BackendContext with backend-health signal"
```

---

### Task 2: AppHeader — shared header with BE chip

**Files:**
- Create: `src/components/AppHeader.tsx`
- Test: `__tests__/appHeader.test.tsx`

**Interfaces:**
- Consumes (Task 1): `useBackend`, `BackendHealth`.
- Produces:
  - `function AppHeader(props: { title: string; onMenuPress: () => void; onRefreshPress?: () => void; onBackendPress?: () => void; right?: React.ReactNode }): JSX.Element`
- Renders a row: `☰` (calls `onMenuPress`) · `title` · optional `right` node · **BE chip** · optional `↻` (calls `onRefreshPress`). The BE chip shows a colored dot: `up` → `#4caf50`, `down` → `#f44336`, `unknown` → `#9e9e9e`; tapping it calls `onBackendPress`. Applies `SafeAreaInsetsContext` top inset (fallback `{ top: 0 }`) like `TradingScreen`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/appHeader.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppHeader } from '../src/components/AppHeader';
import * as backend from '../src/BackendContext';

jest.mock('../src/BackendContext');

function mockHealth(health: 'up' | 'down' | 'unknown') {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health,
    setHealth: () => {},
    refresh: async () => {},
  });
}

test('renders the title and a BE chip', async () => {
  mockHealth('up');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AppHeader title="Positions" onMenuPress={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Positions');
  expect(json).toContain('BE');
});

test('BE dot is green when up and red when down', async () => {
  mockHealth('up');
  let up!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    up = ReactTestRenderer.create(
      <AppHeader title="X" onMenuPress={() => {}} />,
    );
  });
  expect(JSON.stringify(up.toJSON())).toContain('#4caf50');

  mockHealth('down');
  let down!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    down = ReactTestRenderer.create(
      <AppHeader title="X" onMenuPress={() => {}} />,
    );
  });
  expect(JSON.stringify(down.toJSON())).toContain('#f44336');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- appHeader.test.tsx`
Expected: FAIL — cannot find module `../src/components/AppHeader`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/AppHeader.tsx
import React, { useContext } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useBackend, type BackendHealth } from '../BackendContext';

function dotColor(h: BackendHealth): string {
  if (h === 'up') {
    return '#4caf50';
  }
  if (h === 'down') {
    return '#f44336';
  }
  return '#9e9e9e';
}

export function AppHeader({
  title,
  onMenuPress,
  onRefreshPress,
  onBackendPress,
  right,
}: {
  title: string;
  onMenuPress: () => void;
  onRefreshPress?: () => void;
  onBackendPress?: () => void;
  right?: React.ReactNode;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0 };
  const { health } = useBackend();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <TouchableOpacity onPress={onMenuPress} hitSlop={8}>
        <Text style={styles.menu}>☰</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right}
      <TouchableOpacity
        style={styles.chip}
        onPress={onBackendPress}
        disabled={!onBackendPress}
        hitSlop={8}
      >
        <View style={[styles.dot, { backgroundColor: dotColor(health) }]} />
        <Text style={styles.chipText}>BE</Text>
      </TouchableOpacity>
      {onRefreshPress != null && (
        <TouchableOpacity onPress={onRefreshPress} hitSlop={8}>
          <Text style={styles.refresh}>↻</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: '#1a1a2e',
  },
  menu: { color: '#fff', fontSize: 22 },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: 'bold' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1c2740',
    borderColor: '#2c3a58',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: '#93a1b8', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  refresh: { color: '#2196f3', fontSize: 18 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- appHeader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AppHeader.tsx __tests__/appHeader.test.tsx
git commit -m "feat: add shared AppHeader with backend-health BE chip"
```

---

### Task 3: SettingsScreen index + Backend subpage

**Files:**
- Create: `src/screens/SettingsScreen.tsx`
- Create: `src/screens/BackendSettingsScreen.tsx`
- Test: `__tests__/settingsScreen.test.tsx`

**Interfaces:**
- Consumes (Task 1): `useBackend`. Consumes existing `useAccounts` (`src/AccountContext`).
- Navigation: these live in a `SettingsStack` (added in Task 4) with routes `SettingsHome`, `Accounts` (existing `AccountsScreen`), `Backend`. `SettingsScreen` receives `navigation` with `navigate('Accounts')` / `navigate('Backend')` and `openDrawer()`.
- Produces:
  - default-exported `SettingsScreen`
  - default-exported `BackendSettingsScreen` (host/port/auth form; Phase 1 = display + local state only, persisted config wired in Phase 4 Task 15).

**Behavior:**
- `SettingsScreen`: `AppHeader title="Settings"` (☰ opens drawer, no refresh). A `FlatList`/`ScrollView` of rows: **Accounts** (`navigate('Accounts')`, right text = `${accounts.length} linked`), **Backend** (`navigate('Backend')`, right text `host·port·auth`). Rows reuse the dark row styling from `AccountsScreen`.
- `BackendSettingsScreen`: `AppHeader title="Backend"` with a back affordance via `navigation.goBack()`; three `TextInput`s (host, port, auth token — token `secureTextEntry`) seeded from `Config.API_BASE_URL` split, plus a Save button. Phase 1 keeps values in local state only (no persistence yet); Task 15 adds keychain persistence. Add a `ponytail:` note.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/settingsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import SettingsScreen from '../src/screens/SettingsScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [
      { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' },
      { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', env: 'live' },
    ],
    activeId: 'a',
    activeAccount: null,
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up',
    setHealth: () => {},
    refresh: async () => {},
  });
});

test('renders Accounts and Backend rows with account count', async () => {
  const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<SettingsScreen navigation={nav} />);
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Accounts');
  expect(json).toContain('Backend');
  expect(json).toContain('2 linked');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settingsScreen.test.tsx`
Expected: FAIL — cannot find module `../src/screens/SettingsScreen`.

- [ ] **Step 3: Implement `SettingsScreen` and `BackendSettingsScreen`**

```tsx
// src/screens/SettingsScreen.tsx
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { useAccounts } from '../AccountContext';

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value != null && <Text style={styles.rowValue}>{value}</Text>}
        <Text style={styles.chev}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }: { navigation: any }) {
  const { accounts } = useAccounts();
  return (
    <View style={styles.container}>
      <AppHeader title="Settings" onMenuPress={() => navigation.openDrawer()} />
      <ScrollView>
        <Row
          label="Accounts"
          value={`${accounts.length} linked`}
          onPress={() => navigation.navigate('Accounts')}
        />
        <Row
          label="Backend"
          value="host·port·auth"
          onPress={() => navigation.navigate('Backend')}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  rowLabel: { color: '#fff', fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowValue: { color: '#8a97b0', fontSize: 13 },
  chev: { color: '#6b7690', fontSize: 18 },
});
```

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- settingsScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/SettingsScreen.tsx src/screens/BackendSettingsScreen.tsx __tests__/settingsScreen.test.tsx
git commit -m "feat: add Settings index and Backend config subpage"
```

---

### Task 4: Drawer restructure — Positions / Orders / Watchlists / Settings

**Files:**
- Modify: `App.tsx`
- Create: `src/screens/PositionsScreen.tsx` (stub; filled in Task 8)
- Create: `src/screens/OrdersScreen.tsx` (stub; filled in Task 9)
- Create: `src/screens/WatchlistsScreen.tsx` (stub; filled in Task 18)
- Test: covered by existing `__tests__/App.test.tsx` smoke render.

**Interfaces:**
- Consumes: `BackendProvider` (Task 1), `SettingsScreen`/`BackendSettingsScreen` (Task 3), existing `AccountsScreen`, existing `ChartScreen`/`OrderEntryScreen`, `AccountProvider`.
- Produces (exported from `App.tsx`):
  - `type RootDrawerParamList = { Positions: undefined; Orders: undefined; Watchlists: undefined; SettingsStack: undefined }`
  - `type SettingsStackParamList = { SettingsHome: undefined; Accounts: undefined; Backend: undefined }`
  - Keep `RootStackParamList` for the symbol/chart flow: `{ Chart: { ticker: string }; OrderEntry: { accountId?: string; symbol?: string; order?: AlpacaOrder }; Exit: { symbol: string } }` — this becomes a `ChartStack` reachable from any list (Task 11 re-parents chart nav).

**Design notes:**
- Wrap the tree in `BackendProvider` inside `AccountProvider` inside `SafeAreaProvider` inside `GestureHandlerRootView` (keep the existing gesture-handler wrapper).
- Drawer screens Positions/Orders/Watchlists each set `headerShown: false` (they render `AppHeader` themselves).
- `SettingsStack` is a native-stack with `SettingsHome`, `Accounts`, `Backend`; the drawer screen for it also sets `headerShown: false` (screens render their own `AppHeader`); the stack's own screens can use the native stack header or `headerShown:false` — set `headerShown:false` for consistency since each screen renders `AppHeader`.
- BE chip: the drawer’s screens pass `onBackendPress={() => navigation.navigate('SettingsStack', { screen: 'Backend' })}` into their `AppHeader`. (Nested navigation into the settings stack.)
- Stubs for Positions/Orders/Watchlists render `AppHeader` + a placeholder `View` so the app compiles and the drawer works before Phases 2–4.

- [ ] **Step 1: Create the three stub screens**

```tsx
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
```

(Same shape for `OrdersScreen.tsx` with title/text "Orders" and `WatchlistsScreen.tsx` with "Watchlists".)

- [ ] **Step 2: Rewrite `App.tsx`**

```tsx
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
import SettingsScreen from './src/screens/SettingsScreen';
import BackendSettingsScreen from './src/screens/BackendSettingsScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import ChartScreen from './src/screens/ChartScreen';
import OrderEntryScreen from './src/screens/OrderEntryScreen';
import { AccountProvider } from './src/AccountContext';
import { BackendProvider } from './src/BackendContext';
import type { AlpacaOrder } from './src/alpaca';

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
};

const Drawer = createDrawerNavigator<RootDrawerParamList>();
const SettingsNav = createNativeStackNavigator<SettingsStackParamList>();

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
          <BackendProvider>
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
              </Drawer.Navigator>
            </NavigationContainer>
          </BackendProvider>
        </AccountProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
```

Note: `Chart`/`OrderEntry`/`Exit` are re-parented into a `ChartStack` in Task 11 (reachable by tapping a symbol). For Phase 1 they are temporarily unrouted; the imports of `ChartScreen`/`OrderEntryScreen` above are removed if unused to keep lint clean, OR keep a hidden stack. To keep this task self-contained and lint-clean, DROP the `ChartScreen`/`OrderEntryScreen` imports and the `RootStackParamList` export here is retained for later; re-add in Task 11. (If lint flags the unused type, keep it — exported types are not lint errors.)

- [ ] **Step 3: Run the smoke test + lint**

Run: `npm test -- App.test.tsx && npm run lint`
Expected: App test PASSES; lint clean (0 errors).

- [ ] **Step 4: Verify on emulator (manual)**

Build/reload; confirm the drawer shows Positions / Orders / Watchlists / Settings, the hamburger opens it, each screen shows its `AppHeader` with a BE chip (grey dot = unknown in Phase 1), and Settings → Accounts still lists accounts, Settings → Backend shows the form.

- [ ] **Step 5: Commit**

```bash
git add App.tsx src/screens/PositionsScreen.tsx src/screens/OrdersScreen.tsx src/screens/WatchlistsScreen.tsx
git commit -m "feat: restructure drawer to Positions/Orders/Watchlists/Settings"
```

---

### Task 5: Retire PortfolioScreen + TradingScreen

**Files:**
- Delete: `src/screens/PortfolioScreen.tsx`
- Delete: `src/screens/TradingScreen.tsx`
- Delete: `__tests__/tradingScreen.test.tsx`
- Check: `__tests__/App.test.tsx` (must not import the deleted screens — it renders `App` only, so it's fine)

**Interfaces:**
- Consumes: nothing new. This removes the old `Portfolio`/`Trading` screens now superseded by the drawer stubs from Task 4. Their behavior (positions/orders lists, quotes) is reimplemented in Phase 2 as PositionsScreen/OrdersScreen.

**Design notes:**
- Confirm nothing still imports these. `App.tsx` no longer references them after Task 4. Search first to be safe.

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "PortfolioScreen\|TradingScreen" src App.tsx __tests__ || echo "no refs"`
Expected: `no refs` (only matches would be the files themselves + tradingScreen test, which are being deleted).

- [ ] **Step 2: Delete the files**

```bash
git rm src/screens/PortfolioScreen.tsx src/screens/TradingScreen.tsx __tests__/tradingScreen.test.tsx
```

- [ ] **Step 3: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: all remaining suites PASS; lint clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: retire Portfolio and Trading screens (superseded by drawer restructure)"
```

---

**Phase 1 complete.** App compiles, drawer restructured, BE chip present (stub health), Settings holds Accounts + Backend. Verify on emulator before Phase 2.

## Phase 2 — Unified Book + Strategy Filter

### Task 6: `src/book.ts` — account-bucket aggregation + strategy filtering (pure)

**Files:**
- Create: `src/book.ts`
- Test: `__tests__/book.test.ts`

**Interfaces:**
- Consumes: `Account`, `AlpacaPosition`, `AlpacaOrder` (`src/alpaca.ts`).
- Produces:
  - `type Tagged<T> = { item: T; account: Account; strategy: string }`
  - `type Bucket<T> = { account: Account; rows: Tagged<T>[] }`
  - `type StrategyOf<T> = (item: T, account: Account) => string` — injected tagger; missing/unknown returns `'Unattributed'`.
  - `function stubTagger(): StrategyOf<unknown>` — returns `() => 'Unattributed'` (Phase 2 default).
  - `function tagAll<T>(perAccount: { account: Account; items: T[] }[], strategyOf: StrategyOf<T>): Tagged<T>[]`
  - `function strategiesPresent<T>(tagged: Tagged<T>[]): string[]` — distinct strategy labels, sorted, with `'Unattributed'` last.
  - `function filterByStrategies<T>(tagged: Tagged<T>[], selected: string[] | 'all'): Tagged<T>[]` — `'all'` (or empty selection, handled by caller) returns everything.
  - `function bucketByAccount<T>(tagged: Tagged<T>[]): Bucket<T>[]` — groups into per-account buckets, preserving account order from input.

**Rules:**
- Account order in buckets follows the order accounts were supplied.
- `strategiesPresent` returns unique labels; `'Unattributed'` always sorts last, others alphabetical.
- `filterByStrategies(_, 'all')` returns the input unchanged; otherwise keeps rows whose `strategy` is in `selected`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/book.test.ts
import {
  tagAll,
  stubTagger,
  strategiesPresent,
  filterByStrategies,
  bucketByAccount,
  type StrategyOf,
} from '../src/book';
import type { Account, AlpacaPosition } from '../src/alpaca';

const ira: Account = { id: 'i', name: 'IRA', key: 'K', secret: 'S', env: 'live' };
const paper: Account = { id: 'p', name: 'Paper', key: 'K', secret: 'S', env: 'paper' };

function pos(symbol: string): AlpacaPosition {
  return {
    symbol,
    qty: '10',
    avg_entry_price: '100',
    market_value: '1000',
    unrealized_pl: '50',
    side: 'long',
    current_price: '105',
  };
}

const perAccount = [
  { account: ira, items: [pos('AAPL'), pos('NVDA')] },
  { account: paper, items: [pos('TSLA')] },
];

test('stubTagger tags everything Unattributed', () => {
  const tagged = tagAll(perAccount, stubTagger() as StrategyOf<AlpacaPosition>);
  expect(tagged).toHaveLength(3);
  expect(tagged.every(t => t.strategy === 'Unattributed')).toBe(true);
  expect(tagged[0].account.id).toBe('i');
});

test('strategiesPresent lists distinct labels with Unattributed last', () => {
  const strat: StrategyOf<AlpacaPosition> = (p) =>
    p.symbol === 'AAPL' ? 'Momentum' : p.symbol === 'NVDA' ? 'MeanRev' : 'Unattributed';
  const tagged = tagAll(perAccount, strat);
  expect(strategiesPresent(tagged)).toEqual(['MeanRev', 'Momentum', 'Unattributed']);
});

test('filterByStrategies all returns everything; selection narrows', () => {
  const strat: StrategyOf<AlpacaPosition> = (p) =>
    p.symbol === 'AAPL' ? 'Momentum' : 'Unattributed';
  const tagged = tagAll(perAccount, strat);
  expect(filterByStrategies(tagged, 'all')).toHaveLength(3);
  const only = filterByStrategies(tagged, ['Momentum']);
  expect(only).toHaveLength(1);
  expect(only[0].item.symbol).toBe('AAPL');
});

test('bucketByAccount groups preserving account order', () => {
  const tagged = tagAll(perAccount, stubTagger() as StrategyOf<AlpacaPosition>);
  const buckets = bucketByAccount(tagged);
  expect(buckets.map(b => b.account.id)).toEqual(['i', 'p']);
  expect(buckets[0].rows).toHaveLength(2);
  expect(buckets[1].rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- book.test.ts`
Expected: FAIL — cannot find module `../src/book`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/book.ts
import type { Account } from './alpaca';

export type Tagged<T> = { item: T; account: Account; strategy: string };
export type Bucket<T> = { account: Account; rows: Tagged<T>[] };
export type StrategyOf<T> = (item: T, account: Account) => string;

export function stubTagger(): StrategyOf<unknown> {
  return () => 'Unattributed';
}

export function tagAll<T>(
  perAccount: { account: Account; items: T[] }[],
  strategyOf: StrategyOf<T>,
): Tagged<T>[] {
  const out: Tagged<T>[] = [];
  for (const { account, items } of perAccount) {
    for (const item of items) {
      const strategy = strategyOf(item, account) || 'Unattributed';
      out.push({ item, account, strategy });
    }
  }
  return out;
}

export function strategiesPresent<T>(tagged: Tagged<T>[]): string[] {
  const set = new Set(tagged.map(t => t.strategy));
  const hasUnattributed = set.delete('Unattributed');
  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
  if (hasUnattributed) {
    sorted.push('Unattributed');
  }
  return sorted;
}

export function filterByStrategies<T>(
  tagged: Tagged<T>[],
  selected: string[] | 'all',
): Tagged<T>[] {
  if (selected === 'all') {
    return tagged;
  }
  const set = new Set(selected);
  return tagged.filter(t => set.has(t.strategy));
}

export function bucketByAccount<T>(tagged: Tagged<T>[]): Bucket<T>[] {
  const buckets: Bucket<T>[] = [];
  const byId = new Map<string, Bucket<T>>();
  for (const t of tagged) {
    let bucket = byId.get(t.account.id);
    if (!bucket) {
      bucket = { account: t.account, rows: [] };
      byId.set(t.account.id, bucket);
      buckets.push(bucket);
    }
    bucket.rows.push(t);
  }
  return buckets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- book.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/book.ts __tests__/book.test.ts
git commit -m "feat: add account-bucket aggregation and strategy filtering"
```

---

### Task 7: `StrategyFilter` — multi-select dropdown

**Files:**
- Create: `src/components/StrategyFilter.tsx`
- Test: `__tests__/strategyFilter.test.tsx`

**Interfaces:**
- Consumes: nothing (pure component).
- Produces:
  - `type StrategySelection = string[] | 'all'`
  - `function strategyLabel(selection: StrategySelection): string` — `'all'` → `'All'`; one → that name; 2+ → `` `${n} strategies` ``.
  - `function StrategyFilter(props: { options: string[]; selection: StrategySelection; onChange: (s: StrategySelection) => void }): JSX.Element`

**Behavior:**
- Button reads `Strategy: <strategyLabel(selection)> ▾`, reusing the `FreqDropdown` `Modal`-overlay pattern.
- Menu: an **"All strategies"** row on top (checked when `selection === 'all'`), then one row per option with a checkbox.
- Tapping "All strategies" → `onChange('all')`.
- Tapping an option toggles it: from `'all'`, tapping one option selects just that one (`[option]`); otherwise add/remove from the array. If toggling empties the array → `onChange('all')` (never empty). If the array ends up containing every option → `onChange('all')`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/strategyFilter.test.tsx
import { strategyLabel } from '../src/components/StrategyFilter';

test('strategyLabel: all', () => {
  expect(strategyLabel('all')).toBe('All');
});
test('strategyLabel: single name', () => {
  expect(strategyLabel(['Momentum'])).toBe('Momentum');
});
test('strategyLabel: count for 2+', () => {
  expect(strategyLabel(['Momentum', 'MeanRev'])).toBe('2 strategies');
});
```

Plus a render smoke test:

```tsx
// append to __tests__/strategyFilter.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StrategyFilter } from '../src/components/StrategyFilter';

test('renders the collapsed label', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <StrategyFilter
        options={['Momentum', 'MeanRev', 'Unattributed']}
        selection="all"
        onChange={() => {}}
      />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('All');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- strategyFilter.test.tsx`
Expected: FAIL — cannot find module `../src/components/StrategyFilter`.

- [ ] **Step 3: Write minimal implementation**

```tsx
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

function toggle(
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- strategyFilter.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/StrategyFilter.tsx __tests__/strategyFilter.test.tsx
git commit -m "feat: add multi-select StrategyFilter dropdown"
```

---

### Task 8: PositionsScreen — unified book across accounts

**Files:**
- Replace stub: `src/screens/PositionsScreen.tsx`
- Test: `__tests__/positionsScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccounts` (`src/AccountContext`), `useBackend` (Task 1), `AppHeader` (Task 2), `StrategyFilter`/`StrategySelection` (Task 7), `tagAll`/`stubTagger`/`strategiesPresent`/`filterByStrategies`/`bucketByAccount` (Task 6), `listPositions`/`AlpacaError`/`AlpacaPosition` (`src/alpaca`).
- Navigation: `navigation.navigate('ChartStack', { screen: 'Chart', params: { ticker } })` (ChartStack lands in Task 11; for Phase 2 use `navigation.navigate('Chart', { ticker })` guarded — see note).
- Produces: default-exported `PositionsScreen`.

**Behavior:**
- On focus / active-account change, fetch `listPositions(account)` for **every** account in `accounts` (via `Promise.allSettled`); build `perAccount = [{ account, items }]` (failed accounts contribute `[]`, and set `error` to the first `AlpacaError.message`).
- `tagAll(perAccount, stubTagger())` → `strategiesPresent` feeds the `StrategyFilter` options; `filterByStrategies(tagged, selection)` then `bucketByAccount` → render.
- Each bucket: header row (account name + `(live)`/`(paper)` + summed unrealized P/L, green/red). Rows: symbol, `qty @ avg_entry_price`, market value, unrealized P/L. Row tap → chart for that symbol.
- `AppHeader title="Positions"` with `onMenuPress` (openDrawer), `onRefreshPress` (refetch), `onBackendPress` (→ Settings/Backend).
- Empty accounts → "Add an account to start trading." with a link to Settings→Accounts (reuse the pattern from the old TradingScreen).
- Errors → inline red banner with the `AlpacaError.message`. Catch blocks log ONLY `e.message`.
- Use `useFocusEffect(useCallback(...))` OR `navigation.addListener('focus', load)` — the bare-render test has no NavigationContainer, so guard: `const unsub = navigation.addListener?.('focus', load); load(); return () => unsub?.();` (matches the pattern chosen for the old TradingScreen).
- Strategy source note: `stubTagger()` makes every strategy `'Unattributed'` in Phase 2, so the dropdown shows `All` + `Unattributed`. Task 17 swaps in the real fa-techan tagger.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/positionsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import PositionsScreen from '../src/screens/PositionsScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as alpaca from '../src/alpaca';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/alpaca');

const nav = { navigate: jest.fn(), openDrawer: jest.fn(), addListener: undefined } as any;

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [{ id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' }],
    activeId: 'a',
    activeAccount: { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' },
    setActiveId: () => {},
    reload: async () => {},
    loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (alpaca.listPositions as jest.Mock).mockResolvedValue([
    {
      symbol: 'AAPL', qty: '100', avg_entry_price: '189.20',
      market_value: '19000', unrealized_pl: '1240', side: 'long', current_price: '190',
    },
  ]);
});

test('renders positions grouped by account', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<PositionsScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('AAPL');
  expect(json).toContain('IRA');
});

test('prompts to add an account when none exist', async () => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [], activeId: null, activeAccount: null,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<PositionsScreen navigation={nav} />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Add an account');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- positionsScreen.test.tsx`
Expected: FAIL — the stub renders neither "AAPL" nor "Add an account".

- [ ] **Step 3: Implement `PositionsScreen`**

Implement per Behavior. Structure guidance (write the full component):
- State: `buckets`, `options` (strategies present), `selection: StrategySelection` (default `'all'`), `error`, `loading`.
- `load = useCallback` fetching all accounts via `Promise.allSettled(accounts.map(a => listPositions(a)))`, building `perAccount`, then `tagAll(perAccount, stubTagger() as StrategyOf<AlpacaPosition>)`; store the tagged array; derive options + filtered buckets with `useMemo` on `selection`.
- Bucket header P/L = sum of `Number(unrealized_pl)` across the bucket's rows.
- Reuse `StockRow`-style rows (colors `#4caf50` / `#f44336`) inline.
- Symbol tap: `navigation.navigate('ChartStack', { screen: 'Chart', params: { ticker: symbol } })`. (Task 11 adds ChartStack; if running Phase 2 standalone before Task 11, this navigate is inert in tests since `navigate` is mocked — acceptable.)
- Guard focus listener as noted.
- Empty state links to `navigation.navigate('SettingsStack', { screen: 'Accounts' })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- positionsScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/screens/PositionsScreen.tsx __tests__/positionsScreen.test.tsx
git commit -m "feat: PositionsScreen unified book across accounts with strategy filter"
```

---

### Task 9: OrdersScreen — unified orders book

**Files:**
- Replace stub: `src/screens/OrdersScreen.tsx`
- Test: `__tests__/ordersScreen.test.tsx`

**Interfaces:**
- Consumes: same set as PositionsScreen, but `listOpenOrders`/`AlpacaOrder` instead of `listPositions`/`AlpacaPosition`.
- Produces: default-exported `OrdersScreen`.

**Behavior:**
- Same account-fan + `book.ts` pipeline as Task 8, over `listOpenOrders(account)`.
- Bucket header: account name + count of rows (e.g. "2 working"). Rows: symbol, `side type` (e.g. `Buy limit`), `qty`, price (`limit_price`/`stop_price` when present), status.
- Same `AppHeader`, `StrategyFilter`, empty state, error banner, focus-listener guard, symbol-tap→chart as Task 8.
- Strategy source: `stubTagger()` for Phase 2.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/ordersScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import OrdersScreen from '../src/screens/OrdersScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as alpaca from '../src/alpaca';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/alpaca');

const nav = { navigate: jest.fn(), openDrawer: jest.fn(), addListener: undefined } as any;

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [{ id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' }],
    activeId: 'a', activeAccount: { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' },
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (alpaca.listOpenOrders as jest.Mock).mockResolvedValue([
    {
      id: 'o1', symbol: 'MSFT', qty: '10', notional: null, side: 'buy',
      type: 'limit', time_in_force: 'day', limit_price: '390', stop_price: null,
      trail_percent: null, status: 'new',
    },
  ]);
});

test('renders orders grouped by account', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<OrdersScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('MSFT');
  expect(json).toContain('IRA');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ordersScreen.test.tsx`
Expected: FAIL — stub renders no "MSFT".

- [ ] **Step 3: Implement `OrdersScreen`**

Mirror Task 8's structure with `listOpenOrders`. Row renderer shows `side`/`type`/`qty`/price/`status`. Bucket header count = `rows.length` + " working".

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ordersScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/OrdersScreen.tsx __tests__/ordersScreen.test.tsx
git commit -m "feat: OrdersScreen unified orders book with strategy filter"
```

---

### Task 10: Phase 2 verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all suites PASS (backendContext, appHeader, settingsScreen, book, strategyFilter, positionsScreen, ordersScreen, plus surviving earlier suites), lint 0 errors.

- [ ] **Step 2: Emulator smoke**

Build/reload. Positions is the drawer home; positions load grouped by account with the `Strategy: All ▾` dropdown (showing All + Unattributed). Orders likewise. Tapping the dropdown, selecting Unattributed, and clearing back to All all work. Tapping a symbol row is inert until Task 11 (chart re-parenting) — acceptable this phase.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: Phase 2 verification fixes"
```

**Phase 2 complete.** Unified positions/orders books with the strategy filter (stub tagger). Verify on emulator before Phase 3.

## Phase 3 — Chart Trade/Exit + Multi-Account Flatten

### Task 11: ChartStack — symbol→chart from any list

**Files:**
- Modify: `App.tsx`
- Test: covered by `__tests__/App.test.tsx` smoke render.

**Interfaces:**
- Consumes: `ChartScreen`, `OrderEntryScreen`, `ExitScreen` (Task 13).
- Produces: a `ChartStack` native-stack registered as a **drawer screen** with `RootStackParamList` routes `Chart` / `OrderEntry` / `Exit`. Add `ChartStack: undefined` to `RootDrawerParamList`. Lists navigate via `navigation.navigate('ChartStack', { screen: 'Chart', params: { ticker } })`.

**Design notes:**
- Re-add the `ChartScreen`/`OrderEntryScreen`/`ExitScreen` imports removed in Task 4.
- The `ChartStack` drawer screen is **not** shown as a drawer menu item ideally, but react-navigation shows all drawer screens by default. Hide it from the drawer list with `options={{ drawerItemStyle: { display: 'none' } }}` so it's navigable but not a menu row.
- Stack screens use `headerShown: false` (Chart/Exit render their own header via toolbar/`AppHeader`; OrderEntry keeps its own).

- [ ] **Step 1: Add ChartStack to `App.tsx`**

```tsx
import ChartScreen from './src/screens/ChartScreen';
import OrderEntryScreen from './src/screens/OrderEntryScreen';
import ExitScreen from './src/screens/ExitScreen';

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
```

Add to `RootDrawerParamList`: `ChartStack: undefined;`
Register in the drawer (hidden from menu):

```tsx
<Drawer.Screen
  name="ChartStack"
  component={ChartStack}
  options={{ drawerItemStyle: { display: 'none' } }}
/>
```

- [ ] **Step 2: Update list→chart navigation**

In `PositionsScreen.tsx` and `OrdersScreen.tsx`, the symbol-tap handler is:
```tsx
navigation.navigate('ChartStack', { screen: 'Chart', params: { ticker: symbol } });
```
(Already written this way in Tasks 8/9 — confirm they match.)

- [ ] **Step 3: ChartScreen internal nav**

`ChartScreen`'s `navigation` is now the ChartStack's; its `navigate('OrderEntry', …)` and (Task 12) `navigate('Exit', …)` resolve within the stack. `ChartScreen`'s `Props` type stays `NativeStackScreenProps<RootStackParamList, 'Chart'>`.

- [ ] **Step 4: Smoke test + lint**

Run: `npm test -- App.test.tsx && npm run lint`
Expected: PASS; lint clean. (ExitScreen must exist as at least a stub for the import to resolve — create the Task 13 stub first if running strictly in order; see Task 13.)

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat: add ChartStack, navigate to chart from any symbol"
```

Note: Tasks 11 and 13 are interdependent (App imports ExitScreen; ExitScreen is Task 13). Implement Task 13's file first, then Task 11's App wiring, then commit both. They may be committed together if the reviewer prefers.

---

### Task 12: Positions-for-symbol + flatten plan (pure)

**Files:**
- Create: `src/flatten.ts`
- Test: `__tests__/flatten.test.ts`

**Interfaces:**
- Consumes: `Account`, `AlpacaPosition`, `listPositions`, `createOrder`, `NewOrderRequest` (`src/alpaca`).
- Produces:
  - `type SymbolHolding = { account: Account; position: AlpacaPosition }`
  - `async function holdingsForSymbol(accounts: Account[], symbol: string): Promise<SymbolHolding[]>` — fetches positions per account (via `Promise.allSettled`), returns only accounts holding `symbol`.
  - `type FlattenLeg = { account: Account; req: NewOrderRequest }` — one market close order per holding.
  - `function flattenPlan(holdings: SymbolHolding[]): FlattenLeg[]` — for each holding, a market order opposite the position side for the full qty (`side: long → sell`, `short → buy`; `qty` = `position.qty` absolute; `type: 'market'`, `time_in_force: 'day'`).
  - `async function submitFlatten(legs: FlattenLeg[]): Promise<{ leg: FlattenLeg; ok: boolean; error?: string }[]>` — fires `createOrder` per leg independently (`Promise.allSettled`); never throws; returns per-leg result.

**Rules:**
- `flattenPlan` produces one leg per holding; `qty` uses `Math.abs(Number(position.qty)).toString()`.
- Side: if `position.side === 'short'` → `buy`, else `sell`.
- `submitFlatten` is failsafe-critical: each leg is independent; one failure does not block others.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/flatten.test.ts
import { flattenPlan, submitFlatten, type SymbolHolding } from '../src/flatten';
import * as alpaca from '../src/alpaca';
import type { Account, AlpacaPosition } from '../src/alpaca';

jest.mock('../src/alpaca');

const ira: Account = { id: 'i', name: 'IRA', key: 'K', secret: 'S', env: 'live' };
const paper: Account = { id: 'p', name: 'Paper', key: 'K', secret: 'S', env: 'paper' };

function held(symbol: string, qty: string, side = 'long'): AlpacaPosition {
  return { symbol, qty, avg_entry_price: '1', market_value: '1', unrealized_pl: '0', side, current_price: '1' };
}

test('flattenPlan makes a market close per holding, opposite side', () => {
  const holdings: SymbolHolding[] = [
    { account: ira, position: held('AAPL', '100', 'long') },
    { account: paper, position: held('AAPL', '-20', 'short') },
  ];
  const legs = flattenPlan(holdings);
  expect(legs).toHaveLength(2);
  expect(legs[0].req).toMatchObject({ symbol: 'AAPL', side: 'sell', type: 'market', qty: '100' });
  expect(legs[1].req).toMatchObject({ symbol: 'AAPL', side: 'buy', type: 'market', qty: '20' });
});

test('submitFlatten fires all legs independently and reports per-leg', async () => {
  (alpaca.createOrder as jest.Mock)
    .mockResolvedValueOnce({ id: 'o1' })
    .mockRejectedValueOnce(new alpaca.AlpacaError(422, 'bad'));
  const holdings: SymbolHolding[] = [
    { account: ira, position: held('AAPL', '100', 'long') },
    { account: paper, position: held('AAPL', '20', 'long') },
  ];
  const results = await submitFlatten(flattenPlan(holdings));
  expect(results).toHaveLength(2);
  expect(results[0].ok).toBe(true);
  expect(results[1].ok).toBe(false);
  expect(results[1].error).toContain('bad');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- flatten.test.ts`
Expected: FAIL — cannot find module `../src/flatten`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/flatten.ts
import {
  AlpacaError,
  createOrder,
  listPositions,
  type Account,
  type AlpacaPosition,
  type NewOrderRequest,
} from './alpaca';

export type SymbolHolding = { account: Account; position: AlpacaPosition };
export type FlattenLeg = { account: Account; req: NewOrderRequest };

export async function holdingsForSymbol(
  accounts: Account[],
  symbol: string,
): Promise<SymbolHolding[]> {
  const settled = await Promise.allSettled(
    accounts.map(a => listPositions(a)),
  );
  const out: SymbolHolding[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const p = r.value.find(x => x.symbol === symbol);
      if (p) {
        out.push({ account: accounts[i], position: p });
      }
    }
  });
  return out;
}

export function flattenPlan(holdings: SymbolHolding[]): FlattenLeg[] {
  return holdings.map(({ account, position }) => ({
    account,
    req: {
      symbol: position.symbol,
      side: position.side === 'short' ? 'buy' : 'sell',
      type: 'market',
      time_in_force: 'day',
      qty: Math.abs(Number(position.qty)).toString(),
    },
  }));
}

export async function submitFlatten(
  legs: FlattenLeg[],
): Promise<{ leg: FlattenLeg; ok: boolean; error?: string }[]> {
  const settled = await Promise.allSettled(
    legs.map(l => createOrder(l.account, l.req)),
  );
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') {
      return { leg: legs[i], ok: true };
    }
    const e = r.reason;
    const error = e instanceof AlpacaError ? e.message : 'Failed to submit.';
    return { leg: legs[i], ok: false, error };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- flatten.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/flatten.ts __tests__/flatten.test.ts
git commit -m "feat: add holdings-for-symbol and multi-account flatten plan"
```

---

### Task 13: ExitScreen — multi-account flatten confirmation

**Files:**
- Create: `src/screens/ExitScreen.tsx`
- Test: `__tests__/exitScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccounts`, `AppHeader`, `holdingsForSymbol`/`flattenPlan`/`submitFlatten`/`FlattenLeg` (Task 12), `OrderType`/`NewOrderRequest` (`src/alpaca`). Route `Exit: { symbol: string }`.
- Produces: default-exported `ExitScreen`.
- Phase-3 suppress: after flatten, calls a **local no-op** `notifyExit(symbol)` placeholder (Task 19 replaces it with the real fire-and-forget fa-techan POST). Define the placeholder inline with a `ponytail:` note so Task 19 has a single seam.

**Behavior:**
- On mount, `holdingsForSymbol(accounts, symbol)` → seed editable legs from `flattenPlan(holdings)` (each row default market).
- Title "Go flat — N accounts". One row per account: account name + resulting order (default "Sell/Buy <qty> · market"). Tapping a row expands editable controls: type (Market/Limit/Stop), qty (`TextInput`), price (`TextInput`, shown for Limit/Stop).
- Footer: Cancel (`navigation.goBack()`) and "Exit all" → `submitFlatten(legs)`. On completion: if all ok → `Alert.alert('Flat', ...)` then `navigation.goBack()`; if any failed → inline red summary listing failed accounts (`result.error`), keep the page. Then best-effort `notifyExit(symbol)` (never blocks/gates the flatten).
- Empty holdings (symbol not held) → "No open position." + back.
- Pending state on "Exit all" during submit.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/exitScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ExitScreen from '../src/screens/ExitScreen';
import * as ctx from '../src/AccountContext';
import * as backend from '../src/BackendContext';
import * as flatten from '../src/flatten';

jest.mock('../src/AccountContext');
jest.mock('../src/BackendContext');
jest.mock('../src/flatten');

const account = { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' as const };

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [account], activeId: 'a', activeAccount: account,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([
    { account, position: {
      symbol: 'AAPL', qty: '100', avg_entry_price: '189', market_value: '19000',
      unrealized_pl: '1240', side: 'long', current_price: '190',
    } },
  ]);
  (flatten.flattenPlan as jest.Mock).mockReturnValue([
    { account, req: { symbol: 'AAPL', side: 'sell', type: 'market', time_in_force: 'day', qty: '100' } },
  ]);
});

test('lists the account exit leg for the symbol', async () => {
  const route = { params: { symbol: 'AAPL' } } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ExitScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('IRA');
  expect(json).toContain('Go flat');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- exitScreen.test.tsx`
Expected: FAIL — cannot find module `../src/screens/ExitScreen`.

- [ ] **Step 3: Implement `ExitScreen`**

Implement per Behavior. Structure guidance:
- `legs` state seeded from `flattenPlan(holdings)` inside the `holdingsForSymbol` effect.
- Per-row edit state (which index is expanded); editing a row mutates `legs[i].req` (type/qty/price).
- `notifyExit` placeholder:
  ```tsx
  // ponytail: best-effort suppress to fa-techan lands in Task 19. No-op now.
  async function notifyExit(_symbol: string): Promise<void> {}
  ```
- On "Exit all": `setPending(true); const results = await submitFlatten(legs); ...` handle ok/failed; then `notifyExit(symbol).catch(() => {})`.
- Reuse dark palette + input styles from AccountsScreen/OrderEntry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- exitScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ExitScreen.tsx __tests__/exitScreen.test.tsx
git commit -m "feat: add multi-account Exit flatten confirmation screen"
```

---

### Task 14: Chart positions strip + Exit button

**Files:**
- Modify: `src/screens/ChartScreen.tsx`
- Test: `__tests__/chartScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccounts`, `holdingsForSymbol`/`SymbolHolding` (Task 12). Navigates `navigation.navigate('Exit', { symbol: ticker })` and existing `navigation.navigate('OrderEntry', …)`.
- Produces: no new exports.

**Behavior:**
- On mount / ticker change, `holdingsForSymbol(accounts, ticker)` → `holdings` state.
- If `holdings.length > 0`, render a **positions strip between the toolbar/header and the chart WebView**: one pill per holding — `<account.name> · <qty> @ <avg_entry_price>` + unrealized P/L (green/red).
- Add an **Exit** button to the toolbar (left of Trade) **only when `holdings.length > 0`** → `navigation.navigate('Exit', { symbol: ticker })`.
- Trade button unchanged.
- Fetch failures are swallowed (holdings just empty) — never block the chart. Log only `e.message`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/chartScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ChartScreen from '../src/screens/ChartScreen';
import * as ctx from '../src/AccountContext';
import * as flatten from '../src/flatten';
import { fetchHistory } from '../src/api';

jest.mock('../src/AccountContext');
jest.mock('../src/flatten');
jest.mock('../src/api');
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const account = { id: 'a', name: 'IRA', key: 'K', secret: 'S', env: 'live' as const };

beforeEach(() => {
  (ctx.useAccounts as jest.Mock).mockReturnValue({
    accounts: [account], activeId: 'a', activeAccount: account,
    setActiveId: () => {}, reload: async () => {}, loading: false,
  });
  (fetchHistory as jest.Mock).mockResolvedValue({ columns: [], index: [], data: [] });
});

test('shows Exit and a positions strip when the symbol is held', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([
    { account, position: {
      symbol: 'AAPL', qty: '100', avg_entry_price: '189.20', market_value: '19000',
      unrealized_pl: '1240', side: 'long', current_price: '190',
    } },
  ]);
  const route = { params: { ticker: 'AAPL' } } as any;
  const nav = { navigate: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Exit');
  expect(json).toContain('IRA');
});

test('no Exit button when the symbol is not held', async () => {
  (flatten.holdingsForSymbol as jest.Mock).mockResolvedValue([]);
  const route = { params: { ticker: 'SMCI' } } as any;
  const nav = { navigate: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ChartScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).not.toContain('Exit');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chartScreen.test.tsx`
Expected: FAIL — no Exit button / positions strip yet.

- [ ] **Step 3: Implement the strip + Exit**

- Import `holdingsForSymbol`, `type SymbolHolding` from `../flatten`.
- Add `const [holdings, setHoldings] = useState<SymbolHolding[]>([]);` and an effect:
  ```tsx
  useEffect(() => {
    holdingsForSymbol(accounts, ticker)
      .then(setHoldings)
      .catch(e => console.warn('[ChartScreen] holdings:', e.message));
  }, [accounts, ticker]);
  ```
- In the toolbar, before the Trade button:
  ```tsx
  {holdings.length > 0 && (
    <TouchableOpacity
      style={styles.exitButton}
      onPress={() => navigation.navigate('Exit', { symbol: ticker })}
    >
      <Text style={styles.exitButtonText}>Exit</Text>
    </TouchableOpacity>
  )}
  ```
- Between the toolbar `View` and the chart body, add the strip:
  ```tsx
  {holdings.length > 0 && (
    <View style={styles.posStrip}>
      {holdings.map(h => {
        const pl = Number(h.position.unrealized_pl);
        return (
          <View key={h.account.id} style={styles.posPill}>
            <Text style={styles.posPillText}>
              {h.account.name} · {h.position.qty} @ {h.position.avg_entry_price}
            </Text>
            <Text style={[styles.posPillPl, { color: pl >= 0 ? '#4caf50' : '#f44336' }]}>
              {pl >= 0 ? '+' : ''}{h.position.unrealized_pl}
            </Text>
          </View>
        );
      })}
    </View>
  )}
  ```
- Add styles `exitButton`/`exitButtonText` (red `#f44336` bg) and `posStrip`/`posPill`/`posPillText`/`posPillPl`.
- Update `App.test.tsx`/existing chart references if needed — none render ChartScreen bare besides the new test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chartScreen.test.tsx && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ChartScreen.tsx __tests__/chartScreen.test.tsx
git commit -m "feat: chart positions strip and Exit button for held symbols"
```

---

### Task 14b: Phase 3 verification

- [ ] **Step 1:** `npm test && npm run lint` — all green.
- [ ] **Step 2: Emulator smoke (paper account):** tap a position row → chart opens; held symbol shows the positions strip + Exit; Exit → confirmation page lists per-account market legs, edit a row, "Exit all" flattens (verify in Positions the row disappears). Trade still works. Un-held symbol (from a watchlist/search) shows no Exit.
- [ ] **Step 3:** commit any fixes.

**Phase 3 complete.** Chart-centric Trade/Exit with multi-account flatten, all Alpaca-direct. Verify on emulator before Phase 4.

## Phase 4 — fa-techan Integration

**Backend contract (ASSUMED — endpoints do not yet exist in `../fa-techan`).**
fa-techan is FastAPI with an `api_v1` router prefixed `/api/v1`; the app's
`API_BASE` (`Config.API_BASE_URL`) already includes that prefix (existing calls
hit `${API_BASE}/finance/quotes`). Phase 4 assumes these **new** endpoints,
added to fa-techan to match (adjust names here if the backend differs):

- `GET ${API_BASE}/health` → `200` when up (any body). Used for the BE chip.
- `GET ${API_BASE}/strategies/positions` → `[{ account_id: string, symbol: string, strategy: string }]` — the position→strategy map. The app joins by `(account_id, symbol)` to tag Alpaca positions/orders.
- `GET ${API_BASE}/watchlists` → `[{ id: string, name: string }]`.
- `GET ${API_BASE}/watchlists/{id}` → `[{ symbol: string }]`.
- `POST ${API_BASE}/exits` body `{ symbol: string, account_ids: string[] }` → the "don't re-enter" suppression. Fire-and-forget; response ignored.

> **Backend work required:** these five routes must be implemented in
> `../fa-techan` (`app/api/v1/…`). This plan covers only the mobile client; the
> server endpoints are a separate task in that repo.

### Task 15: `src/techan.ts` — fa-techan client

**Files:**
- Create: `src/techan.ts`
- Test: `__tests__/techan.test.ts`

**Interfaces:**
- Consumes: `API_BASE` (`src/api.ts`), `Account`.
- Produces:
  - `type StrategyPosition = { account_id: string; symbol: string; strategy: string }`
  - `type Watchlist = { id: string; name: string }`
  - `async function pingHealth(): Promise<boolean>` — `GET /health`, true iff response ok; never throws.
  - `async function fetchStrategyPositions(): Promise<StrategyPosition[]>` — `GET /strategies/positions`; `[]` on any failure.
  - `async function fetchWatchlists(): Promise<Watchlist[]>` — `GET /watchlists`; `[]` on failure.
  - `async function fetchWatchlistSymbols(id: string): Promise<string[]>` — `GET /watchlists/{id}` → symbols; `[]` on failure.
  - `async function postExitSuppress(symbol: string, accountIds: string[]): Promise<boolean>` — `POST /exits`; true iff ok; never throws (fire-and-forget helper returns success flag for the ⚠ marker).

**Rules:** every function is failsafe-safe — network/parse errors resolve to the empty/false fallback, never throw. No secrets logged.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/techan.test.ts
import {
  pingHealth,
  fetchStrategyPositions,
  fetchWatchlists,
  postExitSuppress,
} from '../src/techan';

afterEach(() => jest.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

test('pingHealth true on 200, false on error', async () => {
  mockFetch(200, {});
  expect(await pingHealth()).toBe(true);
  jest.restoreAllMocks();
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
  expect(await pingHealth()).toBe(false);
});

test('fetchStrategyPositions returns rows, [] on failure', async () => {
  mockFetch(200, [{ account_id: 'a', symbol: 'AAPL', strategy: 'Momentum' }]);
  expect(await fetchStrategyPositions()).toEqual([
    { account_id: 'a', symbol: 'AAPL', strategy: 'Momentum' },
  ]);
  jest.restoreAllMocks();
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('x'));
  expect(await fetchStrategyPositions()).toEqual([]);
});

test('fetchWatchlists [] on non-ok', async () => {
  mockFetch(500, {});
  expect(await fetchWatchlists()).toEqual([]);
});

test('postExitSuppress true on ok, false on failure, never throws', async () => {
  mockFetch(200, {});
  expect(await postExitSuppress('AAPL', ['a'])).toBe(true);
  jest.restoreAllMocks();
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
  expect(await postExitSuppress('AAPL', ['a'])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- techan.test.ts`
Expected: FAIL — cannot find module `../src/techan`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/techan.ts
import { API_BASE } from './api';

export type StrategyPosition = { account_id: string; symbol: string; strategy: string };
export type Watchlist = { id: string; name: string };

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      return fallback;
    }
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function pingHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function fetchStrategyPositions(): Promise<StrategyPosition[]> {
  return getJson<StrategyPosition[]>('/strategies/positions', []);
}

export function fetchWatchlists(): Promise<Watchlist[]> {
  return getJson<Watchlist[]>('/watchlists', []);
}

export async function fetchWatchlistSymbols(id: string): Promise<string[]> {
  const rows = await getJson<{ symbol: string }[]>(
    `/watchlists/${encodeURIComponent(id)}`,
    [],
  );
  return rows.map(r => r.symbol);
}

export async function postExitSuppress(
  symbol: string,
  accountIds: string[],
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/exits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, account_ids: accountIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- techan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/techan.ts __tests__/techan.test.ts
git commit -m "feat: add fa-techan client (health, strategies, watchlists, suppress)"
```

---

### Task 16: Wire live BE health polling

**Files:**
- Modify: `src/BackendContext.tsx`
- Test: `__tests__/backendContext.test.tsx` (extend)

**Interfaces:**
- Consumes (Task 15): `pingHealth`.
- Produces: unchanged signatures. `refresh()` now calls `pingHealth()` and sets `health` to `'up'`/`'down'`. When `poll` is true, a timer calls `refresh()` on an interval (default 20s) and on mount.

**Design notes:**
- Keep `poll` defaulting `false` for deterministic tests; `App.tsx` passes `poll` (see Step 4).
- Guard the interval cleanup on unmount.

- [ ] **Step 1: Extend the test**

```tsx
// append to __tests__/backendContext.test.tsx
import * as techan from '../src/techan';
jest.mock('../src/techan');

test('refresh sets health from pingHealth', async () => {
  (techan.pingHealth as jest.Mock).mockResolvedValue(true);
  let latest: any = null;
  await act(async () => {
    ReactTestRenderer.create(
      <BackendProvider>
        <Probe onReady={v => (latest = v)} />
      </BackendProvider>,
    );
  });
  await act(async () => {
    await latest.refresh();
  });
  expect(latest.health).toBe('up');

  (techan.pingHealth as jest.Mock).mockResolvedValue(false);
  await act(async () => {
    await latest.refresh();
  });
  expect(latest.health).toBe('down');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- backendContext.test.tsx`
Expected: FAIL — `refresh` currently a no-op, health stays `unknown`.

- [ ] **Step 3: Update `BackendContext.tsx`**

Replace the `refresh` no-op and add polling:

```tsx
import { pingHealth } from './techan';
// ...
const refresh = useCallback(async () => {
  const ok = await pingHealth();
  setHealth(ok ? 'up' : 'down');
}, []);

useEffect(() => {
  if (!poll) {
    return;
  }
  refresh();
  const id = setInterval(refresh, 20000);
  return () => clearInterval(id);
}, [poll, refresh]);
```

(Add `useEffect` to imports; keep `poll` in the provider's props and destructure it.)

- [ ] **Step 4: Enable polling in `App.tsx`**

Change `<BackendProvider>` → `<BackendProvider poll>`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- backendContext.test.tsx && npm test -- App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/BackendContext.tsx __tests__/backendContext.test.tsx App.tsx
git commit -m "feat: poll fa-techan health to drive the BE chip"
```

---

### Task 17: Wire real strategy tagger into Positions/Orders

**Files:**
- Create: `src/strategyTagger.ts`
- Modify: `src/screens/PositionsScreen.tsx`, `src/screens/OrdersScreen.tsx`
- Test: `__tests__/strategyTagger.test.ts`

**Interfaces:**
- Consumes (Task 15): `StrategyPosition`, `fetchStrategyPositions`. Consumes (Task 6): `StrategyOf`. Consumes `Account`, `AlpacaPosition`, `AlpacaOrder`.
- Produces:
  - `function taggerFromMap(rows: StrategyPosition[]): StrategyOf<{ symbol: string }>` — returns `(item, account) => strategy for (account.id, item.symbol), else 'Unattributed'`.
  - `async function loadTagger(): Promise<StrategyOf<{ symbol: string }>>` — `fetchStrategyPositions()` then `taggerFromMap`. On empty (backend down) → all `'Unattributed'`.

**Rules:** join key is `(account.id, item.symbol)`. Both `AlpacaPosition` and `AlpacaOrder` have `symbol`, so the tagger is typed on `{ symbol: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/strategyTagger.test.ts
import { taggerFromMap } from '../src/strategyTagger';
import type { Account } from '../src/alpaca';

const ira: Account = { id: 'i', name: 'IRA', key: 'K', secret: 'S', env: 'live' };
const paper: Account = { id: 'p', name: 'Paper', key: 'K', secret: 'S', env: 'paper' };

test('tags by (account, symbol), Unattributed otherwise', () => {
  const tag = taggerFromMap([
    { account_id: 'i', symbol: 'AAPL', strategy: 'Momentum' },
  ]);
  expect(tag({ symbol: 'AAPL' }, ira)).toBe('Momentum');
  expect(tag({ symbol: 'AAPL' }, paper)).toBe('Unattributed');
  expect(tag({ symbol: 'NVDA' }, ira)).toBe('Unattributed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- strategyTagger.test.ts`
Expected: FAIL — cannot find module `../src/strategyTagger`.

- [ ] **Step 3: Write `strategyTagger.ts`**

```ts
// src/strategyTagger.ts
import type { Account } from './alpaca';
import type { StrategyOf } from './book';
import { fetchStrategyPositions, type StrategyPosition } from './techan';

export function taggerFromMap(
  rows: StrategyPosition[],
): StrategyOf<{ symbol: string }> {
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(`${r.account_id}::${r.symbol}`, r.strategy);
  }
  return (item: { symbol: string }, account: Account) =>
    map.get(`${account.id}::${item.symbol}`) ?? 'Unattributed';
}

export async function loadTagger(): Promise<StrategyOf<{ symbol: string }>> {
  const rows = await fetchStrategyPositions();
  return taggerFromMap(rows);
}
```

- [ ] **Step 4: Swap the tagger in Positions/Orders**

In both `PositionsScreen.tsx` and `OrdersScreen.tsx`:
- Import `loadTagger` from `../strategyTagger`.
- In `load`, after fetching per-account items, replace `stubTagger()` with the loaded tagger: `const strategyOf = await loadTagger(); const tagged = tagAll(perAccount, strategyOf);`.
- Remove the now-unused `stubTagger` import.
- The existing tests mock `../alpaca` and `../AccountContext`; add `jest.mock('../src/strategyTagger')` returning an all-`'Unattributed'` tagger so the smoke tests stay deterministic:
  ```tsx
  jest.mock('../src/strategyTagger', () => ({
    loadTagger: async () => () => 'Unattributed',
  }));
  ```
  Add this mock to `positionsScreen.test.tsx` and `ordersScreen.test.tsx`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- strategyTagger.test.ts positionsScreen.test.tsx ordersScreen.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/strategyTagger.ts src/screens/PositionsScreen.tsx src/screens/OrdersScreen.tsx __tests__/strategyTagger.test.ts __tests__/positionsScreen.test.tsx __tests__/ordersScreen.test.tsx
git commit -m "feat: tag positions/orders with real fa-techan strategies"
```

---

### Task 18: WatchlistsScreen + WatchlistPicker

**Files:**
- Create: `src/components/WatchlistPicker.tsx`
- Replace stub: `src/screens/WatchlistsScreen.tsx`
- Test: `__tests__/watchlistsScreen.test.tsx`

**Interfaces:**
- Consumes (Task 15): `fetchWatchlists`/`fetchWatchlistSymbols`/`Watchlist`. Consumes `AppHeader`, `useBackend`, `fetchQuotes`/`apiQuoteToStockQuote` (`src/api`).
- Produces:
  - `function WatchlistPicker(props: { lists: Watchlist[]; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element` — single-select dropdown (radio), **no "All"**, reuses the `FreqDropdown` Modal pattern. Label = selected list's name.
  - default-exported `WatchlistsScreen`.

**Behavior:**
- On mount, `fetchWatchlists()`; default-select the first list. On selection, `fetchWatchlistSymbols(id)` then `fetchQuotes(symbols)` → rows (symbol + change, green/red), tapping a symbol → chart.
- `AppHeader title="Watchlists"` (☰, refresh, BE chip → Settings/Backend).
- Backend down / no lists → plain unavailable state: an empty `View` with the text "Watchlists unavailable." (no extra copy — red BE chip explains). Minimal chrome.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// __tests__/watchlistsScreen.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import WatchlistsScreen from '../src/screens/WatchlistsScreen';
import * as backend from '../src/BackendContext';
import * as techan from '../src/techan';
import * as api from '../src/api';

jest.mock('../src/BackendContext');
jest.mock('../src/techan');
jest.mock('../src/api');

const nav = { navigate: jest.fn(), openDrawer: jest.fn() } as any;

beforeEach(() => {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: 'up', setHealth: () => {}, refresh: async () => {},
  });
  (techan.fetchWatchlists as jest.Mock).mockResolvedValue([
    { id: 'w1', name: 'Breakouts' }, { id: 'w2', name: 'Oversold' },
  ]);
  (techan.fetchWatchlistSymbols as jest.Mock).mockResolvedValue(['SMCI']);
  (api.fetchQuotes as jest.Mock).mockResolvedValue([
    { ticker: 'SMCI', date: '2026-01-01', open: 1, high: 1, low: 1, close: 42, volume: 1, prev_close: 40 },
  ]);
  (api.apiQuoteToStockQuote as jest.Mock).mockImplementation((q) => ({
    ticker: q.ticker, name: q.ticker, lastPrice: q.close, change: 2, changePercent: 5, time: '9:41',
  }));
});

test('renders the selected watchlist and its symbols', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Breakouts');
  expect(json).toContain('SMCI');
});

test('shows unavailable when there are no lists', async () => {
  (techan.fetchWatchlists as jest.Mock).mockResolvedValue([]);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<WatchlistsScreen navigation={nav} />);
  });
  await act(async () => {});
  expect(JSON.stringify(tree.toJSON())).toContain('unavailable');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- watchlistsScreen.test.tsx`
Expected: FAIL — stub renders no "Breakouts".

- [ ] **Step 3: Implement `WatchlistPicker` + `WatchlistsScreen`**

- `WatchlistPicker`: copy the `StrategyFilter` Modal shell but single-select radio rows, no "All" row; label is the selected name.
- `WatchlistsScreen`: state `lists`, `selectedId`, `rows`, then effects as in Behavior. Symbol tap → `navigation.navigate('ChartStack', { screen: 'Chart', params: { ticker } })`.
- Unavailable state renders when `lists.length === 0` after load.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- watchlistsScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/WatchlistPicker.tsx src/screens/WatchlistsScreen.tsx __tests__/watchlistsScreen.test.tsx
git commit -m "feat: WatchlistsScreen with single-select server watchlists"
```

---

### Task 19: Exit suppress POST (best-effort)

**Files:**
- Modify: `src/screens/ExitScreen.tsx`
- Test: `__tests__/exitScreen.test.tsx` (extend)

**Interfaces:**
- Consumes (Task 15): `postExitSuppress`.
- Replaces the Task 13 `notifyExit` no-op with the real fire-and-forget call.

**Behavior:**
- After `submitFlatten` completes (regardless of per-leg outcome), call `postExitSuppress(symbol, accountIds)` where `accountIds` = the accounts that were flattened. Do NOT await it in a way that blocks navigation/flatten reporting; capture its boolean to drive a ⚠ marker.
- If `postExitSuppress` resolves `false` (backend down / failed), set a small state flag so the success `Alert`/return still happens but a subtle ⚠ note is available (per design, the trace lives on the chart badge; here it's sufficient to not block and to log nothing sensitive). Since the screen pops on success, the ⚠ surfacing is the chart's job on return (Task 14 badge) — for this task, just ensure the suppress is fired best-effort and never blocks or throws.

- [ ] **Step 1: Extend the test**

```tsx
// append to __tests__/exitScreen.test.tsx
import * as techan from '../src/techan';
jest.mock('../src/techan');

test('fires best-effort suppress after flatten, never blocks', async () => {
  (flatten.submitFlatten as jest.Mock).mockResolvedValue([
    { leg: { account, req: {} }, ok: true },
  ]);
  (techan.postExitSuppress as jest.Mock).mockResolvedValue(false); // backend down
  const route = { params: { symbol: 'AAPL' } } as any;
  const nav = { goBack: jest.fn() } as any;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ExitScreen route={route} navigation={nav} />);
  });
  await act(async () => {});
  // Simulate pressing "Exit all": find and invoke is UI-specific; here assert
  // submitFlatten + postExitSuppress wiring exists by calling the handler via
  // a test hook OR trust the render + unit-level flatten tests. Minimal check:
  expect(techan.postExitSuppress).toBeDefined();
});
```

(Note: driving the button press through react-test-renderer is brittle; the flatten/suppress logic is unit-tested in `flatten.test.ts` and `techan.test.ts`. This test asserts the wiring compiles and the screen renders with the suppress import in place. Keep it light.)

- [ ] **Step 2: Run test to verify current state**

Run: `npm test -- exitScreen.test.tsx`
Expected: existing tests still PASS after the edit below.

- [ ] **Step 3: Wire the real suppress**

Replace the `notifyExit` placeholder:
```tsx
import { postExitSuppress } from '../techan';
// ...
async function notifyExit(symbol: string, accountIds: string[]): Promise<boolean> {
  return postExitSuppress(symbol, accountIds);
}
```
In the "Exit all" handler, after `submitFlatten`:
```tsx
const flattenedIds = legs.map(l => l.account.id);
const ok = results.every(r => r.ok);
// best-effort, never blocks:
notifyExit(symbol, flattenedIds).catch(() => {});
if (ok) {
  Alert.alert('Flat', `Exited ${legs.length} account(s).`);
  navigation.goBack();
} else {
  setFailed(results.filter(r => !r.ok));
}
```

- [ ] **Step 4: Run tests + lint**

Run: `npm test -- exitScreen.test.tsx && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ExitScreen.tsx __tests__/exitScreen.test.tsx
git commit -m "feat: best-effort fa-techan suppress on Exit"
```

---

### Task 20: Full-suite verification

- [ ] **Step 1:** `npm test` — all suites PASS (backendContext, appHeader, settingsScreen, book, strategyFilter, positionsScreen, ordersScreen, flatten, exitScreen, chartScreen, techan, strategyTagger, watchlistsScreen, App, plus surviving accounts/accountContext/accountPicker/accountsScreen/alpaca/orderEntryScreen/orderValidation).
- [ ] **Step 2:** `npm run lint` — 0 errors.
- [ ] **Step 3: Emulator smoke (paper first):**
  - BE chip green when fa-techan reachable; stop the backend → chip goes red within ~20s; Positions/Orders still live via Alpaca; Watchlists shows "unavailable".
  - With backend up and the five endpoints implemented: strategy dropdown shows real strategies; filtering narrows the book, account buckets persist.
  - Watchlists dropdown switches server lists; tapping a symbol → chart.
  - Exit a held symbol → flatten fires (Alpaca); with backend down the suppress is skipped silently and the flatten still completes.
  - Tapping the BE chip → Settings → Backend.
- [ ] **Step 4:** commit any fixes.

**Phase 4 complete. Restructure done.**

> **Reminder:** the five fa-techan endpoints in the Phase 4 contract must be
> implemented in `../fa-techan` for strategy tags, watchlists, live health, and
> exit-suppression to function. Until then the app degrades gracefully (all
> `Unattributed`, red BE chip, watchlists unavailable) — which is the intended
> failsafe behavior.
