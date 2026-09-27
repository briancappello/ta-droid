import { $, expect } from '@wdio/globals';
import { snap } from '../support/screens.ts';

describe('smoke', () => {
  it('launches and renders the app root', async () => {
    await expect($('[data-testid="app-root"]')).toBeDisplayed();
    await snap('smoke-launch');
  });
});
