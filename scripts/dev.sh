#!/usr/bin/env bash
# Dev launcher: owns the emulator (if it boots one) + Metro as child processes.
#   Ctrl+C once  -> graceful shutdown (adb emu kill + SIGTERM Metro)
#   Ctrl+C twice -> force kill both (SIGKILL)
# Wired as `pnpm start`. Runs run-android with --no-packager so THIS script is
# the only Metro owner.
set -uo pipefail

AVD="${AVD:-Pixel_8}"
STARTED_EMU=0
EMU_PID=""
METRO_PID=""
GRACE=0

log() { printf '\n[dev] %s\n' "$1"; }

# 1. Ensure a device is connected; boot the emulator if not.
if adb devices | grep -qw device; then
  log "Using already-connected device (will not stop it on exit)."
else
  log "Booting emulator $AVD..."
  emulator -avd "$AVD" -no-snapshot-load >"/tmp/emulator-$AVD.log" 2>&1 &
  EMU_PID=$!
  STARTED_EMU=1
  adb wait-for-device
  # ponytail: poll boot_completed instead of pulling in a boot-wait helper.
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
    sleep 2
  done
  log "Emulator booted."
fi

# 2. Start Metro ourselves (single owner) BEFORE the app launches.
log "Starting Metro..."
react-native start &
METRO_PID=$!

# 3. Signal handling: first INT graceful, second INT force.
shutdown() {
  if [ "$GRACE" -eq 0 ]; then
    GRACE=1
    log "Graceful shutdown (Ctrl+C again to force)..."
    kill -TERM "$METRO_PID" 2>/dev/null
    [ "$STARTED_EMU" -eq 1 ] && adb emu kill 2>/dev/null
  else
    log "Force killing..."
    kill -KILL "$METRO_PID" 2>/dev/null
    [ -n "$EMU_PID" ] && kill -KILL "$EMU_PID" 2>/dev/null
  fi
}
trap shutdown INT TERM

# 4. Build + install + launch the app (do not let run-android spawn its own Metro).
log "Building & installing app..."
react-native run-android --no-packager || log "run-android failed (Metro still up)."

# 5. Stay alive on Metro; re-wait across signal-interrupted waits.
while kill -0 "$METRO_PID" 2>/dev/null; do
  wait "$METRO_PID"
done

# 6. Metro exited on its own -> tear down an emulator we booted.
if [ "$GRACE" -eq 0 ] && [ "$STARTED_EMU" -eq 1 ]; then
  log "Metro exited; stopping emulator..."
  adb emu kill 2>/dev/null
fi
log "Done."
