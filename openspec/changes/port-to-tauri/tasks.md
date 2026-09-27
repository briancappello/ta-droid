Tasks marked **Operator** need the human. They are grouped into the start batch (section 0) and the end batch (section 7). The agent runs everything in between unattended, following design.md D13. Each task's verification must pass before it is checked off. The evidence goes in `evidence.md`.

## 0. Start batch (operator)

- [x] 0.1 Operator: rebuild the pmOS image with a throwaway password (`pmbootstrap install --password <pw>`, then `pmbootstrap export`) and give the password to the agent. Verify: the agent logs in over ssh to the booted VM (task 2.4) with that password.
- [x] 0.2 Operator: confirm the base branch for `feat/tauri-port`. Decision: merge `feat/marketstore-direct-data` into `main` (fast-forward to `32bc933`), then branch `feat/tauri-port` from `main`. Verify: the branch exists at the confirmed base.

## 1. Toolchain and baseline

- [x] 1.1 Create `feat/tauri-port`. Add Rust to `.mise.toml`, install the Rust targets `aarch64-linux-android` and `x86_64-linux-android`, and install the Tauri CLI and `tauri-driver`. Verify: the versions of each tool are recorded in `evidence.md`.
- [x] 1.2 Record the baseline: `pnpm test` pass, fail, and skip counts on the React Native code. Verify: the counts are in `evidence.md`.
- [x] 1.3 Commit a provisioning test vector: a blob and passphrase made by `scripts/encrypt-credentials.mjs` from dummy credentials, stored under `src-tauri/crates/provision/tests/fixtures/`. Verify: the Node script decrypts the fixture back to the dummy credentials.
- [x] 1.4 Scaffold the `src-tauri/` workspace (D2) and the Vite React TypeScript app in `ui/`, with identifier `com.briancappello.ta-droid` (Tauri maps it to the Android package `com.briancappello.ta_droid`) and a 412×915 development window. Verify: `cargo tauri build --debug` succeeds and the binary starts.
- [x] 1.5 Add the `mise` tasks `verify` (G1–G4) and `verify:slow` (G5–G6), with G1 and G2 wired to the empty workspace. Verify: `mise run verify` exits 0 with the gates that exist so far.

## 2. Desktop verification harness

- [x] 2.1 Create the `fake-backends` crate. It serves `/v1/health` and `/health` and writes a JSON request log. Verify: `cargo test -p fake-backends` passes, including a test that reads back the request log.
- [x] 2.2 Build G3. A script starts `weston --backend=headless`, records its PID in a pidfile, and runs `tauri-driver` with a WebdriverIO smoke spec: the app launches, and a screenshot goes to `artifacts/g3/`. Verify: `mise run e2e:desktop` passes twice in a row, and no weston or driver process is left afterwards (checked by pidfile).
- [x] 2.3 Add the `talib-sys` crate: vendor the pinned TA-Lib 0.6.x source with its checksum and build it with `cc`, with an SMA smoke test. Verify: the SMA test passes on `x86_64-unknown-linux-gnu`. (Cross targets are checked in 6.4.)

## 3. Rust core (`crates/core`, `crates/provision`)

Port each React Native test to Rust with the same cases. The source test files are named in brackets.

