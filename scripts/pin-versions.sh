#!/usr/bin/env bash
# Resolve upstream image digests and rewrite .env in place.
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
# re-resolves whatever's currently in .env (useful for refreshing a
# `:develop` snapshot to today's digest).
#
# After running, review:  git diff .env  →  commit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Read current versions from .env (so re-running with no args refreshes digests
# without changing tags).
get_env() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
CUR_OE="$(get_env OE_VERSION)"
CUR_BRIDGE="$(get_env OE_BRIDGE_VERSION)"

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

declare -A NEW_VALUES=(
  [OE_VERSION]="$OE_VERSION"
  [OE_BRIDGE_VERSION]="$BRIDGE_VERSION"
  [OE_WEBAPP_IMAGE]="$(resolve itechuw/openelis-global-2 "$OE_VERSION")"
  [OE_FRONTEND_IMAGE]="$(resolve itechuw/openelis-global-2-frontend "$OE_VERSION")"
  [OE_DATABASE_IMAGE]="$(resolve itechuw/openelis-global-2-database "$OE_VERSION")"
  [OE_FHIR_IMAGE]="$(resolve itechuw/openelis-global-2-fhir "$OE_VERSION")"
  [OE_PROXY_IMAGE]="$(resolve itechuw/openelis-global-2-proxy "$OE_VERSION")"
  [OE_BRIDGE_IMAGE]="$(resolve itechuw/openelis-analyzer-bridge "$BRIDGE_VERSION")"
  [OE_CERTGEN_IMAGE]="$(resolve itechuw/certgen "$CERTGEN_TAG")"
)

# Update .env in place: replace existing keys, append missing ones.
for key in "${!NEW_VALUES[@]}"; do
  value="${NEW_VALUES[$key]}"
  if grep -qE "^${key}=" .env; then
    # Use a delimiter that won't appear in the digest (|).
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
done

echo "Pinned to OE ${OE_VERSION}, bridge ${BRIDGE_VERSION}."
echo "Review:  git diff .env  →  commit."
