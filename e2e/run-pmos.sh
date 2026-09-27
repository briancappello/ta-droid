#!/usr/bin/env bash
# G5: postmarketOS end-to-end in the qemu-amd64 VM (design D11, tasks 6.6, 7.2).
#
# Installs the x86_64 apk from packaging/build-alpine.sh (built with the e2e
# config, without the e2e feature, so secrets go to the Secret Service), then
# in the Phosh session:
#   1. the app starts at the provisioning gate, with no secrets stored;
#   2. typing the passphrase provisions it: secrets land in the Secret
#      Service and the shell loads watchlists from fake-backends;
#   3. after a restart the shell loads again with no gate and no keyring
#      prompt, so the secrets came back from the Secret Service.
# The VM reaches fake-backends on the host through `ssh -R 8787`, so the e2e
# config (127.0.0.1:8787) works unchanged. Screenshots go to artifacts/g5.
# The VM is stopped on exit only if this script started it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VM="$ROOT/e2e/pmos/vm.sh"
D="${PMOS_DIR:-$HOME/.local/share/ta-droid/pmos}"
APK="$(ls "$ROOT"/artifacts/g5/pkg/ta-droid-*.apk 2>/dev/null | head -1 || true)"
OUT="$ROOT/artifacts/g5"
RUN="$OUT/run"
FAKE_ADDR=127.0.0.1:8787
export CARGO_TARGET_DIR="$ROOT/src-tauri/target/e2e"
FAKE="$CARGO_TARGET_DIR/debug/fake-backends"
mkdir -p "$RUN"
[[ -f $APK ]] || { echo "missing apk: run mise run e2e:pmos" >&2; exit 1; }

STARTED=0
cleanup() {
  "$VM" app-stop >/dev/null 2>&1 || true
  for name in tunnel fake-backends; do
    if [[ -f $RUN/$name.pid ]]; then kill "$(cat "$RUN/$name.pid")" 2>/dev/null || true; rm -f "$RUN/$name.pid"; fi
  done
  if [[ $STARTED == 1 ]]; then "$VM" stop; fi
}
trap cleanup EXIT INT TERM

fail() { echo "G5 FAIL: $*" >&2; exit 1; }
# Run a command in the VM with the Phosh session environment.
in_session() { "$VM" ssh "export XDG_RUNTIME_DIR=/run/user/\$(id -u) WAYLAND_DISPLAY=wayland-0; $1"; }
# Number of secrets in the login collection (the app's Secret Service items).
secret_count() {
  in_session "busctl --user get-property org.freedesktop.secrets \
    /org/freedesktop/secrets/collection/login org.freedesktop.Secret.Collection Items" | awk '{print $2}'
}
# Requests the app shell makes once it is past the gate.
shell_loads() { grep -c '"path":"/marketstore/v1/watchlists"' "$RUN/requests.jsonl" 2>/dev/null || true; }
wait_for() { # description, seconds, shell expression (re-evaluated every second)
  local what=$1 secs=$2 expr=$3
  for _ in $(seq 1 "$secs"); do eval "$expr" && return 0; sleep 1; done
  fail "timed out: $what"
}
no_prompt() { ! in_session 'pgrep -x gcr-prompter >/dev/null'; }

cargo build -q --manifest-path "$ROOT/src-tauri/Cargo.toml" -p fake-backends

if [[ "$("$VM" status)" != running ]]; then "$VM" start; STARTED=1; fi
wait_for "Phosh session" 60 "in_session 'test -S \$XDG_RUNTIME_DIR/wayland-0'"

rm -f "$RUN/requests.jsonl"
"$FAKE" --addr "$FAKE_ADDR" --log "$RUN/requests.jsonl" >"$RUN/fake-backends.log" 2>&1 &
echo $! >"$RUN/fake-backends.pid"
ssh -p "${PMOS_SSH_PORT:-2222}" -i "$D/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o UserKnownHostsFile="$D/known_hosts" -o ExitOnForwardFailure=yes -N \
  -R "$FAKE_ADDR:$FAKE_ADDR" "${PMOS_USER:-pmos}@127.0.0.1" >"$RUN/tunnel.log" 2>&1 &
echo $! >"$RUN/tunnel.pid"
wait_for "fake-backends through the tunnel" 20 \
  '"$VM" ssh "wget -q -O /dev/null http://$FAKE_ADDR/marketstore/v1/health"'

# Fresh install and state: no app data, no secrets in the login collection.
"$VM" app-stop
in_session 'sudo -n apk del -q ta-droid >/dev/null 2>&1 || true
  rm -rf ~/.local/share/com.briancappello.ta-droid
  # The passwordless login keyring (provision-vm.sh) opens without a prompt.
  busctl --user call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service \
    Unlock ao 1 /org/freedesktop/secrets/collection/login >/dev/null
  for item in $(busctl --user get-property org.freedesktop.secrets \
      /org/freedesktop/secrets/collection/login org.freedesktop.Secret.Collection Items | cut -d" " -f3-); do
    busctl --user call org.freedesktop.secrets "$(echo "$item" | tr -d \")" org.freedesktop.Secret.Item Delete >/dev/null
  done'
"$VM" scp "$APK" /tmp/ta-droid.apk
in_session 'sudo -n apk add -q --allow-untrusted /tmp/ta-droid.apk && rm /tmp/ta-droid.apk'
in_session 'test -x /usr/bin/ta-droid && test -f /usr/share/applications/com.briancappello.ta-droid.desktop' \
  || fail "package did not install the binary and the desktop entry"

# 1. First launch: the provisioning gate, nothing stored.
[[ $(secret_count) == 0 ]] || fail "secrets present before provisioning"
"$VM" app-start /usr/bin/ta-droid
sleep "${PMOS_SETTLE:-8}"
in_session 'systemctl --user is-active --quiet ta-droid-app' || fail "app is not running"
"$VM" shot "$OUT/01-gate.png"
[[ $(shell_loads) == 0 ]] || fail "the shell loaded before provisioning"

# 2. Provision through the UI.
PASS="$(tr -d '\n' <"$ROOT/e2e/fixtures/passphrase.txt")"
in_session "wtype -k Tab; wtype '$PASS'; wtype -k Return"
wait_for "secrets saved to the Secret Service" 60 '[[ $(secret_count) -gt 0 ]]'
wait_for "shell loads after provisioning" 30 '[[ $(shell_loads) -gt 0 ]]'
no_prompt || fail "a keyring prompt appeared while provisioning"
SECRETS="$(secret_count)"
sleep 3
"$VM" shot "$OUT/02-provisioned.png"

# 3. Restart: straight to the shell from the Secret Service, no prompt.
BEFORE="$(shell_loads)"
"$VM" app-stop
"$VM" app-start /usr/bin/ta-droid
wait_for "shell loads after restart" 60 '[[ $(shell_loads) -gt $BEFORE ]]'
no_prompt || fail "a keyring prompt appeared after restart"
[[ $(secret_count) == "$SECRETS" ]] || fail "secret count changed across restart"
sleep 3
"$VM" shot "$OUT/03-restarted.png"

echo "G5: installed the apk, provisioned through the UI ($SECRETS secrets), restarted from the Secret Service; screenshots in $OUT"
