# FinCharts

React Native Android application bootstrapped with [`@react-native-community/cli`](https://github.com/react-native-community/cli).

## Quickrun

Assumes the environment below is already set up (JDK 21, Node 22, Android SDK, env vars, emulator/device).

### Hot-reload dev mode

```sh
pnpm install                    # 1. deps (skip if unchanged)
pnpm start                      # 2. boot emulator (if needed) + build + install + Metro
```

`pnpm start` runs `scripts/dev.sh`, which owns the emulator and Metro as child
processes:

- Boots the emulator (cold boot, `-no-snapshot-load`) if no device is connected;
  reuses an already-connected device otherwise.
- Builds, installs, and launches the app, then runs Metro (single owner, via
  `run-android --no-packager`).
- **Ctrl+C once** = graceful shutdown (`SIGTERM` Metro + `adb emu kill`).
  **Ctrl+C twice** = force kill both. It only stops the emulator if it booted
  one; a pre-connected device is left running.

Override the AVD with `AVD=MyAvd pnpm start`. For a dedicated Metro-only
packager terminal, use `pnpm metro`.

### Sideload onto a physical phone

Enable USB debugging on the phone and plug it in.

```sh
adb devices                                              # 1. confirm phone is listed
cd android && ./gradlew assembleRelease && cd ..         # 2. build release APK
adb install -r android/app/build/outputs/apk/release/app-release.apk   # 3. install
```

Or, for a debug build straight to the connected phone:

```sh
pnpm start            # (or pnpm android) installs debug build to whichever device adb lists
```

## Prerequisites

- Arch Linux
- Android Studio (for SDK management)
- pnpm

## Development Environment Setup

### 1. Install JDK 21

```sh
sudo pacman -S jdk21-openjdk
sudo archlinux-java set java-21-openjdk
```

Verify:

```sh
java -version
```

### 2. Install Node.js 22 + pnpm via mise

The toolchain is pinned in `.mise.toml` (Node 22, pnpm latest, JDK 21). Node 22
LTS is required — Node 25+ is not compatible with Metro's worker resolution.

Install [mise](https://mise.jdx.dev), then from the repo root:

```sh
mise install       # installs Node 22 + pnpm per .mise.toml
```

Verify (from the repo root, so mise activates the pinned versions):

```sh
node -v   # should show v22.x.x
pnpm -v   # should show the pinned pnpm
```

> Do not use fnm or corepack for this repo — they ship a different pnpm that
> shadows mise's and ignores the native-build approval (`allowBuilds`) in
> `pnpm-workspace.yaml`, breaking `react-native-libsodium`. Let mise be the
> single source of Node and pnpm.

### 3. Android SDK

Open Android Studio and install the following via **Settings > Languages & Frameworks > Android SDK**:

**SDK Platforms tab:**

- Android API 36

**SDK Tools tab:**

- Android SDK Build-Tools 36
- Android SDK Command-line Tools (latest)
- Android SDK Platform-Tools
- NDK (Side by side) 27.1.12297006

### 4. Android Emulator

Install a system image and create an AVD:

```sh
sdkmanager "system-images;android-36;google_apis;x86_64"
sdkmanager --licenses
avdmanager create avd \
  -n Pixel_8 \
  -k "system-images;android-36;google_apis;x86_64" \
  -d "pixel_8"
```

Verify KVM acceleration is available (required for x86_64 emulator performance):

```sh
lsmod | grep kvm
```

You should see `kvm_intel` or `kvm_amd` loaded. If not:

```sh
sudo modprobe kvm_intel  # or kvm_amd for AMD CPUs
```

### 5. Shell Environment

Add the following to `~/.zshrc` (or `~/.bashrc`):

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export ANDROID_HOME=$HOME/Android/Sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Source the file or open a new terminal:

```sh
source ~/.zshrc
```

### 6. Install Dependencies

```sh
pnpm install
```

### 7. Environment Variables

Copy the example env file:

```sh
cp .env.example .env
```

## Running the App

Build, install, and launch on an emulator/device (starts Metro itself):

```sh
pnpm start
```

## Useful Commands

| Command            | Description                                                       |
| ------------------ | ---------------------------------------------------------------- |
| `pnpm start`       | Boot emulator (if needed) + build + install + Metro; Ctrl+C tears both down (twice = force) |
| `pnpm android`     | Raw `react-native run-android` (no wrapper, no signal handling)  |
| `pnpm metro`       | Start the Metro dev server only (dedicated packager terminal)    |
| `pnpm test`        | Run tests                                                        |
| `pnpm run lint`    | Run ESLint                                                       |

## Troubleshooting

- **`JAVA_HOME` not set**: Ensure JDK 21 is installed and `JAVA_HOME` is exported in your shell config.
- **No emulators found**: Create an AVD using `avdmanager` (see step 4 above).
- **Metro worker crashes** (`Jest worker encountered child process exceptions`): You are likely running Node 25+. Run from the repo root so mise pins Node 22 LTS (`mise install`).
- **Wrong pnpm / `ERR_PNPM_IGNORED_BUILDS`**: a stray pnpm from fnm/corepack is shadowing mise's. Run `which pnpm` — it should resolve to mise's, not a `fnm_multishells/.../corepack` path. Disable corepack (`corepack disable`) and remove fnm if present.
- **Gradle `Cannot find module @react-native/codegen/...` or missing `@react-native/gradle-plugin`**: dependencies were installed isolated instead of hoisted. React Native's Gradle build needs a flat `node_modules`. This repo sets `nodeLinker: hoisted` in `pnpm-workspace.yaml` (pnpm 11 no longer reads `node-linker` from `.npmrc`). Fix with a clean reinstall: `rm -rf node_modules && pnpm install`, then confirm `ls node_modules/@react-native/codegen` resolves at the top level.
