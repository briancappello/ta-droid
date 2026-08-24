#!/usr/bin/env bash
# Prints the commands to start the Android app in dev mode. Does not run them.
set -euo pipefail

cat <<'EOF'
Start the Android app in dev mode by running these, in order:

  pnpm install              # 1. deps (skip if unchanged)
  pnpm start                # 2. boot emulator (if needed) + build + install + Metro

`pnpm start` runs scripts/dev.sh, which owns the emulator and Metro as child
processes:
  - Boots the emulator (cold boot) if no device is connected; reuses a
    connected device otherwise. Override the AVD with `AVD=MyAvd pnpm start`.
  - Builds, installs, launches the app, then runs Metro (single owner).
  - Ctrl+C once  = graceful shutdown (SIGTERM Metro + adb emu kill)
    Ctrl+C twice = force kill both. Only stops the emulator it booted.

For a dedicated Metro-only packager terminal, use `pnpm metro`.
Raw one-shot build without the wrapper: `pnpm android`.
EOF
