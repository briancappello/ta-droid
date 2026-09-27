## Context

See proposal.md (Why) for the motivation. The current state that shapes this design:

- The app is about 4.9k lines of TypeScript in `src/`, with 141 Jest tests in `__tests__/`. The only native code is the stock `MainActivity.kt` and `MainApplication.kt`.
- Configuration is baked in at build time through `react-native-config` (`.env`): `ACCOUNTS_JSON`, `CREDENTIALS_BLOB_JSON`, `API_BASE_URL`, `MARKETSTORE_BASE_URL`, and `MARKETSTORE_AUTH_TOKEN`.
- The chart runs `lightweight-charts` 4.2.3 inside a WebView, driven by an inline HTML page and `postMessage` (`src/screens/ChartScreen.tsx`).
- The backends are not production-ready. There is a localhost MarketStore replica and taichi's MarketStore (the source of truth). The end state is a homelab reached through a Cloudflare Tunnel or Tailscale. The homelab is not built yet.
- **Development constraint:** all work happens on this workstation with no phone attached. The human takes part only in a start batch and an end batch.
- **Workstation:**
  - Arch-based.
  - Android SDK with NDK 27.1 and a `Pixel_8` AVD (API 36, x86_64).
  - KVM.
  - webkit2gtk-4.1 2.52 and `WebKitWebDriver`.
  - weston, qemu-system-aarch64, qemu-user-static with binfmt, and rootless podman.
  - pmbootstrap 3.11 with a `qemu-aarch64` + Phosh image.

## Goals / Non-Goals

**Goals:**
- One Rust backend and one React UI for Android and Linux phones.
- Every automated gate runs headless on this workstation, and an agent can run the whole port unattended.
- The existing tests carry over as the behavioral contract, so no behavior is lost by accident.

**Non-Goals:**
- iOS, Windows, and macOS.
- Order cancel and modify in the UI (the driver supports them, but no screen offers them today).
- Live indicator updates.
- Upgrading `lightweight-charts` beyond 4.2.3.
- Building the homelab ingress. The `remote` profile is only a placeholder URL.
- Publishing to an app store.

## Decisions

### D1. Tauri v2 with a React/TS UI and a Rust backend
The UI is React 19 with TypeScript, built by Vite and rendered to the DOM. All logic that touches I/O or secrets lives in Rust.
- *Alternative: keep React Native on Android and add Tauri only for Linux.* This means two shells, plus react-native-web compatibility work on every component. Rejected.
- *Alternative: a Rust UI (Leptos or Dioxus).* This means a full UI rewrite, plus `wasm-bindgen` glue for the chart library. Rejected.
- Both target phones (Pixel 8, OnePlus 7 Pro) are fast enough for a WebView UI. The chart already runs in a WebView today.

### D2. Repository layout
```
ui/                         React app (Vite). New; RN src/ stays as reference until cutover
src-tauri/
  Cargo.toml                workspace
  src/                      Tauri app crate: commands, events, state, plugins
  crates/core/              pure Rust, no Tauri dependency; all domain logic + clients
  crates/talib-sys/         vendored TA-Lib C source + FFI + safe wrapper
  crates/provision/         blob format + `ta-provision` CLI (replaces encrypt-credentials.mjs)
  crates/fake-backends/     test server: MarketStore REST+WS, fa-techan, Alpaca
e2e/                        WebdriverIO specs shared by desktop and Android
config/app-config.example.toml
```
`core` has no Tauri dependency, so `cargo test` runs it fast and headless. The UI goes in `ui/` because `src/` stays occupied until cutover.

### D3. IPC contract
- The UI talks to Rust only through `#[tauri::command]` functions. Live data comes over Tauri `Channel`s: one per subscription for bars, and one for watchlists.
- The TypeScript types are generated from the Rust DTOs with `ts-rs`, and a CI check fails if the generated files are stale.
- The DTOs never carry secrets. For example, `AccountView` has `key_last4` and no `key` or `secret`.
- *Alternative: `tauri-specta`.* It also generates the command signatures, but it is less stable. We may revisit it later without changing the specs.

### D4. Networking
- **HTTP:** `reqwest` with rustls.
  - Redirects are disabled for broker calls, which also time out after 30 s.
  - Each profile can add an extra root CA.
  - Plain `http` is allowed. Rust sockets are not subject to Android's cleartext policy, which applies only to the Java and WebView stacks.
- **WebSocket:** `tokio-tungstenite`, sending the profile headers on the handshake. This makes Cloudflare Access service tokens work over the stream too.
- **Stream client:** a port of `marketstoreStream.ts`. It keeps the reference-counted union subscribe, the idempotent unsubscribe, the `min(1000·2^n, 15000)` ms backoff, and resubscribe on reopen. Its behavior is covered by the same test cases.