- [x] 3.1 Build-time config (D8): the `app-config.toml` schema, embedding in `build.rs`, `config/app-config.example.toml`, and the `e2e` profile behind a feature. Verify: unit tests cover a valid config, a malformed account list (which gives an empty list), and the missing-blob case.
- [x] 3.2 The `SecretStore` trait with memory, file (`e2e` feature), and Secret Service implementations. (The Android store comes in 6.3.) Verify: shared trait tests pass for memory and file, and the Secret Service test passes under `dbus-run-session` with `gnome-keyring-daemon`, or is recorded as skipped with the reason.
- [x] 3.3 Blob format and crypto (D6), with the `ta-provision` encrypt CLI and the `backends` section. Verify: the 1.3 Node fixture decrypts, a CLI round trip works, a wrong passphrase fails, and the fingerprint matches the Node value [`encryptCredentials`, `secretsBackend`].
- [x] 3.4 Provisioning flow: the fingerprint decision, saving secrets before the fingerprint, and the `bad-passphrase` and `save-failed` outcomes. Verify: the ported cases pass, plus a test that a failed save leaves no stored fingerprint and a test that no log line contains a secret [`provisioning`, `accountContext`].
- [x] 3.5 Accounts: loading from metadata and secrets, `AccountView` with `key_last4` only, and active account persistence with fallback. Verify: the ported cases pass, plus a test that serialized `AccountView` has no key or secret [`accounts`, `accountContext`].
- [x] 3.6 Profiles and health: profile selection, persistence, and fallback; headers taken from secrets; an extra CA; plain `http`; health probes that never fail. Verify: `wiremock` tests show the headers on REST calls, a custom-CA TLS server accepted, a down backend reported as `down` [`backendContext`, `marketstore` health, `techan` health].
- [x] 3.7 Indicators through `talib-sys`: the column order, null warmup, and BBANDS middle band reported as `sma20`. Verify: the ported cases pass, and the parity tests pass as the indicators spec states (same input: 1e-9 on every column; fa-techan stored output: 1e-9 for SMA and Bollinger, 1e-6 for MACD and RSI) [`indicators`, `indicatorCalibration`].
- [x] 3.8 MarketStore REST: the frequency map, history with the 200-bar warmup, quotes, watchlists with labels and row rules, and the error messages. Verify: the ported cases pass [`marketstore`, `apiHistory`, `apiQuotes`, `watchlists`].
- [x] 3.9 MarketStore stream (D4): one socket, a reference-counted union, the drop rules, backoff with reset, resubscribe on reopen, and profile headers on the handshake. Verify: the 8 ported cases pass against an in-process WS server, plus a handshake-header test [`marketstoreStream`].
- [x] 3.10 Alpaca driver: the auth headers, no redirects, the 30 s timeout, no order retry, the `ta-` client order id, 204 handling, and the error mapping. Verify: the ported cases pass [`alpaca`, `alpacaDriver`, `broker`].
- [x] 3.11 Order validation and request building. Verify: the 9 ported cases pass [`orderValidation`].
- [x] 3.12 Flatten: finding the legs, parallel submit, per-leg results, and retrying only the legs that failed. Verify: the ported cases pass, plus a new test that a retry after a partial failure sends only the failed legs [`flatten`].
- [x] 3.13 fa-techan client and strategy tagging: safe empty results and the case-sensitive join. Verify: the ported cases pass, plus a test that a 500, a timeout, and a malformed body each give `[]` [`techan`, `strategyTagger`].
- [x] 3.14 Complete `fake-backends`: MarketStore fixtures (bars, quotes, watchlists, WS bars and watchlist updates), fa-techan strategies, an Alpaca paper API, and scripted failures (down, 401, 429, 422, slow). Verify: `cargo test -p fake-backends` covers each failure mode.

## 4. Tauri command layer

- [x] 4.1 Add the app state and the commands for provisioning, accounts, profiles, and health, with `ts-rs` type generation and a staleness check in G2. Verify: command tests pass, and changing a DTO without regenerating fails `mise run verify`.
- [x] 4.2 Add the market-data commands: history, quotes, and watchlists. Bar and watchlist streams go over `Channel`s, and the backend unsubscribes when a channel is dropped. Verify: an integration test against `fake-backends` shows the subscribe set shrinking after a channel is dropped.
- [x] 4.3 Add the trading commands: positions, orders, validate, place, flatten legs, and submit flatten. Verify: integration tests against the `fake-backends` Alpaca API pass, including the 401, 429, 422, and timeout messages.
- [x] 4.4 Lock down the WebView (D10): the CSP, the capability list, and no UI network plugins. Verify: a G3 spec shows that a UI `fetch` to an external URL is blocked.
- [x] 4.5 Add the secret-leak guard: in `e2e` builds, IPC responses and events are scanned for the values provisioned into `fake-backends`. Verify: a deliberately leaking test command fails the guard in G3, and the command is then removed.

