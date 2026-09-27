#!/usr/bin/env bash
# G5 helper: one-time, idempotent setup of the running pmOS test VM.
#
# Prerequisites done once by hand (see evidence.md 0.1 / 2.4): the VM-only
# ssh key is in ~/.ssh/authorized_keys and /etc/sudoers.d/90-ta-droid-vm
# grants the test user passwordless sudo.
#
# This script: log the test user straight into Phosh (greetd initial
# session), keep the screen unlocked, and install the tools the gate uses
# (grim for screenshots, jq).
set -euo pipefail
VM="$(dirname "$0")/vm.sh"

"$VM" ssh 'sudo -n sh -s' <<'REMOTE'
set -eu
mkdir -p /etc/greetd /etc/systemd/system/greetd.service.d
cp /etc/phrog/greetd-config.toml /etc/greetd/ta-droid.toml
cat >>/etc/greetd/ta-droid.toml <<'TOML'

# ta-droid test VM: start Phosh for the test user without the greeter.
[initial_session]
# pixman: the TCG VM has no usable GPU, and EGL races device permissions
# at early boot, which kills the session.
command = "env WLR_RENDERER=pixman phosh-session"
user = "brian"
TOML
orig="$(systemctl show -p ExecStart --value greetd.service | sed -n 's/.*argv\[\]=\([^;]*\);.*/\1/p')"
new="$(printf '%s' "$orig" | sed 's| -c [^ ]*||') -c /etc/greetd/ta-droid.toml"
printf '[Service]\nExecStart=\nExecStart=%s\n' "$new" >/etc/systemd/system/greetd.service.d/ta-droid.conf
systemctl daemon-reload
apk add -q grim jq
echo "greetd: $new"
REMOTE

# Phosh locks the screen at session start and when idle; the gate needs the
# app visible, so turn both off for the test user and reboot.
"$VM" ssh 'export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.desktop.session idle-delay 0
mkdir -p ~/.config/systemd/user/mobi.phosh.Shell.service.d
printf "[Service]\nExecStart=\nExecStart=/usr/libexec/phosh --unlocked\n" \
  >~/.config/systemd/user/mobi.phosh.Shell.service.d/ta-droid.conf
'
# greetd runs the initial session only once per boot, so reboot to apply.
"$VM" stop
"$VM" start
