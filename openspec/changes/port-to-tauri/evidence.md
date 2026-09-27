# Evidence: port-to-tauri

## 0. Start batch

### 0.1 pmOS VM access (2026-09-27)
- Workstation prerequisite: RLIMIT_MEMLOCK was 8 MiB (systemd user manager default), so QEMU 11 failed with `Failed to initialize io_uring: Cannot allocate memory`. The operator raised it to 1 GiB (`user@.service.d/memlock.conf` and `limits.d/90-memlock.conf`). `ulimit -l` prints `1048576`.
- Image: postmarketOS v26.06, `qemu-aarch64`, Phosh, copied to `~/.local/share/ta-droid/pmos/` with edk2 firmware (`QEMU_EFI.fd`, `vars.fd`, both padded to 64 MiB).
- Boot: `qemu-system-aarch64 -machine virt -cpu max -smp 4 -m 4096`, TCG, user networking with ssh forwarded to `127.0.0.1:2222`. ssh was reachable about 40 s after launch.
- Access: the throwaway password worked once. A VM-only key (`~/.local/share/ta-droid/pmos/id_ed25519`) is now in `authorized_keys`, and batch-mode ssh works without a password.
- Output: `uname -m` → `aarch64`. `phoc` runs under greetd, but the user session is not logged in to Phosh yet. Task 2.4 handles autologin and the screenshot.

### 0.2 Base branch
- `main` fast-forwarded to `32bc933` (`feat/marketstore-direct-data`). `feat/tauri-port` was created from `main`.

## 1. Toolchain and baseline

### 1.1 Toolchain
- `.mise.toml`: rust 1.96.0 with clippy, rustfmt, and the targets `aarch64-linux-android`, `x86_64-linux-android`, `aarch64-unknown-linux-musl`. `ANDROID_HOME` and `NDK_HOME` (NDK 27.1.12297006) are set in `[env]`.
- Installed: `tauri-cli 2.12.0` (`cargo tauri`) and `tauri-driver 2.1.0`, both with `cargo install --locked`.
- Existing: WebKitWebDriver (webkit2gtk-4.1 2.52.6), node v22.23.2, pnpm 11.20.0, OpenJDK 21.0.2, Android emulator 36.5.10, adb 1.0.41, platforms android-36 and android-36.1, build-tools 35.0.0 through 37.0.0.

### 1.2 React Native baseline (commit `612bee7`)
- `pnpm test`: 35 suites, **141 passed**, 0 failed, 0 skipped (jest `--json`). The earlier estimate of 147 was wrong; proposal.md and design.md now say 141.
- Per file: accountContext 3, accountPicker 3, accountsScreen 3, accounts 3, alpacaDriver 8, alpaca 4, apiHistory 4, apiQuotes 3, appHeader 2, App 1, backendContext 4, book 4, broker 3, chartScreen 6, chartTime 8, encryptCredentials 2, exitScreen 1, flatten 4, format 4, indicatorCalibration 4, indicators 5, marketstoreStream 8, marketstore 9, orderEntryScreen 2, ordersScreen 3, orderValidation 9, positionsScreen 4, provisioning 6, secretsBackend 2, settingsScreen 1, strategyFilter 7, strategyTagger 1, techan 2, watchlistsScreen 2, watchlists 6.

### 1.3 Provisioning test vector
- `src-tauri/crates/provision/tests/fixtures/`: `node-blob.json`, `node-plaintext.json`, `node-passphrase.txt`, and the generator `make-node-vector.mjs`, which calls `scripts/encrypt-credentials.mjs`.
- The plaintext already uses the new format (`credentials` plus `backends`) with dummy values. The Node encryptor stringifies any JSON value, so the vector covers the format the Rust side will read.
- Check (libsodium-wrappers-sumo, separate script): plaintext match `true`, fingerprint `sha256(ciphertext base64)` match `true`, `OPSLIMIT_MODERATE=3`, `MEMLIMIT_MODERATE=268435456`.

### 1.4 Scaffold
- Identifier: Tauri's config check rejects `_` ("only alphanumeric characters, hyphens, and periods"). tauri-cli 2.12.0 derives the Android package with `identifier.replace('-', "_")` (`src/mobile/mod.rs:603`), so `tauri.conf.json` uses `com.briancappello.ta-droid` and Android gets `com.briancappello.ta_droid`. The proposal and the app-shell spec now say this. Task 2.3 confirms the Android side.
- `ui/`: its own pnpm root (`ui/pnpm-workspace.yaml`), with Vite 8.3.1, React 19.3.0, TypeScript 6.0.3 (typescript-eslint 8.70 does not support TS 7), vitest 5.0.2, and lightweight-charts pinned at 4.2.3. `pnpm typecheck`, `pnpm lint`, `pnpm test` (1 passed), and `vite build` all pass.
- `src-tauri/`: a workspace whose root is the app crate `ta-droid` (lib `ta_droid_lib`, mobile entry point), with tauri 2 and an `e2e` feature. The CSP is set as in D10, and the capability allows only `core:default`. Icons come from `icons/source.svg` via `cargo tauri icon`; the iOS and Windows store icons were removed.
- Root React Native tooling ignores `ui/`, `e2e/`, and `src-tauri/` (jest `testPathIgnorePatterns`, the tsconfig `exclude`, `.eslintignore`). jest lists only `__tests__/`, and the root `tsc` passes. The root lint gives 0 errors and 6 warnings, all in untouched RN files.
- `cargo tauri build --debug`: built `target/debug/ta-droid` and a `.deb` in 44 s. Started under `weston --backend=headless` with `GDK_BACKEND=wayland`, it was still alive after 6 s and was then stopped by PID. The only log noise is GDK seat warnings, because headless weston has no seat.

### 1.5 Gate wiring
- `.mise.toml` tasks: `setup:ui`, `build:ui`, `verify:core` (G1: `cargo fmt --check`, `clippy -D warnings`, `cargo test` for the workspace with all features), `verify:ui` (G2: typecheck, lint, vitest), `verify` (currently G1 and G2), and `verify:slow` (placeholder). G3–G6 are added by tasks 2.2–2.5.
- `verify:core` depends on `build:ui`, because `tauri::generate_context!` needs `ui/dist` at compile time.
- `mise run verify`: exit 0.

