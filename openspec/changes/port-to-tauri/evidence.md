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
