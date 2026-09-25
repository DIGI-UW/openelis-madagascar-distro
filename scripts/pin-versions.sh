#!/usr/bin/env bash
# Rewrite docker-compose.yml image tags to a target release version.
#
# Usage:
#   ./scripts/pin-versions.sh                       # no-op, current pins reported
#   ./scripts/pin-versions.sh 3.2.1.7               # bump OE images to 3.2.1.7; bridge unchanged
#   ./scripts/pin-versions.sh 3.2.1.7 3.0.2         # bump OE + bridge
#   ./scripts/pin-versions.sh develop develop       # both back to develop
#
# OE component tags follow the requested upstream version. The Bridge reference
# comes from the validated analyzer catalog manifest, including its immutable
# digest. Changing Bridge requires updating and validating that manifest first.
#
# After running, review:  git diff docker-compose.yml  →  commit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=docker-compose.yml

# Read the current tag for a given image repo from docker-compose.yml's image: lines.
get_current_tag() {
  local repo="$1"
  grep -E "image:[[:space:]]*${repo}:" "$COMPOSE" \
    | head -n1 \
    | sed -E "s|.*${repo}:([^@[:space:]]+).*|\1|"
}

OE_REPOS=(
  itechuw/openelis-global-2
  itechuw/openelis-global-2-frontend
  itechuw/openelis-global-2-database
  itechuw/openelis-global-2-fhir
  itechuw/openelis-global-2-proxy
)
BRIDGE_REPO=itechuw/openelis-analyzer-bridge
CERTGEN_REPO=itechuw/certgen

CUR_OE="$(get_current_tag "${OE_REPOS[0]}")"
CUR_BRIDGE="$(get_current_tag "$BRIDGE_REPO")"

OE_VERSION="${1:-${CUR_OE:-3.2.1.6}}"
BRIDGE_VERSION="${2:-${CUR_BRIDGE:-3.0.1}}"
CERTGEN_TAG="main"

BRIDGE_PIN="$(python3 - "$BRIDGE_VERSION" <<'PY_PIN'
import json,sys
image=json.load(open('configs/analyzer-catalog-manifest.json'))['bridgeImage']
expected='itechuw/openelis-analyzer-bridge:'+sys.argv[1]+'@sha256:'
if not image.startswith(expected):
    raise SystemExit('Requested Bridge version does not match the validated catalog manifest; update and validate the catalog before release')
print(image.split(':',1)[1])
PY_PIN
)"


# Rewrite a single image: line. Matches `image: <repo>:<anything>` (with or
# without a trailing @sha256:digest) and replaces the whole reference with
# `repo:tag`. Leading whitespace is preserved.
update_image() {
  local repo="$1" new_tag="$2"
  sed -i.bak -E "s|(image:[[:space:]]+)${repo}:[^[:space:]]+|\1${repo}:${new_tag}|" "$COMPOSE"
  rm -f "${COMPOSE}.bak"
}

for repo in "${OE_REPOS[@]}"; do
  update_image "$repo" "$OE_VERSION"
done
update_image "$BRIDGE_REPO"  "$BRIDGE_PIN"
update_image "$CERTGEN_REPO" "$CERTGEN_TAG"

echo "Pinned to OE ${OE_VERSION}, bridge ${BRIDGE_VERSION}."
echo "Review:  git diff ${COMPOSE}  →  commit."
