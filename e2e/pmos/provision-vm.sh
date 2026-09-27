#!/usr/bin/env bash
# G5 helper: one-time, idempotent setup of the running pmOS test VM.
#
# Prerequisites done once by hand (see evidence.md 6.5): the VM-only ssh key
# is in ~/.ssh/authorized_keys of the test user (pmos) and
# /etc/sudoers.d/90-ta-droid-vm grants it passwordless sudo. pmOS grows the
# root filesystem on first boot, so growing the raw image is enough.
#
# This script: log the test user straight into Phosh (greetd initial
# session), keep the screen unlocked, and install the tools the gate uses
# (grim for screenshots, jq, wtype for typing into the app) and the
# WebKitGTK runtime the app links to.
set -euo pipefail
VM="$(dirname "$0")/vm.sh"

"$VM" ssh 'sudo -n sh -s' <<'REMOTE'
set -eu
mkdir -p /etc/greetd /etc/systemd/system/greetd.service.d
cp /etc/phrog/greetd-config.toml /etc/greetd/ta-droid.toml
cat >>/etc/greetd/ta-droid.toml <<'TOML'

# ta-droid test VM: start Phosh for the test user without the greeter.
[initial_session]
# pixman: the VM has no GPU acceleration, and EGL races device permissions
# at early boot, which kills the session.
command = "env WLR_RENDERER=pixman phosh-session"
user = "pmos"
TOML
orig="$(systemctl show -p ExecStart --value greetd.service | sed -n 's/.*argv\[\]=\([^;]*\);.*/\1/p')"
new="$(printf '%s' "$orig" | sed 's| -c [^ ]*||') -c /etc/greetd/ta-droid.toml"
printf '[Service]\nExecStart=\nExecStart=%s\n' "$new" >/etc/systemd/system/greetd.service.d/ta-droid.conf
systemctl daemon-reload
apk add -q grim jq wtype webkit2gtk-4.1 gtk+3.0 libayatana-appindicator
# G5 reaches fake-backends on the host through `ssh -R 8787`; pmOS turns
# TCP forwarding off. The drop-in is read first, so it wins.
printf 'AllowTcpForwarding remote\n' >/etc/ssh/sshd_config.d/90-ta-droid-vm.conf
echo "greetd: $new"
REMOTE

# Phosh locks the screen at session start and when idle; the gate needs the
# app visible, so turn both off for the test user and reboot.
"$VM" ssh 'export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.desktop.session idle-delay 0
mkdir -p ~/.config/systemd/user/mobi.phosh.Shell.service.d
printf "[Service]\nExecStart=\nExecStart=/usr/libexec/phosh --unlocked\n" \
  >~/.config/systemd/user/mobi.phosh.Shell.service.d/ta-droid.conf
# The first-login tour covers the screen; hide it for the test user.
mkdir -p ~/.config/autostart
printf "[Desktop Entry]\nType=Application\nName=Phosh Tour\nHidden=true\n" \
  >~/.config/autostart/mobi.phosh.PhoshTour-first-login.desktop
# Autologin has no password for PAM, so the login keyring stays locked and
# the first secret write pops an unlock prompt. A phone unlocks it with the
# login PIN. Stand in for that with an unencrypted, empty-password login
# keyring, which gnome-keyring opens without asking. Test VM only.
if ! grep -q "^\[keyring\]" ~/.local/share/keyrings/login.keyring 2>/dev/null; then
  systemctl --user stop gnome-keyring-daemon.socket gnome-keyring-daemon.service
  mkdir -p ~/.local/share/keyrings
  printf "[keyring]\ndisplay-name=login\nctime=0\nmtime=0\nlock-on-idle=false\nlock-after=false\n" \
    >~/.local/share/keyrings/login.keyring
  printf "login" >~/.local/share/keyrings/default
fi
'
# greetd runs the initial session only once per boot, so reboot to apply.
"$VM" stop
"$VM" start
