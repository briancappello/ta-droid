// Temporary screens, each replaced by its task in section 5.
import { Link, useParams } from 'react-router';
import { Screen, SubScreen } from '../components/Screen';

export function ChartScreen() {
  const { ticker = 'AMD' } = useParams();
  return (
    <Screen title={ticker} testId="screen-chart">
      <p style={{ padding: 16 }}>
        <Link to="order" data-testid="to-order">Trade</Link> · <Link to="exit" data-testid="to-exit">Exit</Link>
      </p>
    </Screen>
  );
}
export const OrderEntryScreen = () => <SubScreen title="Order" testId="screen-order" />;
export const ExitScreen = () => <SubScreen title="Exit" testId="screen-exit" />;
export const PositionsScreen = () => <Screen title="Positions" testId="screen-positions" />;
export const OrdersScreen = () => <Screen title="Orders" testId="screen-orders" />;
export const WatchlistsScreen = () => <Screen title="Watchlists" testId="screen-watchlists" />;
