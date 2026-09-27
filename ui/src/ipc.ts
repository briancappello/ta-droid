// Typed access to the Rust backend (design D3). All UI I/O goes through here:
// the WebView has no network access of its own (design D10).
import { Channel, invoke } from '@tauri-apps/api/core';
import type { AccountBook } from './bindings/AccountBook';
import type { AccountsView } from './bindings/AccountsView';
import type { HealthReport } from './bindings/HealthReport';
import type { History } from './bindings/History';
import type { HoldingView } from './bindings/HoldingView';
import type { Leg } from './bindings/Leg';
import type { LiveBar } from './bindings/LiveBar';
import type { Order } from './bindings/Order';
import type { OrderForm } from './bindings/OrderForm';
import type { Outcome } from './bindings/Outcome';
import type { Position } from './bindings/Position';
import type { ProfilesView } from './bindings/ProfilesView';
import type { ProvisioningStatus } from './bindings/ProvisioningStatus';
import type { Quote } from './bindings/Quote';
import type { SubmitOutcome } from './bindings/SubmitOutcome';
import type { WatchRow } from './bindings/WatchRow';
import type { WatchlistRef } from './bindings/WatchlistRef';

/** Command errors carry a user-facing message only. */
export function errorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    return e.message;
  }
  if (typeof e === 'string' && e) return e;
  return fallback;
}

export const api = {
  provisioningStatus: () => invoke<ProvisioningStatus>('provisioning_status'),
  provision: (passphrase: string) => invoke<Outcome>('provision', { passphrase }),
  listAccounts: () => invoke<AccountsView>('list_accounts'),
  setActiveAccount: (id: string) => invoke<AccountsView>('set_active_account', { id }),
  listProfiles: () => invoke<ProfilesView>('list_profiles'),
  setActiveProfile: (name: string) => invoke<ProfilesView>('set_active_profile', { name }),
  health: () => invoke<HealthReport>('health'),

  history: (symbol: string, freq: string, limit?: number) =>
    invoke<History>('history', { symbol, freq, limit: limit ?? null }),
  quotes: (symbols: string[]) => invoke<Quote[]>('quotes', { symbols }),
  watchlists: () => invoke<WatchlistRef[]>('watchlists'),
  watchlistEntries: (id: string) => invoke<WatchRow[]>('watchlist_entries', { id }),

  positions: () => invoke<AccountBook<Position>[]>('positions'),
  orders: () => invoke<AccountBook<Order>[]>('orders'),
  symbolHoldings: (symbol: string) => invoke<HoldingView[]>('symbol_holdings', { symbol }),
  validateOrder: (form: OrderForm) => invoke<string[]>('validate_order', { form }),
  placeOrder: (accountId: string, form: OrderForm) => invoke<Order>('place_order', { accountId, form }),
  flattenLegs: (symbol: string) => invoke<Leg[]>('flatten_legs', { symbol }),
  submitFlatten: (legs: Leg[]) => invoke<SubmitOutcome>('submit_flatten', { legs }),
};

/**
 * Subscribe to live data. Returns an unsubscribe function; call it when the
 * view goes away (the backend cannot see a dropped channel). Safe to call
 * more than once, and safe to call before the subscription resolves.
 */
function subscribe<T>(cmd: string, args: Record<string, unknown>, channelArg: string, onMessage: (m: T) => void): () => void {
  const channel = new Channel<T>();
  let active = true;
  channel.onmessage = m => {
    if (active) onMessage(m);
  };
  const id = invoke<number>(cmd, { ...args, [channelArg]: channel }).catch(() => null);
  return () => {
    if (!active) return;
    active = false;
    void id.then(i => (i == null ? undefined : invoke('unsubscribe', { id: i }).catch(() => undefined)));
  };
}

export const live = {
  bars: (symbol: string, timeframe: string, onBar: (b: LiveBar) => void) =>
    subscribe<LiveBar>('subscribe_bars', { symbol, timeframe }, 'onBar', onBar),
  watchlist: (id: string, onRows: (rows: WatchRow[]) => void) =>
    subscribe<WatchRow[]>('subscribe_watchlist', { id }, 'onRows', onRows),
};
