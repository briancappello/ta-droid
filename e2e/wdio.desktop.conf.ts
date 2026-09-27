import path from 'node:path';
import type { Options } from '@wdio/types';
import { artifactsDir, shared } from './support/common.ts';

// tauri-driver (started by scripts/e2e-desktop.sh) proxies to WebKitWebDriver.
process.env.E2E_ARTIFACTS_DIR = artifactsDir('g3');
process.env.E2E_PLATFORM = 'desktop';
process.env.E2E_FAKE_URL ??= `http://${process.env.FAKE_ADDR ?? '127.0.0.1:8787'}`;

const application =
  process.env.TA_DROID_APP ??
  path.resolve(import.meta.dirname, '..', 'src-tauri', 'target', 'debug', 'ta-droid');

export const config: Options.Testrunner = {
  ...shared,
  runner: 'local',
  hostname: '127.0.0.1',
  port: Number(process.env.TAURI_DRIVER_PORT ?? 4444),
  capabilities: [{
      browserName: 'wry',
      // WebKitWebDriver has no WebDriver BiDi; WebdriverIO 9 asks for it by default.
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': { application },
    } as WebdriverIO.Capabilities],
} as Options.Testrunner;
