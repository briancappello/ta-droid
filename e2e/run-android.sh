#!/usr/bin/env bash
# G4: Android end-to-end run on a headless emulator (design D11).
#
# Builds the debug x86_64 APK with the e2e feature, boots the AVD without a
# window on a fixed console port, exposes fake-backends to the device with
# `adb reverse`, and runs the shared WebdriverIO suite through Appium.
# Every background process is tracked by a pidfile and stopped on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/artifacts/g4/run"
AVD="${AVD:-Pixel_8}"
EMU_PORT="${EMU_PORT:-5580}"
export ANDROID_SERIAL="emulator-$EMU_PORT"
# The app always talks to 127.0.0.1:8787 on the device. On the host,
# fake-backends uses its own port so G3 and G4 can run at the same time.
FAKE_PORT=8787
FAKE_HOST_PORT="${FAKE_HOST_PORT:-8788}"
export APPIUM_PORT="${APPIUM_PORT:-4723}"
export APPIUM_HOME="$ROOT/e2e/.appium"
: "${ANDROID_HOME:?ANDROID_HOME must be set (mise sets it)}"
ADB="$ANDROID_HOME/platform-tools/adb"
mkdir -p "$RUN"

stop() {
  "$ADB" -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
  for name in appium fake-backends emulator; do
    local f="$RUN/$name.pid"
    if [[ -f $f ]]; then
      local pid
      pid="$(cat "$f")"
      # Give the emulator a moment to exit after `emu kill` before forcing it.
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill "$pid" 2>/dev/null || true
      rm -f "$f"
    fi
  done
}
trap stop EXIT INT TERM

wait_port() { # host:port, seconds
  local host=${1%:*} port=${1##*:}
  for _ in $(seq 1 "$2"); do
    (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null && return 0
    sleep 1
  done
  echo "timed out waiting for $1" >&2
  return 1
}

# mise runs build:ui first; skip Tauri's own UI build then, so parallel
# gates never write ui/dist at the same time.
TAURI_EXTRA=()
if [[ ${UI_PREBUILT:-0} == 1 ]]; then
  TAURI_EXTRA=(--config '{"build":{"beforeBuildCommand":""}}')
fi

if [[ ${SKIP_BUILD:-0} != 1 ]]; then
  export JAVA_HOME="${JAVA_HOME:-$(mise where java)}"
  (cd "$ROOT/src-tauri" && cargo tauri android build --debug --target x86_64 --apk --features e2e --ci "${TAURI_EXTRA[@]}")
  (cd "$ROOT/src-tauri" && cargo build -p fake-backends)
fi

"$ANDROID_HOME/emulator/emulator" -avd "$AVD" -port "$EMU_PORT" -no-window -no-audio \
  -no-boot-anim -no-snapshot -gpu swiftshader_indirect >"$RUN/emulator.log" 2>&1 &
echo $! >"$RUN/emulator.pid"
"$ADB" -s "$ANDROID_SERIAL" wait-for-device
for _ in $(seq 1 180); do
  [[ "$("$ADB" -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && break
  sleep 2
done
[[ "$("$ADB" -s "$ANDROID_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]

"$ROOT/src-tauri/target/debug/fake-backends" --addr "127.0.0.1:$FAKE_HOST_PORT" \
  --log "$RUN/requests.jsonl" >"$RUN/fake-backends.log" 2>&1 &
echo $! >"$RUN/fake-backends.pid"
wait_port "127.0.0.1:$FAKE_HOST_PORT" 20
"$ADB" -s "$ANDROID_SERIAL" reverse "tcp:$FAKE_PORT" "tcp:$FAKE_HOST_PORT"

(cd "$ROOT/e2e" && pnpm exec appium --port "$APPIUM_PORT" \
  --allow-insecure uiautomator2:chromedriver_autodownload >"$RUN/appium.log" 2>&1) &
echo $! >"$RUN/appium.pid"
wait_port "127.0.0.1:$APPIUM_PORT" 60

cd "$ROOT/e2e"
pnpm run android
