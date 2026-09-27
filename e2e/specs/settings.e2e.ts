import { $, browser, expect } from '@wdio/globals';
import { FAKE, openProvisionedApp } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// backend-profiles and accounts specs: the settings screens against the
// real backend, and a profile switch that survives a restart.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function lastHealthHeaders(): Promise<Record<string, string>> {
  const log = (await (await fetch(`${FAKE()}/__control/requests`)).json()) as { path: string; headers: [string, string][] }[];
  const last = log.filter(r => r.path === '/marketstore/v1/health').at(-1);
  return Object.fromEntries(last?.headers ?? []);
}

async function toSettings() {
  await tid('menu').click();
  await tid('nav-settings').click();
  await expect(tid('screen-settings')).toBeDisplayed();
}

describe('settings', () => {
  before(openProvisionedApp);

  it('shows the linked accounts without key material', async () => {
    await toSettings();
    await expect(tid('to-accounts')).toHaveText(expect.stringContaining('2 linked'));
    await tid('to-accounts').click();
    await expect(tid('account-PA1TEST')).toHaveText(expect.stringContaining('PA1TEST · ••••0001'));
    await expect(tid('account-PA1TEST')).toHaveText(expect.stringContaining('paper'));
    await expect(tid('account-LV1TEST')).not.toHaveText(expect.stringContaining('paper'));
    await snap('settings-accounts');
    await tid('back').click();
  });

  it('switches profile, sends its auth headers, and keeps it after a restart', async () => {
    await expect(tid('to-backend')).toHaveText(expect.stringContaining('e2e'));
    await tid('to-backend').click();
    await expect(tid('profile-e2e-auth-flags')).toHaveText('auth');
    await tid('profile-e2e-auth').click();
    await expect(tid('profile-e2e-auth')).toHaveAttribute('aria-pressed', 'true');
    await expect(tid('active-health')).toHaveText('MS up · FA up', { wait: 10_000 });
    const h = await lastHealthHeaders();
    expect(h['cf-access-client-id']).toBe('test-client-id');
    await snap('settings-backend');

    await browser.reloadSession();
    await expect(tid('screen-watchlists')).toBeDisplayed({ wait: 20_000 });
    await toSettings();
    await expect(tid('to-backend')).toHaveText(expect.stringContaining('e2e-auth'));
  });

  after(async () => {
    // Leave the default profile for the specs that follow.
    await tid('to-backend').click();
    await tid('profile-e2e').click();
    await expect(tid('profile-e2e')).toHaveAttribute('aria-pressed', 'true');
  });
});
