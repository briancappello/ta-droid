import { $, expect } from '@wdio/globals';
import { openProvisionedApp } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// app-shell spec: drawer destinations, stacks, back through history, and
// the health pill.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function openFromDrawer(item: string, screen: string) {
  await tid('menu').click();
  await expect(tid('drawer')).toBeDisplayed();
  await tid(`nav-${item}`).click();
  await expect(tid(screen)).toBeDisplayed();
}

describe('app shell', () => {
  before(openProvisionedApp);

  it('opens on Watchlists', async () => {
    await expect(tid('screen-watchlists')).toBeDisplayed();
    await snap('shell-watchlists');
  });

  it('reaches every drawer destination', async () => {
    for (const [item, screen] of [
      ['chart', 'screen-chart'],
      ['positions', 'screen-positions'],
      ['orders', 'screen-orders'],
      ['watchlists', 'screen-watchlists'],
      ['settings', 'screen-settings'],
    ]) {
      await openFromDrawer(item, screen);
    }
    await tid('menu').click();
    await snap('shell-drawer');
    // The drawer covers the scrim's center; tap the uncovered right edge.
    await tid('drawer-scrim').click({ x: 180 });
    await expect(tid('drawer')).not.toBeDisplayed();
  });

  it('pushes stack screens and goes back through history', async () => {
    await openFromDrawer('chart', 'screen-chart');
    await tid('trade').click();
    await expect(tid('screen-order')).toBeDisplayed();
    await tid('back').click();
    await expect(tid('screen-chart')).toBeDisplayed();

    await openFromDrawer('settings', 'screen-settings');
    await tid('to-accounts').click();
    await expect(tid('screen-accounts')).toBeDisplayed();
    await tid('back').click();
    await expect(tid('screen-settings')).toBeDisplayed();
  });

  it('shows live health and opens Backend settings from the pill', async () => {
    await expect(tid('dot-ms')).toHaveAttribute('data-health', 'up');
    await expect(tid('dot-fa')).toHaveAttribute('data-health', 'up');
    await tid('health-pill').click();
    await expect(tid('screen-backend')).toBeDisplayed();
  });
});
