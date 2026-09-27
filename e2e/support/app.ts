import fs from 'node:fs';
import path from 'node:path';
import { $, browser } from '@wdio/globals';

/** The e2e blob's passphrase (config/app-config.e2e.toml). */
export const PASSPHRASE = fs
  .readFileSync(path.resolve(import.meta.dirname, '..', 'fixtures', 'passphrase.txt'), 'utf8')
  .trim();

/** Values provisioned from the e2e blob; they must never reach the UI. */
export const SECRETS = [
  'PKTESTKEY0000001',
  'test-secret-0001',
  'AKTESTKEY0000002',
  'test-secret-0002',
  'test-client-id',
  'test-client-secret',
];

export const FAKE = () => process.env.E2E_FAKE_URL ?? 'http://127.0.0.1:8787';

/** Call a backend command from inside the app. Rejections become {error}. */
export async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // Results cross the WebDriver boundary as JSON text: WebKitWebDriver
  // mangles some object results ("[object Object]" errors).
  const text = await browser.executeAsync(
    (c: string, a: Record<string, unknown>, done: (r: string) => void) => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__;
      internals.invoke(c, a).then(
        v => done(JSON.stringify({ ok: v ?? null })),
        (e: unknown) => done(JSON.stringify({ error: e })),
      );
    },
    cmd,
    args,
  );
  const parsed = JSON.parse(text) as { ok?: T; error?: unknown };
  return ('error' in parsed ? { error: parsed.error } : parsed.ok) as T;
}

/** Provision the e2e blob if this data dir has not been provisioned yet. */
export async function ensureProvisioned(): Promise<void> {
  const status = await invoke<{ needed: boolean }>('provisioning_status');
  if (status.needed) {
    const r = await invoke<{ outcome: string }>('provision', { passphrase: PASSPHRASE });
    if (r.outcome !== 'ok') throw new Error(`provisioning failed: ${JSON.stringify(r)}`);
  }
}

/** Provision if needed, then reload so the UI mounts past the gate. */
export async function openProvisionedApp(): Promise<void> {
  await ensureProvisioned();
  await browser.refresh();
  await $('[data-testid="app-root"]').waitForExist();
}

/** Push a MarketStore stream message through fake-backends. */
export async function pushStream(key: string, data: unknown): Promise<void> {
  await fetch(`${FAKE()}/__control/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, data }),
  });
}

/** Keep pushing until `done()` holds (the socket subscribes lazily). */
export async function pushUntil(key: string, data: unknown, done: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await pushStream(key, data);
    if (await done()) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`stream message for ${key} never took effect`);
}
