#!/usr/bin/env bash
# Resolve upstream image digests and rewrite compose.yaml in place.
#
# Bump cadence — accepts any published upstream tag (release name or
# `develop`), each gets resolved to a manifest-list digest:
#
#   ./scripts/pin-versions.sh                       # refresh digests, current pinned tags
#   ./scripts/pin-versions.sh 3.2.1.7               # bump OE to 3.2.1.7 release; bridge unchanged
#   ./scripts/pin-versions.sh 3.2.1.7 3.0.2         # bump OE + bridge to release tags
#   ./scripts/pin-versions.sh develop 3.0.1         # pin OE to current :develop snapshot; bridge to release
#   ./scripts/pin-versions.sh develop develop       # both pinned to current develop snapshots
#
# Whatever tag you pass is the human-readable label; the digest fetched
# alongside it is what docker actually pulls. Re-running with no args
# re-resolves whatever's currently in compose.yaml (useful for refreshing
# a `:develop` snapshot to today's digest).
#
# After running, review:  git diff compose.yaml  →  commit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=compose.yaml

# Read the current tag for a given image repo from compose.yaml's image: lines.
# Allows re-running with no args to refresh digests on whatever tag is pinned.
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

resolve() {
  local repo="$1" tag="$2" digest
  # Prefer the manifest-list digest (.digest). For multi-arch images this
  # lets docker resolve to the matching `platform:` entry at pull time,
  # which is the right behavior under our linux/amd64 services. The
  # per-arch fallback (.images[].digest) is only used when the registry
  # response lacks a manifest-list digest.
  digest="$(curl -sfL "https://hub.docker.com/v2/repositories/${repo}/tags/${tag}" \
    | jq -r '.digest // .images[0].digest // empty')"
  if [[ -z "$digest" ]]; then
    echo "ERROR: no digest for ${repo}:${tag}" >&2
    exit 1
  fi
  echo "${repo}:${tag}@${digest}"
}

# Rewrite a single image: line. Matches `image: <repo>:<anything>` and replaces
# the whole reference. The leading whitespace is preserved by anchoring the
# match on `image:` rather than the full line.
update_image() {
  local repo="$1" new_ref="$2"
  # Use | as sed delimiter — digest hex never contains it.
  sed -i.bak -E "s|(image:[[:space:]]+)${repo}:[^[:space:]]+|\1${new_ref}|" "$COMPOSE"
  rm -f "${COMPOSE}.bak"
}

for repo in "${OE_REPOS[@]}"; do
  update_image "$repo" "$(resolve "$repo" "$OE_VERSION")"
done
update_image "$BRIDGE_REPO"  "$(resolve "$BRIDGE_REPO"  "$BRIDGE_VERSION")"
update_image "$CERTGEN_REPO" "$(resolve "$CERTGEN_REPO" "$CERTGEN_TAG")"

echo "Pinned to OE ${OE_VERSION}, bridge ${BRIDGE_VERSION}."
echo "Review:  git diff ${COMPOSE}  →  commit."