## 2. Verification harness and platform spikes

### 2.1 fake-backends
- `src-tauri/crates/fake-backends` (axum 0.8): a lib plus a `fake-backends [--addr] [--log]` binary. It is a single listener with the prefixes `/marketstore`, `/fatechan`, `/alpaca`, and `/__control`, so one `adb reverse` or `ssh -R` tunnel exposes all of it.
- Requests are recorded with method, path, query, and headers, both in memory (`GET`/`DELETE /__control/requests`) and optionally as JSONL. Control calls are not recorded.
- `cargo test -p fake-backends`: 3 passed (both health endpoints return 200; the log with headers and query can be read back and cleared; the JSONL file gets one line per request, including a 404). `mise run verify:core` passes.

### 2.2 G3 desktop end-to-end
- `e2e/`: its own pnpm root with WebdriverIO 9.32 (mocha, spec reporter). The shared settings live in `support/common.ts`, `wdio.desktop.conf.ts` holds the desktop connection, and `specs/smoke.e2e.ts` checks the app root and saves a screenshot.
- `e2e/run-desktop.sh`: builds with `--features e2e`, then starts `weston --backend=headless` (per-run socket), `fake-backends` (JSONL request log), and `tauri-driver`. Each gets a pidfile under `artifacts/g3/run/`, and an EXIT/INT/TERM trap stops them.
- Gotcha: WebdriverIO 9 asks for WebDriver BiDi by default, and WebKitWebDriver rejects that with "Failed to match capabilities". The fix is `'wdio:enforceWebDriverClassic': true`.
- Result: `mise run e2e:desktop` passed twice in a row (exit 0, 1 passing each). Afterwards there were no pidfiles left and no `ta-droid`, `weston`, `tauri-driver`, `WebKitWebDriver`, or `fake-backends` processes (`pgrep -x`). The screenshot `artifacts/g3/smoke-launch.png` is 412×915 and shows the app root.
- `mise run verify` now includes G3 and exits 0.

### 2.3 G4 Android end-to-end
- `cargo tauri android init --ci` generated `src-tauri/gen/android` (committed). It has `namespace` and `applicationId` `com.briancappello.ta_droid`, `minSdk 24`, and `compileSdk`/`targetSdk` 37. The identifier mapping from 1.4 is confirmed: `aapt2 dump badging` reports `package: name='com.briancappello.ta_droid'`. The init also installed the armv7 and i686 Rust targets, which are not used.
- The debug x86_64 APK (`--features e2e`) builds as `app-universal-debug.apk`.
- Appium 3.8.0 is an e2e dev dependency. The UiAutomator2 driver 8.7.0 lives in `e2e/.appium` (gitignored), and `setup:e2e` installs it when it is missing. `wdio.android.conf.ts` uses `autoWebview` and `chromedriverAutodownload` (server flag `--allow-insecure uiautomator2:chromedriver_autodownload`), so `specs/` is shared with G3 unchanged.
- `e2e/run-android.sh`:
  - Boots `Pixel_8` with `-no-window -no-audio -no-snapshot -gpu swiftshader_indirect` on console port 5580 (serial `emulator-5580`, so it never touches a real device) and waits for `sys.boot_completed`.
  - Maps device port 8787 to host port 8788 with `adb reverse`, which lets G3 and G4 run in parallel.
  - Starts Appium. Pidfiles plus `adb emu kill` clean up on exit.
- `UI_PREBUILT=1` (set by the mise tasks) skips Tauri's `beforeBuildCommand`, so parallel gates never write `ui/dist` at the same time.
- Results: `mise run e2e:android` exits 0 with 1 passing, and `artifacts/g4/smoke-launch.png` shows the app root in the Android WebView. Afterwards `adb devices` is empty and no pidfiles remain. `mise run verify` (G1–G4 in parallel) exits 0.

