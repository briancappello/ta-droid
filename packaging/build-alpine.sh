#!/usr/bin/env bash
# Build the musl Linux app for postmarketOS in rootless podman (design D11).
#
#   packaging/build-alpine.sh [x86_64|aarch64]   -> artifacts/alpine/<arch>/{ta-droid,ta-droid-*.apk}
#
# The UI is architecture-independent, so it is built on the host first
# (ui/dist) and the container only compiles Rust. Cargo's registry and target
# directories live in named volumes so repeated builds are incremental.
#
# TA_DROID_CONFIG picks the embedded app config, as on the host (build.rs).
# Paths under the repo are passed through; the G5 gate embeds the e2e config
# and writes to ALPINE_OUT=artifacts/g5/pkg so it never passes for a real build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-x86_64}"
case "$ARCH" in
  x86_64) PLATFORM=linux/amd64 ;;
  aarch64) PLATFORM=linux/arm64 ;;
  *) echo "usage: $0 [x86_64|aarch64]" >&2; exit 2 ;;
esac
IMAGE="ta-droid-builder-alpine-$ARCH"
OUT="${ALPINE_OUT:-$ROOT/artifacts/alpine/$ARCH}"
mkdir -p "$OUT"

if [[ ${REBUILD_IMAGE:-0} == 1 ]] || ! podman image exists "$IMAGE"; then
  podman build --platform "$PLATFORM" -t "$IMAGE" \
    -f "$ROOT/packaging/builders/alpine.Containerfile" "$ROOT/packaging/builders"
fi
[[ -f $ROOT/ui/dist/index.html ]] || { echo "ui/dist missing: run mise run build:ui" >&2; exit 1; }

# ALPINE_FAST=1 (the G5 gate): skip fat LTO, which relinks for ~3 minutes on
# every UI change. It gets a target volume of its own so the release cache
# is not thrown away.
FAST_ENV=() SUFFIX=""
if [[ ${ALPINE_FAST:-0} == 1 ]]; then
  FAST_ENV=(-e CARGO_PROFILE_RELEASE_LTO=off -e CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16)
  SUFFIX="-fast"
fi

CONFIG_ENV=()
if [[ -n ${TA_DROID_CONFIG:-} ]]; then
  rel="$(realpath --relative-to="$ROOT" "$TA_DROID_CONFIG")"
  [[ $rel != ../* ]] || { echo "TA_DROID_CONFIG must be inside the repo" >&2; exit 2; }
  CONFIG_ENV=(-e "TA_DROID_CONFIG=/src/$rel")
fi

# Compile, then package the binary with abuild (packaging/alpine/APKBUILD).
# The package is signed with a throwaway key made per build; install it with
# `apk add --allow-untrusted`.
podman run --rm --platform "$PLATFORM" --userns=keep-id \
  -v "$ROOT:/src:z" -v "$OUT:/out:z" \
  -v "ta-droid-cargo-alpine-$ARCH:/opt/cargo/registry" \
  -v "ta-droid-target-alpine-$ARCH$SUFFIX:/target" \
  -e CARGO_TARGET_DIR=/target -e HOME=/tmp/home "${CONFIG_ENV[@]}" "${FAST_ENV[@]}" -w /src/src-tauri \
  "$IMAGE" sh -euc '
    cargo build --release --locked -p ta-droid --features tauri/custom-protocol
    install -m755 /target/release/ta-droid /out/ta-droid
    mkdir -p "$HOME" /tmp/apk && cd /tmp/apk
    cp /src/packaging/alpine/APKBUILD /src/packaging/alpine/com.briancappello.ta-droid.desktop .
    cp /target/release/ta-droid .
    cp /src/src-tauri/icons/128x128.png com.briancappello.ta-droid.png
    abuild-keygen -a -n -q 2>/dev/null
    abuild checksum
    # No repository index: the key is throwaway and the apk is installed directly.
    abuild -d -P /tmp/repo sanitycheck fetch verify unpack prepare build rootpkg
    rm -f /out/*.apk
    cp /tmp/repo/*/*/ta-droid-*.apk /out/'
ls -la "$OUT"
