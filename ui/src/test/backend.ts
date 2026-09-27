// Test double for the Rust backend: route `invoke` calls to handlers.
import { mockIPC } from '@tauri-apps/api/mocks';

export type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

/** Defaults for a provisioned app with healthy backends and no data. */
export const baseHandlers: Handlers = {
  provisioning_status: () => ({ needed: false }),
  list_accounts: () => ({ accounts: [], active_id: null }),
  health: () => ({ marketstore: 'up', fatechan: 'up' }),
  list_profiles: () => ({ profiles: [], active: 'e2e' }),
  watchlists: () => [],
  history: () => ({ columns: [], index: [], data: [] }),
  symbol_holdings: () => [],
  subscribe_bars: () => 99,
  unsubscribe: () => null,
};

/** Install handlers; returns the list of calls made, for assertions. */
export function mockBackend(handlers: Handlers = {}): { cmd: string; args: Record<string, unknown> }[] {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const all = { ...baseHandlers, ...handlers };
  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args });
    const h = all[cmd];
    if (!h) throw new Error(`unmocked command ${cmd}`);
    return h(args);
  });
  return calls;
}

/** Deliver messages to a Channel passed to a mocked command, as Rust would. */
export function channelSender<T>(channel: unknown): (message: T) => void {
  const id = (channel as { id: number }).id;
  let index = 0;
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } })
    .__TAURI_INTERNALS__;
  return message => internals.runCallback(id, { index: index++, message });
}
