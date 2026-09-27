import { browser, expect } from '@wdio/globals';
import { invoke } from '../support/app.ts';

// app-shell spec: secret boundary. The WebView may talk only to the backend
// over IPC; any direct network request from UI code is blocked by the CSP.
const FAKE = process.env.E2E_FAKE_URL ?? 'http://127.0.0.1:8787';

async function fakeRequests(): Promise<{ path: string }[]> {
  const res = await fetch(`${FAKE}/__control/requests`);
  return (await res.json()) as { path: string }[];
}

describe('security', () => {
  it('blocks a direct fetch from the UI and the request never leaves', async () => {
    await fetch(`${FAKE}/__control/requests`, { method: 'DELETE' });
    const outcome = await browser.executeAsync((done: (r: string) => void) => {
      fetch('http://127.0.0.1:8787/fatechan/csp-probe').then(
        () => done('allowed'),
        (e: unknown) => done(`blocked: ${String(e)}`),
      );
    });
    expect(outcome).toMatch(/^blocked/);
    // A path the backend never calls, so only a UI request could log it.
    const leaked = (await fakeRequests()).filter(r => r.path === '/fatechan/csp-probe');
    expect(leaked).toEqual([]);
  });

  it('still reaches the backend over IPC', async () => {
    expect(await invoke('health')).toEqual({ marketstore: 'up', fatechan: 'up' });
  });
});
