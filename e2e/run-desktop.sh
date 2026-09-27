#!/usr/bin/env bash
# G3: desktop end-to-end run (design D11).
#
# Builds the app with the e2e feature, then starts headless weston,
# fake-backends, and tauri-driver, and runs the WebdriverIO suite.
# Every background process is tracked by a pidfile and stopped on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/artifacts/g3/run"
SOCKET="ta-droid-e2e-$$"
FAKE_ADDR="${FAKE_ADDR:-127.0.0.1:8787}"
DRIVER_PORT="${TAURI_DRIVER_PORT:-4444}"
mkdir -p "$RUN"
: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR

stop() {
  for name in tauri-driver fake-backends weston; do
    local f="$RUN/$name.pid"
    if [[ -f $f ]]; then
      kill "$(cat "$f")" 2>/dev/null || true
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

if [[ ${SKIP_BUILD:-0} != 1 ]]; then
  (cd "$ROOT/src-tauri" && cargo tauri build --debug --no-bundle --features e2e)
  (cd "$ROOT/src-tauri" && cargo build -p fake-backends)
fi

weston --backend=headless --socket="$SOCKET" --idle-time=0 >"$RUN/weston.log" 2>&1 &
echo $! >"$RUN/weston.pid"
for _ in $(seq 1 20); do [[ -S $XDG_RUNTIME_DIR/$SOCKET ]] && break; sleep 0.5; done

"$ROOT/src-tauri/target/debug/fake-backends" --addr "$FAKE_ADDR" --log "$RUN/requests.jsonl" \
  >"$RUN/fake-backends.log" 2>&1 &
echo $! >"$RUN/fake-backends.pid"
wait_port "$FAKE_ADDR" 20

WAYLAND_DISPLAY="$SOCKET" GDK_BACKEND=wayland LIBGL_ALWAYS_SOFTWARE=1 \
  tauri-driver --port "$DRIVER_PORT" >"$RUN/tauri-driver.log" 2>&1 &
echo $! >"$RUN/tauri-driver.pid"
wait_port "127.0.0.1:$DRIVER_PORT" 20

cd "$ROOT/e2e"
TAURI_DRIVER_PORT="$DRIVER_PORT" pnpm run desktop
