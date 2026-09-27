import path from 'node:path';
import type { Options } from '@wdio/types';
import { artifactsDir, shared } from './support/common.ts';

// Appium (started by e2e/run-android.sh) drives the emulator; the specs run in
// the app's WebView context, so they are the same specs as on desktop.
process.env.E2E_ARTIFACTS_DIR = artifactsDir('g4');
process.env.E2E_PLATFORM = 'android';
process.env.E2E_FAKE_URL ??= `http://127.0.0.1:${process.env.FAKE_HOST_PORT ?? '8788'}`;

const app =
  process.env.TA_DROID_APK ??
  path.resolve(
    import.meta.dirname,
    '..',
    'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk',
  );

export const config: Options.Testrunner = {
  ...shared,
  runner: 'local',
  hostname: '127.0.0.1',
  port: Number(process.env.APPIUM_PORT ?? 4723),
  path: '/',
  capabilities: [
    {
      platformName: 'Android',
      'wdio:enforceWebDriverClassic': true,
      'appium:automationName': 'UiAutomator2',
      'appium:udid': process.env.ANDROID_SERIAL ?? 'emulator-5580',
      'appium:app': app,
      'appium:appPackage': 'com.briancappello.ta_droid',
      'appium:appActivity': '.MainActivity',
      'appium:autoWebview': true,
      'appium:chromedriverAutodownload': true,
      'appium:newCommandTimeout': 300,
      'appium:uiautomator2ServerInstallTimeout': 120_000,
      'appium:adbExecTimeout': 120_000,
    } as WebdriverIO.Capabilities,
  ],
} as Options.Testrunner;