### D5. Secret store
A `SecretStore` trait in `core` with three implementations:
- **Linux:** the `keyring` crate over the Secret Service (works on Phosh and Plasma Mobile).
- **Android:** a Keystore-backed store. Task 2 checks whether a maintained Rust store for Android Keystore (`keyring` ecosystem) works with the NDK.
  - If it works, we use it.
  - If not, we write a small Tauri mobile plugin in Kotlin: an AES-GCM key held in the Android Keystore encrypts the values, which are stored in app-private storage.
  
  Either way the trait is the same, so later tasks don't change.
- **Tests:** an in-memory implementation for `cargo test`, and a file-backed one enabled by the `e2e` feature for end-to-end runs where a Secret Service may not exist.

### D6. Provisioning crypto
We keep the libsodium format so the blob tool and the app agree:
- **Key derivation:** Argon2id v1.3, ops 3, memory 256 MiB, 32-byte key. These are the `crypto_pwhash` MODERATE settings.
- **Cipher:** XSalsa20-Poly1305 (`crypto_secretbox`).
- **Encoding:** standard base64.
- **Fingerprint:** sha256 hex of the ciphertext's base64 text.

The implementation uses the RustCrypto crates `argon2` and `crypto_secretbox`. Before the Node tooling is deleted, a fixture blob made by `scripts/encrypt-credentials.mjs` is committed as a cross-implementation test vector. The plaintext gains a `backends` section (profile name to header values). With no compatibility requirement, the Rust `ta-provision` CLI becomes the only encryptor.
- *Alternative: bind libsodium through `libsodium-sys`.* This adds another C build for Android and musl. Rejected, because the pure-Rust crates implement the same primitives.

Argon2 with 256 MiB takes a few seconds on a phone. It runs on a blocking thread, and the prompt shows a busy state.

### D7. TA-Lib, vendored and built with `cc`
`talib-sys` contains a pinned TA-Lib C release (0.6.x, with its checksum recorded) and compiles the needed sources with the `cc` crate. That works the same for x86_64-gnu, aarch64-musl, and the Android NDK targets, without depending on CMake or system packages. A safe wrapper exposes SMA, BBANDS (SMA MA type, population σ), MACD, and RSI. It converts TA-Lib's `outBegIdx` into null-padded output aligned to the input.
- *Alternative: a pure-Rust TA crate.* Different seeding means we would be back to calibrating against tolerances. Rejected.
- *Alternative: the system `libta-lib`.* Not available on Android, and not reliably packaged for Alpine or postmarketOS. Rejected.

### D8. Build-time configuration
`config/app-config.toml` is gitignored; the committed file is `app-config.example.toml`. It is embedded by `build.rs` and holds:
- the account metadata;
- the profile definitions (name, MarketStore URL, fa-techan URL, header names mapped to secret ids, and an optional CA path);
- the credentials blob.

It replaces `.env` and `react-native-config`. The `e2e` feature compiles in an extra `e2e` profile that points at `fake-backends` on `127.0.0.1`.

### D9. UI stack
- **Routing:** `react-router` with a memory router. It recreates the drawer, the stacks, and history-based back. The Android back button is wired to router history through Tauri's back-button hook; task 5 checks that this hook exists in the pinned Tauri version.
- **Styling:** CSS modules, with safe areas from `env(safe-area-inset-*)` and `viewport-fit=cover`.
- **Chart:** `lightweight-charts` 4.2.3 imported from npm and mounted in `div`s. Pane sync, "fake UTC" Eastern time, and 5D slot padding keep their current TypeScript logic (`chartTime.ts`), moved into `ui/`.
- **Pure display helpers stay in TypeScript:** `chartTime.ts` and `format.ts`.
- **Tests:** vitest with Testing Library, and `@tauri-apps/api/mocks` `mockIPC` in place of the backend.

### D10. Locked-down WebView
- The CSP allows only the app itself and Tauri IPC: `default-src 'self'; connect-src ipc: http://ipc.localhost`.
- The UI gets no HTTP, filesystem, or shell plugin.
- Capabilities list only the app's own commands.

This enforces the secret boundary in app-shell/spec.md.

### D11. Hardware-free verification gates
All gates run headless on the workstation. They are wired as `mise` tasks: `mise run verify` runs G1–G4 on every task, and `mise run verify:slow` runs G5–G6 at the end of each task group.

| Gate | Proves | How |
|---|---|---|
| G1 core | Domain logic, clients, crypto, TA-Lib parity | `cargo test --workspace`, `cargo clippy -D warnings`, `cargo fmt --check`; HTTP and WS against `wiremock` and in-process servers |
| G2 ui | Components and screens | `vitest`, `tsc --noEmit`, `eslint`; IPC mocked |
| G3 desktop e2e | The real app, IPC, and WebKitGTK (the Linux phone engine) | `tauri-driver` + `WebKitWebDriver` + WebdriverIO under `weston --backend=headless`, app built with `--features e2e` against `fake-backends` |
| G4 android e2e | APK install, Keystore store, Android WebView, back button | `Pixel_8` AVD with `-no-window -gpu swiftshader_indirect`, debug x86_64 APK, `adb reverse` to `fake-backends`, WebdriverIO through Appium UiAutomator2 in the WEBVIEW context |
| G5 pmOS smoke | aarch64 musl build, launch under Phosh, Secret Service | Exported pmbootstrap image booted with `qemu-system-aarch64` (TCG, user networking, ssh on host port 2222); app package installed over ssh; `ssh -R` exposes `fake-backends`; launch, check the process, capture a screenshot with `grim`, and read the fake-backend request log |
| G6 packages | Distributable artifacts | Android release-shaped AAB/APK (unsigned); postmarketOS `.apk` built with `abuild` in a rootless arm64 Alpine container; Droidian arm64 `.deb` built in a rootless arm64 Debian container |

