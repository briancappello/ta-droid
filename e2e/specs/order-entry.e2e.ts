import { $, browser, expect } from '@wdio/globals';
import { FAKE, openProvisionedApp } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// trading spec: order entry, validation, review, and exactly-once submit.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function orderPosts(): Promise<Record<string, unknown>[]> {
  const log = (await (await fetch(`${FAKE()}/__control/requests`)).json()) as { method: string; path: string; body: string }[];
  return log.filter(r => r.method === 'POST' && r.path === '/alpaca/v2/orders').map(r => JSON.parse(r.body));
}

describe('order entry', () => {
  before(async () => {
    await openProvisionedApp();
    await fetch(`${FAKE()}/__control/requests`, { method: 'DELETE' });
    await tid('menu').click();
    await tid('nav-chart').click();
    await tid('trade').click();
    await expect(tid('screen-order')).toBeDisplayed();
  });
  after(() => fetch(`${FAKE()}/__control/reset`, { method: 'POST' }));

  it('rejects an incomplete limit order before review', async () => {
    await tid('type-limit').click();
    await tid('review').click();
    await expect(tid('order-error')).toHaveText('Quantity must be a positive number.');
    await expect(tid('review-modal')).not.toBeExisting();
  });

  it('reviews and places a limit order exactly once, even on a double tap', async () => {
    await tid('order-qty').setValue('3');
    await tid('order-limit').setValue('101.5');
    await tid('review').click();
    await expect(tid('review-modal')).toHaveText(expect.stringContaining('Limit: 101.5'));
    await snap('order-review');
    // Two clicks in the same frame, as a fast double tap would deliver.
    await browser.execute(() => {
      const b = document.querySelector('[data-testid="submit"]') as HTMLButtonElement;
      b.click();
      b.click();
    });
    await expect(tid('notice')).toHaveText('Order submitted', { wait: 10_000 });
    await expect(tid('screen-chart')).toBeDisplayed();
    await snap('order-submitted');
    const posts = await orderPosts();
    expect(posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ symbol: 'AMD', side: 'buy', type: 'limit', qty: '3', limit_price: '101.5', time_in_force: 'day' });
    expect(String(posts[0].client_order_id)).toMatch(/^ta-/);
  });

  it('shows a broker rejection and stays on the form', async () => {
    await fetch(`${FAKE()}/__control/fail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'alpaca', mode: '429', method: 'POST', times: 1 }),
    });
    await tid('trade').click();
    await tid('order-qty').setValue('1');
    await tid('review').click();
    await tid('submit').click();
    await expect(tid('submit-error')).toHaveText('Rate limited by Alpaca, retry shortly.');
    await expect(tid('screen-order')).toBeDisplayed();
  });
});
