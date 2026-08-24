#!/usr/bin/env bash
# Prints the commands to start the Android app in dev mode. Does not run them.
set -euo pipefail

cat <<'EOF'
Start the Android app in dev mode by running these, in order:

  pnpm install              # 1. deps (skip if unchanged)
  pnpm start                # 2. build + launch on emulator/device (starts Metro itself)

`pnpm start` runs `react-native run-android`: it builds, installs, and starts
Metro, auto-booting an emulator if no device is connected (it picks the first
AVD from `emulator -list-avds`, 30s boot timeout).

Optional — pre-boot to choose a specific AVD or dodge the cold-start timeout:

  emulator -avd Pixel_8 &   # before step 2, if no device is already connected

For a dedicated Metro-only packager terminal, use `pnpm metro`.
EOF
