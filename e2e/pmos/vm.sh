#!/usr/bin/env bash
# G5 helper: control the postmarketOS aarch64 test VM (design D11).
#
#   vm.sh start      boot the VM (TCG) and wait for ssh
#   vm.sh stop       power it off (pidfile)
#   vm.sh ssh CMD..  run a command in the VM as the test user
#   vm.sh shot OUT   save a PNG of the Phosh screen
#   vm.sh status     print "running" or "stopped"
#
# State lives in ~/.local/share/ta-droid/pmos (image, firmware, VM-only key).
set -euo pipefail

D="${PMOS_DIR:-$HOME/.local/share/ta-droid/pmos}"
PORT="${PMOS_SSH_PORT:-2222}"
PIDFILE="$D/qemu.pid"
SSH=(ssh -p "$PORT" -i "$D/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes
  -o UserKnownHostsFile="$D/known_hosts" -o ConnectTimeout=5 brian@127.0.0.1)

running() { [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "already running"; exit 0; fi
    # setsid: the VM must outlive the shell that started it.
    setsid qemu-system-aarch64 -machine virt -cpu max -smp 4 -m 4096 \
      -drive if=pflash,format=raw,readonly=on,file="$D/QEMU_EFI.fd" \
      -drive if=pflash,format=raw,file="$D/vars.fd" \
      -drive file="$D/qemu-aarch64.img",format=raw,if=virtio \
      -netdev user,id=n0,hostfwd=tcp:127.0.0.1:"$PORT"-:22 -device virtio-net-pci,netdev=n0 \
      -device virtio-gpu-pci -device qemu-xhci -device usb-kbd -device usb-tablet \
      -display none -serial file:"$D/serial.log" \
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
  shot)
    # Capture the Phosh screen of the test user's session to $2.
    "${SSH[@]}" 'XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 grim -t png -' >"${2:?output path}"
    ;;
  status) running && echo running || echo stopped ;;
  *) echo "usage: $0 start|stop|ssh CMD...|shot OUT|status" >&2; exit 2 ;;
esac
