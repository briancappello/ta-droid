import { $, browser, expect } from '@wdio/globals';
import { FAKE, openProvisionedApp, pushUntil } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// charting spec: live bars update the candle and the last price, and the
// subscription follows the symbol and frequency.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function wsUnions(): Promise<string[][]> {
  return (await (await fetch(`${FAKE()}/__control/ws-subscribes`)).json()) as string[][];
}

describe('live bars', () => {
  before(async () => {
    await openProvisionedApp();
    await tid('menu').click();
    await tid('nav-chart').click();
    const input = tid('symbol-input');
    await input.click();
    await input.setValue('AAPL');
    await browser.keys('Enter');
    await tid('range-1D').click();
    await expect(tid('chart-panes')).toHaveAttribute('data-range', '1D', { wait: 20_000 });
  });

  it('subscribes to the chart key for the current frequency', async () => {
    await browser.waitUntil(async () => (await wsUnions()).at(-1)?.includes('AAPL/1Min/OHLCV') ?? false, {
      timeout: 10_000,
      timeoutMsg: 'AAPL/1Min/OHLCV never subscribed',
    });
  });

  it('a pushed bar updates the last price and the candle', async () => {
    const epoch = Math.floor(Date.UTC(2026, 8, 25, 19, 59) / 1000);
    await pushUntil(
      'AAPL/1Min/OHLCV',
      { msg_type: 'bar', payload: { symbol: 'AAPL', open: 990, high: 1001, low: 989, close: 999.99, volume: 5000, epoch } },
      async () => (await tid('last-price').getText()) === '999.99',
    );
    await snap('live-bar');
  });

  it('moves the subscription when the frequency changes', async () => {
    await tid('freq-picker').click();
    await tid('freq-5min').click();
    await browser.waitUntil(
      async () => {
        const last = (await wsUnions()).at(-1) ?? [];
        return last.includes('AAPL/5Min/OHLCV') && !last.includes('AAPL/1Min/OHLCV');
      },
      { timeout: 10_000, timeoutMsg: 'subscription did not move to 5Min' },
    );
  });
});
