import { Navigate, type RouteObject } from 'react-router';
import { Shell } from './components/Shell';
import * as S from './screens/placeholders';
import { AccountsScreen } from './screens/AccountsScreen';
import { BackendScreen } from './screens/BackendScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WatchlistsScreen } from './screens/WatchlistsScreen';

export const DEFAULT_TICKER = 'AMD';

/** Drawer screens, the chart stack, and the settings stack (app-shell spec). */
export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Navigate to="/watchlists" replace /> },
      { path: '/chart', element: <Navigate to={`/chart/${DEFAULT_TICKER}`} replace /> },
      { path: '/chart/:ticker', element: <S.ChartScreen /> },
      { path: '/chart/:ticker/order', element: <S.OrderEntryScreen /> },
      { path: '/chart/:ticker/exit', element: <S.ExitScreen /> },
      { path: '/positions', element: <S.PositionsScreen /> },
      { path: '/orders', element: <S.OrdersScreen /> },
      { path: '/watchlists', element: <WatchlistsScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/settings/accounts', element: <AccountsScreen /> },
      { path: '/settings/backend', element: <BackendScreen /> },
    ],
  },
];