## 5. UI (`ui/`)

Port each React Native component test to vitest with the same cases. The source test files are named in brackets. Each screen task also adds its end-to-end spec to the shared suite and must pass G3. G4 runs the same specs in section 6.

- [x] 5.1 Build the app shell: the router, drawer, and stacks; the header with the MS/FA pill; safe areas; and in-app back navigation through history. Verify: the vitest cases pass, and an end-to-end spec opens every drawer item and goes back through history on G3 [`appHeader`, `App`].
- [x] 5.2 Build the provisioning gate: the prompt, the busy state while Argon2 runs, and the two failure messages. Verify: an end-to-end spec provisions with the right passphrase and then restarts without a prompt, and a wrong passphrase shows "Incorrect passphrase.".
- [x] 5.3 Build Settings, Accounts, and the Backend profile picker. Verify: the ported cases pass, and an end-to-end spec switches profile, restarts, and still has the new profile [`settingsScreen`, `accountsScreen`, `accountPicker`].
- [x] 5.4 Build the Watchlists screen with streaming updates. Verify: the ported cases pass, and an end-to-end spec shows rows replaced after a `watchlist_update` from `fake-backends` [`watchlistsScreen`, `format`].
- [x] 5.5 Build the chart (D9): move `chartTime` and `format` over, the three synced panes, ranges and frequencies, the header, the held-symbol strip, and the loading and empty states. Verify: the ported cases pass, and end-to-end screenshots exist for 1D, 5D, 1Y, and 5Y [`chartTime`, `chartScreen`].
- [x] 5.6 Add live bars to the chart: resubscribe on symbol or frequency change, update or append a candle, update the last price. Verify: an end-to-end spec pushes a bar from `fake-backends` and sees the last price change.
- [ ] 5.7 Build Positions and Orders with the strategy filter. Verify: the ported cases pass, and an end-to-end spec with one failing account shows the error banner [`positionsScreen`, `ordersScreen`, `strategyFilter`, `book`].
- [ ] 5.8 Build order entry with review and submit (no double submit). Verify: the ported cases pass, and an end-to-end spec places a limit order that `fake-backends` records exactly once [`orderEntryScreen`, `orderValidation`].
- [ ] 5.9 Build the Exit screen. Verify: the ported cases pass, and an end-to-end spec with one failing leg retries and sends only that leg [`exitScreen`].
- [ ] 5.10 Desktop regression: `mise run verify` (G1–G3). Verify: all gates pass, and the ported test count is at least the 1.2 baseline, with any missing cases explained in `evidence.md`.

## 6. Mobile

The app is complete on the desktop before this section starts. `mise run verify:mobile` runs G4 and G5.

