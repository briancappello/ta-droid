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
