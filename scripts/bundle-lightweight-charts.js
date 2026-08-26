// Bundles the lightweight-charts standalone production build into a TS string
// module so it can be inlined into the Chart WebView HTML and work fully
// offline (no CDN / unpkg dependency).
//
// Run after installing or upgrading `lightweight-charts`:
//   node scripts/bundle-lightweight-charts.js

const fs = require('fs');
const path = require('path');

const SRC = path.join(
  __dirname,
  '..',
  'node_modules',
  'lightweight-charts',
  'dist',
  'lightweight-charts.standalone.production.js',
);
const OUT_DIR = path.join(__dirname, '..', 'src', 'vendor');
const OUT = path.join(OUT_DIR, 'lightweightCharts.ts');

const src = fs.readFileSync(SRC, 'utf8');

const versionMatch = src.match(/Lightweight Charts™ v([\d.]+)/);
const version = versionMatch ? versionMatch[1] : 'unknown';

const header =
  '// AUTO-GENERATED. Do not edit by hand.\n' +
  `// lightweight-charts standalone production build v${version}, bundled for\n` +
  '// offline WebView use. Sets window.LightweightCharts when evaluated.\n' +
  '// Regenerate with: node scripts/bundle-lightweight-charts.js\n\n';

const out =
  header + 'export const LIGHTWEIGHT_CHARTS_JS = ' + JSON.stringify(src) + ';\n';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, out);

console.log(
  `Wrote ${OUT} (lightweight-charts v${version}, ${(out.length / 1024).toFixed(
    0,
  )} KB)`,
);
