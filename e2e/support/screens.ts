import path from 'node:path';
import { browser } from '@wdio/globals';

/** Save a screenshot named `<name>.png` in the gate's artifacts directory. */
export async function snap(name: string): Promise<void> {
  const dir = process.env.E2E_ARTIFACTS_DIR;
  if (!dir) throw new Error('E2E_ARTIFACTS_DIR is not set by the wdio config');
  await browser.saveScreenshot(path.join(dir, `${name}.png`));
}
