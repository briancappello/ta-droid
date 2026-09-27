import { $, expect } from '@wdio/globals';
import { openProvisionedApp, pushUntil } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// market-data spec: watchlists from MarketStore, live re-ranking, and
// opening a chart from a row.
const tid = (id: string) => $(`[data-testid="${id}"]`);

describe('watchlists', () => {
  before(openProvisionedApp);

  it('paints the first watchlist from REST', async () => {
    await expect(tid('watchlist-picker')).toHaveText('Momentum ▾');
    await expect(tid('watch-row-AAPL')).toBeDisplayed();
    await expect(tid('watch-row-PENNY')).toHaveText(expect.stringMatching(/0\.\d{4}/));
    await snap('watchlists-rest');
  });

  it('replaces the rows on a watchlist_update', async () => {
    await pushUntil(
      'WATCHLISTS/1Min/MOMENTUM',
      { msg_type: 'watchlist_update', payload: { name: 'MOMENTUM', symbols: [{ symbol: 'LIVE', rank: 1, price: 12.5, prior_close: 12, open: 10 }] } },
      async () => tid('watch-row-LIVE').isExisting(),
    );
    await expect(tid('watch-row-AAPL')).not.toBeExisting();
    await expect(tid('watch-row-LIVE')).toHaveText(expect.stringContaining('+25.00%'));
    await snap('watchlists-live');
  });

  it('switches lists and shows aggregates', async () => {
    await tid('watchlist-picker').click();
    await tid('watchlist-option-SECTOR_AGGREGATE').click();
    await expect(tid('watch-row-Technology')).toHaveText(expect.stringContaining('+1.23%'));
  });

  it('opens the chart for a tapped row', async () => {
    await tid('watchlist-picker').click();
    await tid('watchlist-option-MOMENTUM').click();
    await tid('watch-row-AMD').click();
    await expect(tid('screen-chart')).toBeDisplayed();
  });
});
