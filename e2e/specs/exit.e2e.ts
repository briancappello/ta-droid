import { $, browser, expect } from '@wdio/globals';
import { FAKE, openProvisionedApp } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// trading spec: exit a symbol across accounts; a retry resends only the
// legs that failed.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function exitPosts(): Promise<{ key: string; body: Record<string, unknown> }[]> {
  const log = (await (await fetch(`${FAKE()}/__control/requests`)).json()) as {
    method: string; path: string; body: string; headers: [string, string][];
  }[];
  return log
    .filter(r => r.method === 'POST' && r.path === '/alpaca/v2/orders')
    .map(r => ({ key: Object.fromEntries(r.headers)['apca-api-key-id'], body: JSON.parse(r.body) }));
}

describe('exit', () => {
  before(async () => {
    await openProvisionedApp();
    await fetch(`${FAKE()}/__control/reset`, { method: 'POST' });
    await tid('menu').click();
    await tid('nav-chart').click();
    const input = tid('symbol-input');
    await input.click();
    await input.setValue('AAPL');
    await browser.keys('Enter');
    await tid('exit').click();
    await expect(tid('screen-exit')).toBeDisplayed();
  });
  after(() => fetch(`${FAKE()}/__control/reset`, { method: 'POST' }));

  it('proposes a market sell for each holding account', async () => {
    await expect(tid('leg-PA1TEST')).toHaveText(expect.stringContaining('Sell 10 · market'));
    await expect(tid('leg-LV1TEST')).toHaveText(expect.stringContaining('Sell 3 · market'));
    await snap('exit-legs');
  });

  it('reports a failed leg, then a retry sends only that leg', async () => {
    await fetch(`${FAKE()}/__control/fail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'alpaca', mode: '422', key: 'AKTESTKEY0000002', method: 'POST', times: 1 }),
    });
    await tid('exit-all').click();
    await expect(tid('exit-failures')).toHaveText(expect.stringContaining('Live: scripted rejection'));
    await expect(tid('leg-PA1TEST')).not.toBeExisting();
    await snap('exit-partial');

    await tid('exit-all').click();
    await expect(tid('notice')).toHaveText('Flat — Exited 2 account(s).', { wait: 10_000 });
    await expect(tid('screen-chart')).toBeDisplayed();

    const posts = await exitPosts();
    expect(posts.length).toBe(3);
    expect(posts.filter(p => p.key === 'PKTESTKEY0000001').length).toBe(1);
    expect(posts.filter(p => p.key === 'AKTESTKEY0000002').length).toBe(2);
    const live = posts.filter(p => p.key === 'AKTESTKEY0000002');
    expect(live[0].body.client_order_id).toBe(live[1].body.client_order_id);
  });
});
