## Why

FinCharts is a React Native app that runs only on Android. We also want it on Linux phones (postmarketOS and Droidian, with Phosh or Plasma Mobile). No maintained React Native renderer exists for Linux. Tauri v2 runs one codebase on Android and Linux, and it gives us a single Rust backend.

The move also fixes a security problem. Today the broker API key and secret are held in JavaScript memory (`Account` in `src/alpaca.ts`). In a Tauri app all JavaScript runs in a WebView. The port moves every secret and every network call into Rust, so the UI never holds a credential.

There is no backwards compatibility requirement. Nothing is published, and no stored data needs to be migrated.

## What Changes

- **BREAKING: new application shell.** Tauri v2 replaces React Native. The UI is React with TypeScript, rendered to the DOM. The backend is Rust. One codebase builds for Android (arm64 and x86_64) and Linux (aarch64 and x86_64).
- **BREAKING: new application identifier.** `com.briancappello.ta_droid` replaces `com.fincharts` on Android. Tauri rejects underscores in identifiers, so the Tauri and Linux identifier is `com.briancappello.ta-droid`, which Tauri maps to the Android package name.
- **Rust owns all I/O.** Broker (Alpaca), MarketStore REST and WebSocket, fa-techan, the secret store, and provisioning move to Rust. The UI calls typed commands and receives data. It never receives a key, a secret, or an auth token.
- **Indicators come from TA-Lib.** fa-techan uses TA-Lib, and the app now links the same C library. This replaces the `trading-signals` approximation, so the app matches fa-techan exactly instead of within a tolerance.
- **BREAKING: backend profiles replace build-time URLs.** A profile holds the MarketStore URL, the fa-techan URL, and optional auth headers. The user selects the active profile at runtime, and the selection persists. Planned profiles:
  - `local`: the localhost MarketStore replica.
  - `taichi`: taichi's MarketStore, the source of truth.
  - `remote`: the future homelab path through a Cloudflare Tunnel or Tailscale.

  The Backend settings screen, whose Save button does nothing today, becomes the profile picker.
- **BREAKING: provisioning blob gains backend secrets.** Profile auth tokens (for example Cloudflare Access service tokens) are provisioned the same way as broker credentials. The existing encrypted-blob and fingerprint model is kept.
- **Chart without an embedded WebView.** The chart library renders straight into the page. The inline HTML bridge and the vendored bundle are removed.
- **Behavior fixes found during the inventory:**
  - "Exit all" retries only the legs that failed. Today a retry resubmits every leg, which can duplicate orders.
  - Provisioning shows a separate message when saving to the secret store fails. Today it shows "Incorrect passphrase." for both failures.
- **Hardware-free verification.** Automated gates run on this workstation only: desktop end-to-end tests on the Linux engine, an Android emulator, and a postmarketOS QEMU image. Physical phones are used only in a final acceptance batch.
- **Removal.** When the port is accepted, the React Native project, Metro, Babel, Jest, and the RN dependencies are deleted.

## Capabilities

### New Capabilities

No specs exist yet. These capture the current app's behavior as the port contract, including the changes listed above.

- `credential-provisioning`: Decrypt the shipped credential blob with a passphrase, store the secrets in the platform secret store, and skip the prompt when the stored fingerprint matches.
- `accounts`: Build the account list from the configured metadata and the provisioned credentials, including the active account and the paper or live distinction.
- `backend-profiles`: Select and persist backend profiles, probe health, and apply the degraded-mode rules for MarketStore and fa-techan.
- `market-data`: Bars, quotes, watchlists, and live streaming from MarketStore.
- `indicators`: The indicator columns and their parameters, with parity against fa-techan.
- `charting`: The chart screen, including ranges, frequencies, panes, time handling, the header, and live bars.
- `trading`: Positions, orders, order entry, the exit and flatten flow, and strategy tagging.
- `app-shell`: Navigation, the header, settings, supported platforms, and the rule that secrets never reach the UI.

### Modified Capabilities

None.

## Impact

- **Code:**
  - Everything under `src/`, plus `App.tsx` and `index.js`, is rewritten.
  - New `src-tauri/` (the Rust workspace) and a Vite frontend.
  - Deleted: `android/` (the React Native project), `metro.config.js`, `babel.config.js`, `jest.*`, `scripts/dev.sh`, `scripts/bundle-lightweight-charts.js`, and `src/vendor/`.
- **Dependencies:**
  - Removed: all `react-native*` packages, `@react-navigation/*`, and `trading-signals`.
  - Added: Tauri v2, Vite, a web router, vitest, and a vendored TA-Lib C source.
  - The Rust crates are listed in design.md.
- **Toolchain:**
  - Rust with the Android and aarch64 targets, the Android NDK (already installed), and `tauri-driver`.
  - `.mise.toml` gains Rust.
- **Tests:** The 141 existing Jest tests are the behavioral spec. Logic tests move to `cargo test`, and UI tests move to vitest. New end-to-end suites cover desktop, the Android emulator, and postmarketOS under QEMU.
- **External systems:** None change. The MarketStore, fa-techan, and Alpaca APIs are used as they are today. `docs/superpowers/contracts/fe-fa-techan-contract.md` is still in force, except that watchlists now come from MarketStore (already true in the code).
