import { $, browser, expect } from '@wdio/globals';
import { invoke, PASSPHRASE } from '../support/app.ts';
import { snap } from '../support/screens.ts';

// credential-provisioning spec: the gate on a fresh install, a wrong
// passphrase, success, and no prompt after a restart.
const tid = (id: string) => $(`[data-testid="${id}"]`);

async function unlock(pass: string) {
  await tid('passphrase').setValue(pass);
  await tid('unlock').click();
}

describe('provisioning', () => {
  before(async () => {
    await invoke('e2e_reset');
    await browser.refresh();
  });

  it('asks for the passphrase before anything else', async () => {
    await expect(tid('provisioning')).toBeDisplayed();
    await expect(tid('screen-watchlists')).not.toBeExisting();
    await snap('provisioning-prompt');
  });

  it('rejects a wrong passphrase and clears the field', async () => {
    await unlock('not the passphrase');
    await expect(tid('provisioning-error')).toHaveText('Incorrect passphrase.', { wait: 30_000 });
    await expect(tid('passphrase')).toHaveValue('');
    await snap('provisioning-wrong');
  });

  it('unlocks with the right passphrase and opens the app', async () => {
    await unlock(PASSPHRASE);
    await expect(tid('screen-watchlists')).toBeDisplayed({ wait: 30_000 });
  });

  it('does not ask again after a restart', async () => {
    await browser.reloadSession();
    await expect(tid('screen-watchlists')).toBeDisplayed({ wait: 20_000 });
    await expect(tid('provisioning')).not.toBeExisting();
  });
});
