import { $, $$, browser, expect } from '@wdio/globals';
import { openProvisionedApp } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// charting spec: panes, ranges, 5D day labels, held-symbol strip, header.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function openChart(symbol: string) {
  const input = tid('symbol-input');
  await input.click();
  await input.setValue(symbol);
  await browser.keys('Enter');
  await expect(input).toHaveValue(symbol);
}

async function panesReady(range: string) {
  await expect(tid('chart-panes')).toHaveAttribute('data-range', range, { wait: 20_000 });
  // Three panes with drawn canvases.
  for (const pane of ['pane-main', 'pane-macd', 'pane-rsi']) {
    await expect(tid(pane).$('canvas')).toBeExisting();
  }
}

describe('chart', () => {
  before(async () => {
    await openProvisionedApp();
    await tid('menu').click();
    await tid('nav-chart').click();
    await expect(tid('screen-chart')).toBeDisplayed();
  });

  it('opens on AMD at 1Y daily with three panes', async () => {
    await expect(tid('symbol-input')).toHaveValue('AMD');
    await expect(tid('range-1Y')).toHaveAttribute('aria-pressed', 'true');
    await panesReady('1Y');
    await expect(tid('last-price')).toHaveText(/^\d+\.\d{2}$/);
    await expect(tid('exit')).not.toBeExisting();
    await snap('chart-1Y');
  });

  it('shows the held-symbol strip and Exit for AAPL', async () => {
    await openChart('AAPL');
    await expect(tid('exit')).toBeDisplayed();
    await expect(tid('positions-strip')).toHaveText(expect.stringContaining('Paper · 10 @'));
    await expect(tid('positions-strip')).toHaveText(expect.stringContaining('Live · 3 @'));
  });

  for (const range of ['1D', '5D', '5Y']) {
    it(`draws the ${range} range`, async () => {
      await tid(`range-${range}`).click();
      await panesReady(range);
      if (range === '5D') {
        await browser.waitUntil(async () => (await $$('[data-testid="day-labels"] span').length) === 5, {
          timeout: 10_000,
          timeoutMsg: 'expected one day label per session',
        });
        const names = await $$('[data-testid="day-labels"] span').map(s => s.getText());
        expect(names).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
      }
      await snap(`chart-${range}`);
    });
  }

  it('changes frequency within a range', async () => {
    await tid('range-1M').click();
    await expect(tid('freq-picker')).toHaveText('1hr ▼');
    await tid('freq-picker').click();
    await tid('freq-D').click();
    await expect(tid('freq-picker')).toHaveText('1D ▼');
    await panesReady('1M');
  });

  it('shows the error text for an unknown symbol', async () => {
    await openChart('NOPE');
    await expect(tid('chart-error')).toHaveText('symbol not found');
  });
});