- G3 and G4 run **the same WebdriverIO specs**. The only differences are the connection capabilities.
- *Alternative for G4: Chrome DevTools Protocol through an `adb` forward.* It is lighter, but it would need a second driver and a second copy of each spec. Rejected in favor of shared specs.
- **`fake-backends`** is one Rust binary. It serves MarketStore REST and WS, fa-techan, and Alpaca from fixtures. It supports scripted failures (down, 401, 429, 422, slow), so the degraded-mode and error-message specs can be tested end to end, and it logs every request so the tests can check that no secret leaked.
- Every end-to-end run saves screenshots to `artifacts/<gate>/<spec>.png` for the end-batch visual review.

### D12. Linux packaging and window behavior
- **postmarketOS:** an `APKBUILD` under `packaging/postmarketos/`, built with a throwaway local signing key and installed with `--allow-untrusted` in the test VM.
- **Droidian:** a Tauri `deb` bundle for arm64.
- The desktop entry uses the app identifier. On a phone shell the window opens maximized; phoc and KWin decide the final geometry.
- **Development window:** 412×915 logical pixels, so layout problems show up on the desktop.
- A Flatpak is deferred until someone needs it.

### D13. Workflow for an unattended agent
- All work happens on one branch, `feat/tauri-port`. There is one conventional commit per task in tasks.md, with no AI attribution.
- A task is checked off only after its stated verification passes. The evidence (command, counts, artifact paths) is recorded in `evidence.md`, following the homelab convention.
- The React Native code stays in place, unbuilt, as a reference until the cutover task in the end batch.
- A task that cannot pass its gate without a human decision is marked blocked in `evidence.md`. The agent continues with independent tasks and does not guess.

## Risks / Trade-offs

- **[Android Keystore store maturity]** → Task 2 decides between a Rust store and a Kotlin plugin, behind a fixed trait. The fallback is about 100 lines of Kotlin.
- **[TA-Lib does not build cleanly with the NDK or musl through `cc`]** → Pin the sources and compile only the files we need. G1 builds for all four targets in the task that introduces the crate, so failures show up early.
- **[WebKitGTK under headless weston needs a GPU]** → Force software rendering in G3 (`LIBGL_ALWAYS_SOFTWARE=1`, and `WEBKIT_DISABLE_DMABUF_RENDERER=1` if needed). The fallback is `xvfb` with XWayland.
- **[Appium chromedriver must match the WebView version]** → Use Appium's chromedriver auto-download, pinned by the AVD's WebView version.
- **[The aarch64 builds under qemu-user are slow (tens of minutes)]** → Cache the cargo registry and target directory in podman volumes, and run G5 and G6 only once per task group.
- **[pmOS under TCG is slow or flaky]** → If G5 cannot pass reliably, reduce it to "package builds and the binary starts headless in the VM". The Phosh visual check moves to the end batch, recorded in `evidence.md`.
- **[The emulator does not show real touch feel or device GPU quirks]** → This is accepted. The end batch covers it on both phones.
- **[Argon2 at 256 MiB on a phone]** → It runs once per blob, off the UI thread, with a busy state. Both target phones have 8 GB or more of RAM.
- **[Secrets reaching the UI by mistake]** → DTO types have no secret fields, and G3 and G4 check that no provisioned value appears in any IPC payload (fake-backends records the values and the e2e hook scans responses).

## Migration Plan

1. Build the Tauri app next to the React Native project on `feat/tauri-port`, following tasks.md.
2. End batch: the human runs acceptance on the Pixel 8 and the OnePlus 7 Pro, reviews the screenshots in `artifacts/`, and creates the release signing key.
3. Cutover task: delete the React Native project and its tooling, update the README and `.mise.toml`, and merge.
4. Rollback: nothing is published and no data is migrated, so rollback is `git revert` of the merge. The RN APK can still be built from the pre-merge commit.

## Open Questions

- **Exact TA-Lib release to pin.** The latest 0.6.x at task time. The pin doesn't change the tasks.
- **URL of the `remote` profile.** It's a placeholder until the homelab ingress exists. Filling it in is a config change only.
- **Whether a Flatpak is needed for Droidian or other distributions.** Deferred. It would be a new task after this change.
