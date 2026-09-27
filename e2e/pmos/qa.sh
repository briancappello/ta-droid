#!/usr/bin/env bash
# Manual QA in the postmarketOS VM, in the foreground.
#
# Boots the VM with a window (unless it is already running), starts
# fake-backends on the host, and opens the `ssh -R 8787` tunnel that the
# e2e-config app in the VM uses. Press Ctrl-C to stop the tunnel and
# fake-backends and to power the VM off cleanly (only if this script booted it).
#
# The app in the VM is the package that `mise run e2e:pmos` installed. Open it
# from the Phosh app grid. The mouse acts as touch, and the host keyboard types.
# Do not run `mise run e2e:pmos` at the same time: both use port 8787.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VM="$ROOT/e2e/pmos/vm.sh"
D="${PMOS_DIR:-$HOME/.local/share/ta-droid/pmos}"
RUN="$ROOT/artifacts/qa"
FAKE_ADDR=127.0.0.1:8787
export CARGO_TARGET_DIR="$ROOT/src-tauri/target/e2e"
mkdir -p "$RUN"

STARTED=0
cleanup() {
  trap - EXIT INT TERM
  for name in tunnel fake-backends; do
    if [[ -f $RUN/$name.pid ]]; then kill "$(cat "$RUN/$name.pid")" 2>/dev/null || true; rm -f "$RUN/$name.pid"; fi
  done
  if [[ $STARTED == 1 ]]; then echo "powering the VM off..."; "$VM" stop; fi
  exit 0
}
trap cleanup EXIT INT TERM

cargo build -q --manifest-path "$ROOT/src-tauri/Cargo.toml" -p fake-backends
if [[ "$("$VM" status)" != running ]]; then PMOS_DISPLAY="${PMOS_DISPLAY:-gtk}" "$VM" start; STARTED=1; fi
"$VM" ssh 'command -v ta-droid >/dev/null' \
  || echo "note: ta-droid is not installed in the VM; run mise run e2e:pmos once" >&2

"$CARGO_TARGET_DIR/debug/fake-backends" --addr "$FAKE_ADDR" --log "$RUN/requests.jsonl" \
  >"$RUN/fake-backends.log" 2>&1 &
echo $! >"$RUN/fake-backends.pid"
ssh -p "${PMOS_SSH_PORT:-2222}" -i "$D/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o UserKnownHostsFile="$D/known_hosts" -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -N \
  -R "$FAKE_ADDR:$FAKE_ADDR" "${PMOS_USER:-pmos}@127.0.0.1" >"$RUN/tunnel.log" 2>&1 &
echo $! >"$RUN/tunnel.pid"

echo "QA ready: fake-backends on $FAKE_ADDR, tunneled into the VM. Requests log: $RUN/requests.jsonl"
echo "Passphrase for the provisioning screen: $(tr -d '\n' <"$ROOT/e2e/fixtures/passphrase.txt")"
echo "Press Ctrl-C to stop."
wait "$(cat "$RUN/tunnel.pid")" || { echo "tunnel exited: $(cat "$RUN/tunnel.log")" >&2; exit 1; }
