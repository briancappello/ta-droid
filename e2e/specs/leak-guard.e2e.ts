import { expect } from '@wdio/globals';
import { ensureProvisioned, invoke, SECRETS } from '../support/app.ts';

// app-shell spec: no backend command returns a provisioned secret. In e2e
// builds the backend's leak guard turns a leak into an error; here every
// read command must succeed and its JSON must be free of the test secrets.
describe('secret boundary', () => {
  it('every read command answers without a provisioned value', async () => {
    await ensureProvisioned();
    const calls: [string, Record<string, unknown>][] = [
      ['provisioning_status', {}],
      ['list_accounts', {}],
      ['list_profiles', {}],
      ['health', {}],
      ['positions', {}],
      ['orders', {}],
      ['symbol_holdings', { symbol: 'AAPL' }],
      ['flatten_legs', { symbol: 'AAPL' }],
      ['watchlists', {}],
      ['history', { symbol: 'AAPL', freq: 'D', limit: 50 }],
    ];
    for (const [cmd, args] of calls) {
      const result = await invoke(cmd, args);
      const json = JSON.stringify(result);
      expect(json).not.toContain('secret leak blocked');
      expect((result as { error?: unknown }).error).toBeUndefined();
      for (const s of SECRETS) expect(json).not.toContain(s);
    }
  });
});
