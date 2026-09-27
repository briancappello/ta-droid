import { Navigate, type RouteObject } from 'react-router';
import { Shell } from './components/Shell';
import * as S from './screens/placeholders';

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
      { path: '/watchlists', element: <S.WatchlistsScreen /> },
      { path: '/settings', element: <S.SettingsScreen /> },
      { path: '/settings/accounts', element: <S.AccountsScreen /> },
      { path: '/settings/backend', element: <S.BackendScreen /> },
    ],
  },
];
