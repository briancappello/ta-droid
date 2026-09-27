// Temporary screens, each replaced by its task in section 5.
import { Screen, SubScreen } from '../components/Screen';

export const OrderEntryScreen = () => <SubScreen title="Order" testId="screen-order" />;
export const ExitScreen = () => <SubScreen title="Exit" testId="screen-exit" />;
export const PositionsScreen = () => <Screen title="Positions" testId="screen-positions" />;
export const OrdersScreen = () => <Screen title="Orders" testId="screen-orders" />;
