import path from 'node:path';
import fs from 'node:fs';
import type { Options } from '@wdio/types';

/** Where screenshots go: artifacts/<gate>/ at the repository root. */
export function artifactsDir(gate: string): string {
  const dir = path.resolve(import.meta.dirname, '..', '..', 'artifacts', gate);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Settings shared by every platform config. Only the connection differs. */
export const shared: Partial<Options.Testrunner> = {
  specs: [process.env.E2E_SPEC ?? './specs/**/*.e2e.ts'],
  maxInstances: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
  logLevel: 'warn',
  waitforTimeout: 20_000,
};
