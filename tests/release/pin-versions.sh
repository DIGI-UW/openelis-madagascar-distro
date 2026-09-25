#!/usr/bin/env bash
# A release must not strip the tested Bridge digest or silently swap its version.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT
mkdir -p "$CHECK_DIR/scripts" "$CHECK_DIR/configs"
cp "$ROOT/scripts/pin-versions.sh" "$CHECK_DIR/scripts/"
cp "$ROOT/configs/analyzer-catalog-manifest.json" "$CHECK_DIR/configs/"
cp "$ROOT/docker-compose.yml" "$CHECK_DIR/"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bridgeImage"].split(":",1)[1].split("@",1)[0])' "$CHECK_DIR/configs/analyzer-catalog-manifest.json")"
bash "$CHECK_DIR/scripts/pin-versions.sh" develop "$version" >/dev/null
python3 - "$CHECK_DIR" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);image=json.loads((root/'configs/analyzer-catalog-manifest.json').read_text())['bridgeImage']
assert 'image: '+image in (root/'docker-compose.yml').read_text(), 'release stripped the tested Bridge digest'
PY
cp "$CHECK_DIR/docker-compose.yml" "$CHECK_DIR/before.yml"
if bash "$CHECK_DIR/scripts/pin-versions.sh" should-not-write unvalidated-version >/dev/null 2>&1; then
  echo 'Unexpectedly accepted a Bridge version outside the catalog manifest' >&2
  exit 1
fi
cmp "$CHECK_DIR/before.yml" "$CHECK_DIR/docker-compose.yml"
echo 'PASS release preserves Bridge digest and rejects an unvalidated version before changing Compose'
