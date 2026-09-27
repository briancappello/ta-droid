#!/usr/bin/env bash
# Generate the ts-rs TypeScript bindings (design D3).
#   scripts/bindings.sh          regenerate ui/src/bindings
#   scripts/bindings.sh --check  fail if ui/src/bindings is stale
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
(cd "$ROOT/src-tauri" && TS_RS_EXPORT_DIR="$OUT" cargo test -q --workspace --lib export_bindings >/dev/null)
if [[ ${1:-} == --check ]]; then
  if ! diff -r "$OUT" "$ROOT/ui/src/bindings"; then
    echo "ui/src/bindings is stale: run 'mise run bindings'" >&2
    exit 1
  fi
  echo "bindings up to date"
else
  rm -rf "$ROOT/ui/src/bindings"
  cp -r "$OUT" "$ROOT/ui/src/bindings"
  echo "wrote ui/src/bindings"
fi