### 2.4 G5 postmarketOS VM
- `e2e/pmos/vm.sh` supports `start`, `stop`, `ssh`, `shot`, and `status`. State lives in `~/.local/share/ta-droid/pmos/`. The VM runs under `setsid` so it outlives the tool shell, with its PID in `qemu.pid`. `stop` powers off cleanly (`sudo poweroff`) and kills only as a fallback.
- Gotcha: killing qemu without a clean poweroff lost the `authorized_keys` written in 0.1, because it had not been flushed. The key was reinstalled with the throwaway password and `sync`. `stop` now always powers off cleanly.
- One manual step, over the throwaway password: `/etc/sudoers.d/90-ta-droid-vm` gives the test user passwordless sudo inside the disposable VM. On the workstation, the agent still has no root.
- `e2e/pmos/provision-vm.sh` is idempotent and does the rest:
  - greetd `initial_session` logs the test user into Phosh (config `/etc/greetd/ta-droid.toml`, ExecStart drop-in over pmOS's phrog greeter).
  - `WLR_RENDERER=pixman`. With EGL, phoc died at early boot ("virtio_gpu: driver missing", then `/dev/dri/card0: Permission denied`, then "Could not create renderer"), and the session fell back to the greeter.
  - A `mobi.phosh.Shell` drop-in adds `--unlocked` (gsettings `lock-enabled=false` was not enough), and the screen lock and idle are disabled.
  - It installs `grim` and `jq`, then reboots, because greetd runs `initial_session` once per boot.
- Result: two cold boots in a row each had one `brian` session on `seat0` and `uname -m` → `aarch64`. Batch-mode ssh uses the VM-only key. `artifacts/g5/phosh-home.png` (720×1440) shows the unlocked Phosh app grid.

### Re-plan: desktop first, pmOS on amd64 (2026-09-27)
- The operator redirected the work. The port runs on the Linux desktop first, and the mobile gates follow. G4 and the pmOS VM had been built before any app code existed.
- Measured cost of the arm64 path (old task 2.5):
  - The aarch64 musl release build in emulated Alpine took **33 min 52 s**. It ran under Phosh in the TCG VM (screenshot was taken).
  - The arm64 `.deb` in emulated Debian took **20 min 50 s**.
  - The TCG VM also needed its disk grown from 3 GiB to 10 GiB.
  - That work (`packaging/builders/*`, `packaging/build-linux-arm64.sh`, `e2e/run-pmos.sh`, `vm.sh app-start`/`app-stop`) is parked in `git stash` ("parked: arm64 G5/G6 builders"). Task 7.x reuses it for the one-time phone packages.
- Changes to tasks.md:
  - Section 2 is desktop-only.
  - Old 2.3 is now 6.1, old 2.4 is 6.2 (superseded), old 2.6 is 6.3, and old 2.7 is 2.3 (host target only; the cross targets moved to 6.4).
  - The new 6.5 moves the pmOS VM to `qemu-amd64` with KVM (the operator rebuilds the image), and 6.6 adds the x86_64 musl build and G5.
  - Packaging is now section 7 and the end batch section 8.
- design.md D11 and the Risks section are updated to match.
- `mise run verify` is now G1–G3 only and takes 12 s. `verify:mobile` holds G4.

### 2.3 talib-sys
- Pinned TA-Lib C **0.6.4**, not the latest (0.8.1). fa-techan's `uv.lock` pins the Python `ta-lib` 0.6.8 wheel, which is built on C 0.6.4. fa-techan calls `SMA(100/200)`, `BBANDS(close, timeperiod=20)` (defaults: 2/2, SMA), `MACD(close)` (12/26/9), and `RSI(close)` (14) (`app/api/v1/finance/history.py:49-57`).
- Tarball sha256 `aa04066d…a3ae86`. The vendored files (`include/`, `src/ta_common`, `src/ta_func`, 3.8 MB), the BSD license, and `VENDOR.md` are in `src-tauri/crates/talib-sys/vendor/ta-lib-0.6.4/`. They are compiled with `cc`, with upstream warnings muted.
- The safe wrappers `sma`, `bbands` (SMA type), `macd`, and `rsi` return input-aligned `Vec<Option<f64>>`. `TA_Initialize` runs once, the way the Python binding does on import.
- `cargo test -p talib-sys`: 5 passed:
  - hand-computed SMA with null warmup;
  - empty and too-short input;
  - BBANDS population σ (upper 9, lower 1 for mean 5, σ 2);
  - MACD lookback 33 with hist = macd − signal, and RSI lookback 14 with values in range;
  - invalid period is an error.
- `mise run verify`: exit 0.

## 3. Rust core

### 3.1 Build-time config
- New crate `ta-core` (`src-tauri/crates/core`) with a `config` module. `AppConfig::parse` handles accounts, profiles (`name`, `marketstore_url`, `fatechan_url`, `auth_headers`, optional `ca_cert_pem`), broker host overrides with production defaults, and the optional `credentials_blob`. Accounts and the blob are lenient, like the RN app. Profiles are required and must be unique.
- `config/app-config.example.toml` (a `local` profile at 127.0.0.1:5993 and :8000, with the other profiles commented) and `config/app-config.e2e.toml` (the `e2e` and `e2e-auth` profiles, Alpaca hosts, and two test accounts, all on fake-backends :8787) are committed. `config/app-config.toml` is gitignored.
- The app's `build.rs` selects the config in this order: `TA_DROID_CONFIG`, then the e2e config with `--features e2e`, then `app-config.toml`, then the example. It validates the file with `ta-core` and embeds it through `OUT_DIR`. An invalid file fails the build: `TA_DROID_CONFIG=bad.toml cargo check` gives "invalid app config …: app config defines no backend profiles".
- `cargo test -p ta-core`: 5 passed (valid config; malformed accounts give an empty list; a missing or malformed blob gives `None`; default broker hosts; profiles required and unique). The app test `embedded_config_parses` passes, including under `--all-features` (the e2e profile comes first). `mise run verify`: exit 0.

### 3.2 Key-value stores
- `ta_core::store`: the `KvStore` trait (blocking `get`/`set`/`delete`; deleting a missing key is fine) with these implementations:
  - `MemoryStore` for tests.
  - `FileStore`: one JSON object, atomic rename, mode 0600, and a corrupt file reads as empty. It holds preferences, and it holds secrets in `e2e` builds.
  - `KeyringStore`: any keyring-core 1.0 credential store. `KeyringStore::secret_service()` uses `zbus-secret-service-keyring-store` 1.0.1 (pure-Rust crypto).
- Found for 6.3: keyring's `android-native-keyring-store` 1.0.0 exists, which is the first candidate for the Android store. It plugs into the same `KeyringStore`.
- `cargo test -p ta-core --test store`: 3 passed (memory and file contracts, persistence and 0600, corrupt file).
- The Secret Service contract runs with `mise run test:secret-service` and passes (1 passed) against the desktop's KDE `ksecretd` (`org.freedesktop.secrets`), which Plasma Mobile also uses. It is not in `verify`, because it writes to the user's real wallet (a test service name, deleted afterwards). An isolated `dbus-run-session` was not possible: gnome-keyring is not installed ("The name org.freedesktop.secrets was not provided by any .service files").
- `mise run verify`: exit 0.

### 3.3 Blob format and crypto
- New crate `ta-provision`:
  - Crypto: Argon2id v1.3 (ops 3, 256 MiB, 32-byte key) with `argon2` 0.5.3, XSalsa20-Poly1305 with `crypto_secretbox` 0.1.1 (the 0.2 line is a pre-release), and standard base64.
  - Fingerprint: sha256 hex of the ciphertext's base64 text.
  - Plaintext: `{credentials: [...], backends: {profile: {header: value}}}`.
  - Key material is zeroized on drop, and the `Debug` output of `Credential` and `Plaintext` omits keys, secrets, and header values.
- CLI `ta-provision`:
  - `encrypt PLAINTEXT.json` prints a `[credentials_blob]` TOML table.
  - `check CONFIG.toml` decrypts and prints counts and ids only.
  - The passphrase comes from `--passphrase-file` or a no-echo prompt (confirmed twice for `encrypt`).
- `cargo test -p ta-provision`: 8 passed, covering:
  - the **1.3 Node/libsodium fixture decrypts** to the same plaintext, and the fingerprint matches the Node value;
  - wrong passphrase and tampered ciphertext both give `Decrypt`;
  - a round trip gives a fresh salt and nonce each time;
  - malformed fields are reported without decrypting;
  - Debug output contains no key material;
  - the CLI round trip prints no key, secret, header value, or passphrase, and `check` with a wrong passphrase fails.
- Argon2 at 256 MiB is too slow unoptimized, so `argon2` and `blake2` build at opt-level 3 in the dev profile. The test binary runs in about 1.5 s. `mise run verify`: exit 0.

### 3.4 Provisioning flow
- `ta_core::keys` names the store entries: `cred.<broker>:<id>` (JSON `{key, secret}`), `backend.<profile>.<header-lowercase>`, `creds.fingerprint`, and the preference keys `active.account` and `active.profile`.
- `ta_provision::flow`:
  - `action(shipped, stored)` provisions only when a blob ships with a fingerprint other than the stored one.
  - `run` decrypts, saves every credential and backend header, and stores the fingerprint **last**. It returns `Ok`, `BadPassphrase`, or `SaveFailed`, and the outcome carries no payload.
  - `stored_fingerprint` treats an unreadable store as "none".
- `cargo test -p ta-provision --test flow`: 9 passed:
  - the 6 ported `provisioning.test.ts` cases, plus no-blob skip (from `accountContext`);
  - a save failure on either a credential or a header write leaves no fingerprint (the fingerprint key is never written);
  - outcomes serialize as a bare tag;
  - the real crypto end to end on the Node fixture (wrong, then right passphrase).
- No-secrets-in-logs: the flow has no logging, and its only outputs are the payload-free `Outcome` tag and the store writes. Key material is zeroized, and `Debug` redacts it (3.3). `mise run verify`: exit 0.

### 3.5 Accounts
- `ta_core::accounts`:
  - `Account` holds the key and secret, is zeroized on drop, and its `Debug` redacts them.
  - `AccountView` has `id`, `name`, `broker`, `is_paper`, and `key_last4`, and nothing else.
  - `load` joins the metadata with `cred.<broker>:<id>` and skips a missing, unreadable, or malformed credential.
  - `active_id` returns the persisted id if it is still loaded, else the first account, else none. `set_active_id` ignores write errors.
- `cargo test -p ta-core --test accounts`: 8 passed:
  - the 3 ported `accounts.test.ts` cases, plus a corrupt credential;
  - the active-account cases from `accountContext`: default first, switch and persist, stale id falls back, no accounts gives none;
  - a broken preference store is ignored;
  - serialized `AccountView` has exactly `broker, id, is_paper, key_last4, name`, with no key or secret text, and `Debug` redacts too.
- `mise run verify`: exit 0.

### 3.6 Profiles and health
- `ta_core::net`: rustls with the **ring** provider, `webpki-roots`, and an optional per-profile PEM CA. It is handed to reqwest 0.13 through `tls_backend_preconfigured` (features `rustls-no-provider`, json, query, http2).
  - Chosen over reqwest's default (aws-lc-rs plus `rustls-platform-verifier`). That verifier needs JNI initialization on Android, and aws-lc needs a C/CMake cross build. The trust set is now the same on every platform.
  - Auth header values are marked sensitive.
- Gotcha: cargo unifies reqwest features across the workspace, so a plain `reqwest::Client::new()` elsewhere (the fake-backends tests) panicked with "No rustls crypto provider". `net::install_default_crypto_provider()` fixes it; the app calls it at startup and the fake-backends tests call it.
- `ta_core::profiles`:
  - `active` returns the persisted profile, else the first. `set_active` rejects unknown names.
  - `ProfileView` shows `has_auth` and `has_custom_ca` and no header names or values.
  - `Backend` carries the profile client, with headers taken from `backend.<profile>.<header>` secrets; unprovisioned headers are left out, and `Debug` is redacted.
  - `health` probes `/v1/health` and `/health` in parallel with a 10 s timeout, and any failure is `Down`.
- `cargo test -p ta-core --test profiles`: 7 passed:
  - active profile default, persistence, and fallback;
  - the view hides header values;
  - **wiremock requires both CF-Access headers on MarketStore and fa-techan over plain http**;
  - one backend down does not affect the other (connection refused);
  - 500 and 404 count as down;
  - **a private-CA TLS server (rcgen CA plus leaf, tokio-rustls) is rejected without the profile CA and accepted with it**;
  - invalid CA PEM is a setup error.
- The health default of "unknown" and the 20 s polling from `backendContext.test.tsx` are UI state, covered in 5.1. `mise run verify`: exit 0.

### 3.7 Indicators
- `ta_core::indicators::compute` returns the 9 columns in chart order through `talib-sys`, with the same calls as fa-techan (`BBANDS(20)` middle = `sma20`, `SMA(100/200)`, `MACD(12,26,9)`, `RSI(14)`).
- fa-techan's own environment reports `talib.__version__` 0.6.8 and `__ta_version__` `0.6.4 (Oct 20 2025)`, which confirms the pin from 2.3.
- **Spec correction:** 1e-9 on every column against `faTechanHistory.json` is not achievable. fa-techan computed that fixture over a longer history (`sma1000` is set from row 0), so the EMA-seeded columns carry a decayed seeding difference. Measured on the last 100 bars against the stored output:
  - sma20/100/200 about 2e-13, bbands about 3e-13;
  - macd 2.0e-8, macd_signal 7.3e-9, macd_difference 1.1e-8, rsi 9.1e-11.

  I added a **same-input reference**, `talibSameInput.json`, made by `make-talib-reference.py` with fa-techan's `.venv` TA-Lib on the fixture's 400 closes. On it every column is **≤ 2.2e-16** (bit-level), and the warmup nulls are identical. The indicators spec and task 3.7 now state both bounds: same input 1e-9 on all columns; stored output 1e-9 for SMA and BB, 1e-6 for MACD and RSI. `openspec validate --strict` passes.
- `cargo test -p ta-core --test indicators`: 8 passed (the 5 ported `indicators.test.ts` cases, plus three parity tests). `mise run verify`: exit 0.

### 3.8 MarketStore REST
- `ta_core::marketstore`:
  - `freq_to_timeframe` (unknown gives the error "Unknown frequency: x").
  - `bars`, `quotes` (empty list: no request; serialized as `ticker`/`date` like the RN `ApiQuote`), `watchlists`, `watchlist`.
  - `history` and `build_history`: fetches `limit + 200`, computes the indicators over the full series, and slices to `limit`. The result is columnar with an epoch-ms index; OHLCV is always set and indicators are `None` during warmup.
  - Errors: "Can't reach market data — check your connection."; the server's `error` text; or "Market data error: <status>" (also for a 2xx body that does not parse).
- `ta_core::watchlists`: `label` (10 friendly names, unknown shown raw), `to_row`, `stream_key`, `list`, and `entries` (REST `fields` merged in).
- DTO field names are snake_case (`price_up`, `change_pct`, …); the UI uses the generated types from 4.1.
- `cargo test -p ta-core --test marketstore`: 18 passed. That covers all 24 cases of `marketstore.test.ts` (9), `apiHistory.test.ts` (4), `apiQuotes.test.ts` (3), and `watchlists.test.ts` (6), merged where one Rust test checks several of them, plus unknown frequency making no request and a non-JSON 502. `mise run verify`: exit 0.

### 3.9 MarketStore stream
- `ta_core::stream`: `StreamClient::spawn` starts one background task per backend, which owns the socket.
  - `subscribe(tbks)` returns a `Subscription` channel, and dropping it unsubscribes. That makes unsubscribing idempotent by construction; it replaces the RN `done` flag.
  - Reference-counted keys in a `BTreeMap`, so the union is sorted and deterministic. Every change resends the full union, including `[]`.
  - Frames with `action`, frames without `key`, and malformed frames are dropped. Dispatch is by exact key.
  - Reconnects with `default_backoff` = `min(1000·2^n, 15000)` ms, reset on open, and resends the union.
  - Connection failures never reach subscribers.
- `StreamConfig::for_backend` sets the URL from `ws_url` (http→ws, https→wss, + `/ws`), the subprotocol `json`, the profile auth headers on the handshake (marked sensitive), and TLS through `net::ws_tls_config` (same roots and CA, ALPN `http/1.1` only). tokio-tungstenite 0.29 uses rustls with ring, and `cargo tree -i aws-lc-rs` finds nothing.
- `cargo test -p ta-core --test stream`: 9 passed against an in-process tungstenite server:
  - all 8 `marketstoreStream.test.ts` cases (the throwing-factory case is now "port refused, then the server comes up");
  - backoff values;
  - handshake `json` subprotocol plus the `CF-Access-Client-Id` header;
  - no socket before the first subscription.
- Stable across 8 repeated runs (0.34–0.35 s).
- Process slip: commit `ff4c83e` was made while `mise run verify` was failing on two clippy lints (`manual_contains` in `stream.rs`, and `result_large_err` on the tungstenite handshake callback in the test, whose signature tungstenite fixes). The follow-up commit fixes both, and `mise run verify` exits 0. From here on, each commit is chained on `mise run verify &&`.

### 3.10 Alpaca driver
- `ta_core::broker`: wire types. `Position` and `Order` keep enum-like wire fields as strings, so a new Alpaca value never breaks parsing. `NewOrderRequest` omits unset price fields. Also `OrderFilter` and `ReplaceOrderRequest`.
- `broker::alpaca::Alpaca`:
  - A reqwest client with **redirects off** and a **30 s timeout**. The key and secret headers are marked sensitive.
  - `list_positions`, `list_orders` (status defaults to open), `create_order` (never retried; `ta-<ms>-<8 base36>` client order id if none is given), `close_position`, `replace_order`, `cancel_order`.
  - A 204 or empty body is success.
  - `AlpacaError { status, message }` uses the spec messages (status 0 means no response).
  - Hosts come from `AppConfig::broker_hosts`, so e2e points them at fake-backends.
- "Unknown broker": `BrokerId` is an enum, so an unknown broker cannot be represented after parsing. The `driverFor` throw becomes a parse-time rejection, and there is a test for it.
- `cargo test -p ta-core --test alpaca`: 14 passed. That covers the ported `alpaca` (4), `alpacaDriver` (8), and `broker` (3) cases, merged where one Rust test checks several; the RN import-wiring test does not apply. Extra tests:
  - **a 302 to another host is not followed** (that host sees 0 requests) and fails as "Alpaca error (302).";
  - a failed POST is sent exactly once;
  - a given client order id is kept;
  - all six status messages, network failure, and timeout.

### 3.11 Order validation
- `broker::validate`: `OrderForm` (the raw form text) with `validate`, which returns the spec messages in display order, and `to_request`, which trims and uppercases the symbol, sends qty *or* notional, adds only the price fields the type needs, and always sends `extended_hours`. Positive means it parses as a finite f64 greater than 0 after trimming, which matches JS `Number()` except for hex literals.
- `cargo test -p ta-core --test order_validation`: 11 passed. That covers the 9 ported cases (stop-limit now asserts the exact two messages), plus the notional error and the stop-limit/trailing field selection. The qty cases also cover "", "-1", "abc", and "inf".

### 3.12 Flatten
- `broker::flatten`:
  - `holdings` loads positions in parallel and skips a failing account and accounts without the symbol.
  - `plan` makes one market DAY leg per holding, on the opposite side, for |qty|.
  - `submit` sends the legs in parallel and returns `SubmitOutcome { results, remaining, all_ok }`, where `remaining` is exactly the failed legs.
  - A `Leg` carries the account id, name, and paper flag, plus the request. It has **no secrets**; the backend resolves the account on submit.
- Addition beyond the RN app: `plan` assigns each leg its `client_order_id` up front, and a retry resends it unchanged. If a "failed" leg actually reached Alpaca (for example it timed out after acceptance), Alpaca rejects the duplicate id instead of opening a second order. This supports the spec's no-duplicate intent and adds no new behavior.
- `cargo test -p ta-core --test flatten`: 4 passed:
  - ported: the plan's side and qty, holdings isolating a failing account, per-leg results, all-ok with no `suppressed`;
  - new: 3 legs with 1 failing, then a retry of `remaining`, makes **4 POSTs in total (only the failed leg resent)**, and the retry carries the same `client_order_id`.

### 3.13 fa-techan and strategy tags
- `ta_core::techan`: `strategy_positions` (`GET /strategies/positions` on the active profile, sent with the profile headers only, never broker credentials, 10 s timeout) returns `[]` on any failure. `Tagger` joins on the case-sensitive `broker:account_id:symbol`; anything unmatched is "Unattributed".
- Grouping and filtering (`book.ts`: strategies present, filter, group by account) is view state, so it stays TypeScript in the UI and its tests are ported in 5.7.
- `cargo test -p ta-core --test techan`: 3 passed:
  - rows returned;
  - **500, malformed JSON, wrong shape, connection refused, and timeout (50 ms) each give `[]`**;
  - the tagger by broker, account, and symbol, including a case mismatch and an empty tagger.
- The ported `pingHealth` case is covered by 3.6.

### 3.14 fake-backends complete
- **MarketStore**:
  - bars for every timeframe (1Min–1H in weekday 09:30–16:00 ET EDT sessions; 1D, 1W, 1M) from a deterministic price function anchored at Fri 2026-09-25 16:00 ET;
  - quotes (`NEWIPO` has a null `prev_close`);
  - watchlists MOMENTUM, PCT_CHANGE_UP, SECTOR_AGGREGATE (with `fields`);
  - `NOPE` gives 404 "symbol not found", and `EMPTY` gives no bars;
  - a `/marketstore/ws` endpoint with the `json` subprotocol that acks subscribe and forwards `POST /__control/push {key, data}` to subscribed sockets.
- **fa-techan**: `/strategies/positions`, seeded with PA1TEST/AAPL = Momentum and replaceable through `POST /__control/strategies`.
- **Alpaca**:
  - Accounts PA1TEST and LV1TEST, whose keys match the provisioning fixture; the key and secret are checked, and a mismatch gives 401.
  - Per-account positions (including a short) and a seeded open order.
  - Order create, patch, and delete, and position delete. A duplicate `client_order_id` gives 422 "client_order_id must be unique", like Alpaca.
- **Control**: `requests` (now with bodies), `reset`, `orders`, and `fail {target, mode: down|401|429|422|slow, key?, method?, times?, slow_ms?}`.
- `cargo test -p fake-backends`: 10 passed (1 unit test, 3 from 2.1, and 6 new ones that drive the server through the real ta-core clients):
  - history is warm across 1500 daily rows for all 10 frequencies, and intraday times fall inside the session;
  - REST errors, quotes, and watchlists;
  - the stream delivers pushed bar and watchlist updates;
  - strategy tags, and replacing them;
  - Alpaca state, recorded orders, duplicate-id rejection, and 401 on a wrong secret;
  - **every failure mode** (down, 401, 429, 422, slow timeout), `times` consumption, key- and method-scoped rules, and reset.
- `mise run verify`: exit 0. Section 3 is complete.

## 4. Tauri command layer

### 4.1 State, first commands, typed bindings
- `src-tauri/src/state.rs`:
  - `AppState { config, secrets, prefs, live: RwLock<Live{accounts, backend, stream, alpaca}> }` with `provisioning_status`, `provision` (Argon2 runs in `spawn_blocking`, then accounts and the backend reload), `accounts`, `set_active_account` (rejects unknown ids), `profiles`, `set_active_profile` (persists, then rebuilds the backend and stream), and `health`.
  - Command errors are `CmdError { message }`.
- `src-tauri/src/commands.rs` adapts these seven methods to IPC.
- `src-tauri/src/stores.rs` picks the stores:
  - `e2e` builds: a `FileStore` under `TA_DROID_DATA_DIR`.
  - Linux: Secret Service, falling back to a store that fails every call. Provisioning then reports `save-failed` instead of silently storing secrets in plain files.
  - Android: that failing store until 6.3.
  - Preferences: a `FileStore` at `app_data_dir/prefs.json`.
- ts-rs 12 (`serde-json-impl`) derives on 29 DTOs in `ta-core` and `ta-provision`, plus `CmdError`, `ProvisioningStatus`, `AccountsView`, and `ProfilesView` in the app. `History.index` is typed `Array<number>`, not bigint.
  - `scripts/bindings.sh` (`mise run bindings`) writes `ui/src/bindings` (31 files).
  - `--check` regenerates into a temp dir and runs `diff -r`; it is the first step of G2.
  - Plain `cargo test` exports to `target/ts-bindings`, so it never overwrites the committed bindings.
- Staleness check proven: adding one doc comment to `HealthReport` without regenerating made `--check` exit 1 with "ui/src/bindings is stale" and the diff. Reverting passes again.
- `cargo test -p ta-droid --test state`: 4 passed against fake-backends:
  - the provisioning gate: wrong passphrase, then right; accounts load; **serialized views contain no key or secret**;
  - save failure keeps the prompt;
  - active account switches, rejects unknown ids, and persists across a new `AppState`;
  - profile switch persists, `e2e-auth` sends the provisioned `CF-Access-Client-Secret` on health, and the profile view has no header values.
- `mise run verify`: exit 0.

### G3 flake fix (found during 4.2)
- Symptom: `mise run verify` failed once, with the app root not displayed after 20 s; `mise run e2e:desktop` alone passed.
- Root cause: in G1, `cargo test --workspace --all-features` rebuilds `target/debug/ta-droid` without Tauri's custom protocol, giving a blank app that points at the dev URL. It runs in parallel with G3, so it could replace the binary G3 had just built with `cargo tauri build`.
- Fix: `run-desktop.sh` and `run-android.sh` build into their own `CARGO_TARGET_DIR=src-tauri/target/e2e`, and G3 launches that binary through `TA_DROID_APP`. Two consecutive full `mise run verify` runs then passed.

### 4.2 Market-data commands and streams
- Commands: `history`, `quotes`, `watchlists`, `watchlist_entries`, `subscribe_bars(symbol, timeframe, Channel<LiveBar>)`, `subscribe_watchlist(id, Channel<Vec<WatchRow>>)`, and `unsubscribe(id)` (idempotent).
- `ta_core::stream` gains the typed payloads `LiveBar` (ts-rs, `epoch: number`), `bar_key`, `as_bar` (only `msg_type: bar`), and `as_watchlist_rows` (only `watchlist_update`; the payload symbols become full rows).
- `AppState` keeps a registry of UI subscriptions. Each one is a forwarder task from the current `StreamClient` to a sink.
  - A sink returning false (the receiver is gone) ends the subscription, and the backend unsubscribes.
  - **On a profile switch, every open subscription moves to the new stream with the same sink.** Aborting the old forwarders drops their `Subscription`s, so the old socket closes.
  - Tauri `Channel::send` does not report a JS-side drop, so the UI must call `unsubscribe` on unmount. The sink check covers any case where the send does fail.
- fake-backends records every WS subscribe union (`/__control/ws-subscribes`, `FakeState::ws_subscribes`).
- Tests:
  - `cargo test -p ta-core --test stream_payloads`: 3 passed.
  - `cargo test -p ta-droid --test market_data`: 4 passed, stable over 5 runs:
    - typed results and user-facing errors;
    - bar and watchlist deliveries;
    - **dropping one receiver shrinks the server's subscribe set from [AAPL, MSFT] to [AAPL]**, then an idempotent `unsubscribe` takes it to [];
    - a profile switch keeps delivering to the same sink over a new socket.
- Bindings regenerated (`LiveBar`). `mise run verify`: exit 0.

### 4.3 Trading commands
- `src-tauri/src/trading.rs` adds these `AppState` operations:
  - `positions` and `orders` return `AccountBook<T> { account: AccountView, rows: Tagged<T>[], error }` per account, in config order. The broker calls and the fa-techan tagger load in parallel. Orders are filtered to working statuses.
  - `symbol_holdings` returns `HoldingView` for the chart strip.
  - `place_order` **validates again** on the backend, then sends through the active account.
  - `flatten_legs` and `submit_flatten`.
  - A test-only `set_broker_timeout`.
- Commands: `positions`, `orders`, `symbol_holdings`, `validate_order` (live form feedback), `place_order`, `flatten_legs`, `submit_flatten`.
- The generic ts-rs types `AccountBook<T>` and `Tagged<T>`, plus `HoldingView`, are in the regenerated bindings.
- `cargo test -p ta-droid --test trading`: 7 passed:
  - tagged grouping (PA1TEST/AAPL = Momentum; everything else Unattributed), with no secrets in the JSON;
  - **a 401 on one account gives that account's error and no rows, and the other account is unaffected**;
  - fa-techan down makes everything Unattributed;
  - orders are open-only (a cancelled seed order drops out);
  - an invalid form or unknown account sends nothing, and a valid one sends **exactly one** clean POST (uppercased symbol, no stop price, `ta-` id);
  - **401, 429, 422, and timeout** each give their spec message;
  - flatten over both holders, then a retry of only the failed leg (3 POSTs in total).
- `mise run verify`: exit 0.

### 4.4 Locked-down WebView
- `tauri.conf.json`:
  - The CSP allows only the app and IPC: `default-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, plus inline styles and data images.
  - `devCsp` is the same, plus the Vite HMR socket `ws://localhost:5173`.
  - `freezePrototype: true`.
- Capabilities: the main window has only `core:default`. No HTTP, filesystem, shell, or other plugins are installed.
- New G3 spec `e2e/specs/security.e2e.ts`, shared with G4 (the fake-backends control URL comes from `E2E_FAKE_URL`):
  - UI `fetch('http://127.0.0.1:8787/fatechan/health')` is **rejected, and fake-backends logs no such request**;
  - `invoke('health')` over IPC still returns `{marketstore: up, fatechan: up}`.
- Negative control: adding `http://127.0.0.1:8787` to `connect-src` made the block test fail (✖) while the IPC test passed. The config was restored afterwards.
- `mise run e2e:desktop`: 3 passing across 2 spec files.

### 4.5 Secret-leak guard
- `src-tauri/src/leak_guard.rs` is active in `e2e` builds and compiles to a no-op otherwise.
  - Every command result (success and error) and every channel message is serialized and checked against every provisioned value. It reads the e2e `FileStore` through `AppState::secret_dump`, takes broker `key`/`secret` fields from the JSON credentials, skips the fingerprint, and ignores values shorter than 6 characters.
  - A hit replaces the result with the error "secret leak blocked in `<command>`", drops the channel message, and logs `SECRET-LEAK` without printing the value.
  - All command adapters in `commands.rs` now go through `check`, and the channel sinks go through `allow`.
- `config/app-config.e2e.toml` now ships a real test blob, made by `ta-provision encrypt` from the fake-backends accounts plus `e2e-auth` headers. The passphrase is in `e2e/fixtures/passphrase.txt`. `run-desktop.sh` gives each run a fresh `TA_DROID_DATA_DIR`.
- e2e support (`e2e/support/app.ts`): `invoke()` returns results as JSON text, because WebKitWebDriver turned object rejections into "[object Object]" errors. Also `ensureProvisioned()` and the list of test `SECRETS`.
- Negative control, as the task requires: a temporary e2e-only command `leak_probe` returned `key=<provisioned key>`. In G3 it came back as `{error: "secret leak blocked in `leak_probe`"}`, and the driver log had one `SECRET-LEAK` line (run log kept at `artifacts/g3/leak-probe-run.log`). The command and its spec were then removed; `rg leak_probe` finds nothing.
- The permanent spec `e2e/specs/leak-guard.e2e.ts` provisions, then calls 10 read commands. Each succeeds, none trips the guard, and none contains a test secret.
- Unit test `leak_guard::tests` finds a nested leak and passes a clean value.
- `mise run verify`: exit 0, G3 4 passing across 3 spec files. Section 4 is complete.

## 5. UI

### 5.1 App shell
- `ui/src/ipc.ts`: the only I/O path.
  - A typed `api` (every command, using the generated bindings) and `errorMessage`.
  - `live.bars` and `live.watchlist` wrap Tauri `Channel`s and return an idempotent unsubscribe that also works before the subscribe call resolves.
- State:
  - `state/backend.tsx`: health defaults to unknown, `setHealth`, `refresh`, and a 20 s poll.
  - `state/accounts.tsx`: provisioning status checking → need-passphrase / ready; accounts; active id with fire-and-forget persist; `provision`.
- Shell:
  - `components/Shell.tsx`: the drawer (Chart, Positions, Orders, Watchlists, Settings) with a scrim.
  - `components/Screen.tsx`: the drawer-screen header and the pushed-screen back bar.
  - `components/AppHeader.tsx`: menu, title, actions, the MS/FA pill (disabled without a handler), and refresh.
  - Safe areas use CSS `env(safe-area-inset-*)` with `viewport-fit=cover`.
- `routes.tsx` sets up a memory router: default `/watchlists`, `/chart` → `/chart/AMD`, the chart stack (`order`, `exit`), and the settings stack (`accounts`, `backend`). Screens are placeholders until 5.2–5.9.
- Vitest runs with `mockIPC` (`src/test/backend.ts`). It has 14 tests:
  - ported `appHeader` (2) + a disabled pill with no refresh;
  - ported `backendContext` (4) + a 20 s poll test with fake timers;
  - `App`: opens on Watchlists, the drawer lists 5 items and navigates, the scrim closes it, the chart stack goes back, the pill opens Backend, and the gate hides the app.
- G3 `e2e/specs/shell.e2e.ts`: 4 passing — opens on Watchlists, reaches every drawer destination, pushes and pops both stacks, and live MS/FA `up` with the pill opening Backend. Screenshots are `artifacts/g3/shell-*.png`.
  - Gotcha: the scrim's center lies under the drawer, so WebDriver reported "element click intercepted". The spec taps the scrim's uncovered edge.
  - `E2E_SPEC=./specs/x.e2e.ts` runs a single spec.
- The Android back button moved to 6.7 with the rest of the mobile work. The lint rule `react-hooks/set-state-in-effect` is disabled on the poll line only, with the reason given.
- `mise run verify`: exit 0.

### 5.2 Provisioning gate
- `components/ProvisioningGate.tsx`: a full-screen form with a masked field and Unlock.
  - While Argon2 runs: "Unlocking…", the field and button are disabled, a busy note is shown, and a second submit is ignored.
  - After any submit the field is cleared.
  - Messages: "Incorrect passphrase." (bad-passphrase) and "Could not save credentials to secure storage." (save-failed).
  - No lockout.
- An e2e-only command `e2e_reset` clears the e2e secrets and preferences and reloads state, so a spec sees a fresh install.
- Vitest (5 new; 19 total):
  - no prompt without a needed blob;
  - a wrong passphrase clears the field and shows its message;
  - save-failed has its own message;
  - three failures then success (no lockout), and accounts load once;
  - busy state with a double submit sending one `provision`.
- G3 `e2e/specs/provisioning.e2e.ts`: 4 passing:
  - reset, then the gate shows and Watchlists is absent;
  - a wrong passphrase shows "Incorrect passphrase." and an empty field;
  - the real passphrase (real Argon2 with 256 MiB in the app) opens Watchlists;
  - **`browser.reloadSession()` starts a new app process on the same data dir, which opens with no prompt.**
- Screenshots: `provisioning-prompt.png` and `provisioning-wrong.png`.
- The first full verify after 5.2 failed the 4.4 security spec. Its check "fake-backends saw no `/fatechan/health`" became invalid once the UI started polling health, because the *backend* now calls that path legitimately. The spec now fetches `/fatechan/csp-probe`, a path only a UI request could produce.

### 5.3 Settings, Accounts, Backend
- Screens:
  - `SettingsScreen`: "Accounts — N linked" and "Backend — <active profile>".
  - `AccountsScreen`: read-only; name, "paper" badge, `id · ••••last4`, and the RN empty-state text.
  - `BackendScreen`: every profile with its URLs, "auth"/"custom CA" flags (never values), and the active profile's live MS/FA state. Tapping switches.
  - `AccountPicker`: a modal list with the selection highlighted; choosing or tapping outside closes it.
- `BackendProvider` gains `profiles`, `activeProfile`, `loadProfiles`, and `selectProfile` (switch, then reset health to unknown and re-probe). Shared `Modal` and `ui.module.css`, plus a test helper `renderAt`.
- Vitest (8 new; 27 total):
  - the ported settings (1), accountsScreen (3), and accountPicker (3) cases, with the picker's close-on-choose and close-on-outside;
  - a Backend switch sends `set_active_profile` and re-probes health.
- G3 `e2e/specs/settings.e2e.ts`: 2 passing:
  - 2 linked accounts with `••••0001` and paper badges only on paper;
  - **switching to `e2e-auth` gets MS/FA up, and fake-backends logs `cf-access-client-id: test-client-id` on the health probe; after `reloadSession()` (a new app process) Settings still shows `e2e-auth`.**
  - The `after` hook restores the `e2e` profile.
- Screenshots: `settings-accounts.png`, `settings-backend.png`.

### 5.4 Watchlists
- `format.ts` is moved over unchanged.
- `WatchlistPicker` is a radio-style modal.
- `WatchlistsScreen`:
  - REST paint first; a failed entries fetch is ignored.
  - `live.watchlist` replaces every row on each update.
  - Price colored against the prior close; signed change % colored against the open; aggregates show `avg_pct_change`; rows with no data show `--`.
  - "Watchlists unavailable." when listing is empty or fails.
  - Tapping a row opens `/chart/<symbol>`.
  - Unsubscribes when the list changes or the screen unmounts, not when it is merely hidden.
- A test helper `channelSender` delivers Rust-style `{index, message}` frames to a mocked `Channel`.
- Vitest (11 new; 38 total):
  - `format` (4, ported);
  - `watchlistsScreen` (2 ported, with a list-failure variant);
  - live replacement;
  - list switch: subscribe `[w1, w2]` and unsubscribe `[1]`, plus aggregate and `--` rows;
  - a row opens the chart;
  - unmount unsubscribes.
- G3 `e2e/specs/watchlists.e2e.ts`: 4 passing:
  - REST paint of Momentum from fake-backends, with 4 decimals for PENNY;
  - **a `watchlist_update` pushed through `/__control/push` replaces the rows** (LIVE +25.00%);
  - switching to the sector aggregate shows +1.23%;
  - a tapped row opens the chart.
- Screenshots: `watchlists-rest.png`, `watchlists-live.png`.
