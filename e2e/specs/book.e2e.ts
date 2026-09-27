import { $, expect } from '@wdio/globals';
import { FAKE, openProvisionedApp } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// trading spec: positions and orders across accounts, strategy tags from
// fa-techan, and the per-account error banner.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function go(item: string) {
  await tid('menu').click();
  await tid(`nav-${item}`).click();
}

async function fail(rule: object) {
  await fetch(`${FAKE()}/__control/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rule) });
}

describe('positions and orders', () => {
  before(openProvisionedApp);
  after(() => fetch(`${FAKE()}/__control/reset`, { method: 'POST' }));

  it('shows positions for both accounts', async () => {
    await go('positions');
    await expect(tid('position-PA1TEST-AAPL')).toHaveText(expect.stringContaining('10 @ $'));
    await expect(tid('position-PA1TEST-MSFT')).toHaveText(expect.stringContaining('-5 @ $'));
    await expect(tid('position-LV1TEST-AAPL')).toBeDisplayed();
    await expect(tid('bucket-PA1TEST')).toHaveText(expect.stringContaining('paper'));
    await snap('positions');
  });

  it('filters by the fa-techan strategy', async () => {
    await tid('strategy-filter').click();
    await tid('strategy-option-Momentum').click();
    await tid('strategy-menu-overlay').click({ x: 150, y: 300 });
    await expect(tid('position-PA1TEST-AAPL')).toBeDisplayed();
    await expect(tid('position-PA1TEST-MSFT')).not.toBeExisting();
    await expect(tid('bucket-LV1TEST')).not.toBeExisting();
  });

  it('shows the error banner when one account fails', async () => {
    await fail({ target: 'alpaca', mode: '401', key: 'AKTESTKEY0000002' });
    await tid('refresh').click();
    await expect(tid('book-error')).toHaveText('Check the API keys for this account.');
    await expect(tid('position-PA1TEST-AAPL')).toBeDisplayed();
    await snap('positions-error');
    await fetch(`${FAKE()}/__control/reset`, { method: 'POST' });
  });

  it('shows the working orders', async () => {
    await go('orders');
    await expect(tid('order-seed-order-1')).toHaveText(expect.stringContaining('AMD'));
    await expect(tid('order-seed-order-1')).toHaveText(expect.stringContaining('2 @ 100'));
    await expect(tid('bucket-PA1TEST')).toHaveText(expect.stringContaining('1 working'));
    await snap('orders');
  });
});