- [x] 6.1 Build G4. A script boots `Pixel_8` headless (PID recorded), waits for `sys.boot_completed`, installs the debug x86_64 APK, applies `adb reverse` for `fake-backends`, and runs the same smoke spec through Appium UiAutomator2 in the WEBVIEW context. Verify: `mise run e2e:android` passes, a screenshot is in `artifacts/g4/`, and the emulator stops on exit. (Built early; it now runs under `verify:mobile`, not on every task.)
- [x] 6.2 First pmOS VM attempt: `qemu-aarch64` under TCG. It works, but it is too slow (each emulated arm64 build takes 20–35 min), so it is superseded by 6.5. The findings (greetd autologin, pixman renderer, `phosh --unlocked`, clean poweroff) carry over and are in `evidence.md` 2.4.
- [ ] 6.3 Android secret store spike (D5). Try a Rust Keystore store first, and fall back to a Kotlin Tauri plugin. Implement set, get, and delete. Verify: a G4 spec writes a value, restarts the app, and reads the same value back. The choice and the reason are recorded in `evidence.md`.
- [ ] 6.4 Cross-build `talib-sys` and the app for `aarch64-linux-android` and `x86_64-linux-android`. Verify: `cargo tauri android build --debug` succeeds for both targets.
- [ ] 6.5 Operator: build a `qemu-amd64` + Phosh image (`pmbootstrap init` with device `qemu-amd64`, then `pmbootstrap install --password pmos-vm` and `pmbootstrap export`). The agent then adapts `e2e/pmos/` (KVM, no firmware padding) and reruns the one-time setup. Verify: the VM boots under KVM, `uname -m` prints `x86_64`, and the unlocked Phosh screenshot is in `artifacts/g5/`.
- [ ] 6.6 Build the x86_64 musl app in a rootless x86_64 Alpine container that matches the VM's release, and add G5 (install in the VM, run it in the Phosh session, take a screenshot). Verify: `mise run e2e:pmos` passes and the screenshot shows the app.
- [ ] 6.7 Mobile regression: run the full end-to-end suite on G4, plus the Android back button spec, and the G5 smoke. Verify: `mise run verify:mobile` passes, with screenshots in `artifacts/g4` and `artifacts/g5`.

## 7. Packaging

- [ ] 7.1 Android: identifier, minimum SDK 24, icons, and unsigned release-shaped builds for arm64 and x86_64. Verify: both builds succeed, and G4 passes on the release-shaped x86_64 build.
- [ ] 7.2 postmarketOS: the `APKBUILD` and the desktop entry, with the window maximized on phone shells. The package builds for x86_64 (the VM) and, once, for aarch64 (the OnePlus 7 Pro) in an emulated arm64 container. Verify: G5 installs the x86_64 package, provisions through the UI with the `e2e` profile, restarts, and loads the accounts from the Secret Service without a prompt, with a screenshot.
- [ ] 7.3 Droidian: an arm64 `.deb` bundle, built once in an emulated arm64 Debian container. Verify: the build produces it and `dpkg-deb --info` shows the identifier and the dependencies.

## 8. End batch (operator, then agent)

- [ ] 8.1 Operator: write the real `config/app-config.toml`, including the account metadata, the `local` and `taichi` profiles (with a CA path if either uses a private CA), and a `remote` placeholder. Create the real blob with `ta-provision`. Verify: the agent builds with it, and the G3 smoke passes against the `local` profile.
- [ ] 8.2 Operator: create the Android release signing key and store its passwords. The agent then wires signing through environment variables that never enter the repo. Verify: `apksigner verify` passes on the signed arm64 APK.
- [ ] 8.3 Operator: install the signed APK on the Pixel 8 and the OnePlus 7 Pro and follow `artifacts/acceptance-checklist.md` (written by the agent). The checklist covers provisioning, the watchlist and chart streams on `local` and `taichi`, a paper order, a paper flatten, touch and scroll feel, safe areas, and the back button. Verify: the checklist is signed off, with any issues filed as new tasks.
- [ ] 8.4 Operator (optional): flash postmarketOS on the OnePlus 7 Pro and run the same checklist with the pmOS package. Verify: the checklist is signed off or the device limits are recorded in `evidence.md`.
- [ ] 8.5 Operator: review the screenshots in `artifacts/g3`, `g4`, and `g5`. Verify: approval is recorded in `evidence.md`.
- [ ] 8.6 Cutover: delete `android/`, the React Native files and dependencies, Metro, Babel, Jest, `scripts/dev.sh`, `scripts/bundle-lightweight-charts.js`, `scripts/encrypt-credentials.mjs`, `src/`, `__tests__/`, and `.env*`. Update the README and `.mise.toml`. Verify: `mise run verify` passes and `rg -l "react-native"` finds nothing outside `openspec/` and `docs/`.
- [ ] 8.7 Archive the change with `openspec archive port-to-tauri`. Verify: `openspec validate --specs --strict` passes and `openspec/specs/` contains the eight capabilities.
