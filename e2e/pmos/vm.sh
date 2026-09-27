#!/usr/bin/env bash
# G5 helper: control the postmarketOS qemu-amd64 test VM (design D11).
#
#   vm.sh start           boot the VM (KVM, UEFI) and wait for ssh
#   vm.sh stop            power it off cleanly (pidfile fallback)
#   vm.sh ssh CMD..       run a command in the VM as the test user
#   vm.sh scp SRC DST     copy a host file to DST in the VM
#   vm.sh shot OUT        save a PNG of the Phosh screen
#   vm.sh app-start CMD   run CMD in the Phosh session as a user unit
#   vm.sh app-stop        stop it
#   vm.sh status          print "running" or "stopped"
#
# State lives in ~/.local/share/ta-droid/pmos (image, OVMF vars, VM-only key).
# PMOS_DISPLAY=gtk opens a window for manual QA (default: none, headless).
# The window cannot be closed (a hard power-off); stop the VM with `vm.sh stop`.
set -euo pipefail

D="${PMOS_DIR:-$HOME/.local/share/ta-droid/pmos}"
PORT="${PMOS_SSH_PORT:-2222}"
USER_="${PMOS_USER:-pmos}"
OVMF_CODE="${PMOS_OVMF_CODE:-/usr/share/edk2/x64/OVMF_CODE.4m.fd}"
DISPLAY_OPT="${PMOS_DISPLAY:-none}"
# window-close=off: closing the window would be a hard power-off.
[[ $DISPLAY_OPT == gtk ]] && DISPLAY_OPT="gtk,zoom-to-fit=on,window-close=off"
PIDFILE="$D/qemu.pid"
SSH_OPTS=(-i "$D/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes
  -o UserKnownHostsFile="$D/known_hosts" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5)
SSH=(ssh -p "$PORT" "${SSH_OPTS[@]}" "$USER_@127.0.0.1")
# The session environment of the test user, for commands run over ssh.
SESSION_ENV='export XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus'

running() { [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "already running"; exit 0; fi
    # setsid: the VM must outlive the shell that started it.
    setsid qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 4 -m 4096 \
      -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
      -drive if=pflash,format=raw,file="$D/ovmf-vars.fd" \
      -drive file="$D/qemu-amd64.img",format=raw,if=virtio \
      -netdev user,id=n0,hostfwd=tcp:127.0.0.1:"$PORT"-:22 -device virtio-net-pci,netdev=n0 \
      -device virtio-vga -device qemu-xhci -device usb-kbd -device usb-tablet \
      -display "$DISPLAY_OPT" -serial file:"$D/serial.log" \
      >"$D/qemu.out" 2>&1 </dev/null &
    echo $! >"$PIDFILE"
    for _ in $(seq 1 90); do
      "${SSH[@]}" true 2>/dev/null && { echo "ssh up"; exit 0; }
      running || { echo "qemu exited:"; cat "$D/qemu.out"; exit 1; }
      sleep 2
    done
    echo "timed out waiting for ssh" >&2; exit 1
    ;;
  stop)
    if running; then
      "${SSH[@]}" 'sudo -n poweroff' >/dev/null 2>&1 || true
      for _ in $(seq 1 30); do running || break; sleep 1; done
      running && kill "$(cat "$PIDFILE")"
    fi
    rm -f "$PIDFILE"
    ;;
  ssh) shift; exec "${SSH[@]}" "$@" ;;
  scp) exec scp -q -P "$PORT" "${SSH_OPTS[@]}" "${2:?source}" "$USER_@127.0.0.1:${3:?destination}" ;;
  shot)
    # Capture the Phosh screen of the test user's session to $2.
    "${SSH[@]}" "$SESSION_ENV; grim -t png -" >"${2:?output path}"
    ;;
  app-start)
    # A process started from ssh dies with the ssh session, so run the app
    # as a transient user unit inside the Phosh session instead.
    shift
    "${SSH[@]}" "$SESSION_ENV
      systemctl --user stop ta-droid-app 2>/dev/null; systemctl --user reset-failed ta-droid-app 2>/dev/null
      systemd-run --user --quiet --unit=ta-droid-app --collect $*"
    ;;
  app-stop)
    "${SSH[@]}" "$SESSION_ENV; systemctl --user stop ta-droid-app 2>/dev/null || true"
    ;;
  status) running && echo running || echo stopped ;;
  *) echo "usage: $0 start|stop|ssh CMD...|scp SRC DST|shot OUT|app-start CMD|app-stop|status" >&2; exit 2 ;;
esac
