#!/usr/bin/env bash
# Assemble a release-notes markdown body for a distro release.
#
# This repo packages OpenELIS Global + the Analyzer Bridge — release
# notes are constructed from three sources:
#   1. Distro changes since the previous tag, via git log.
#   2. The upstream OE Release body, via gh api.
#   3. The upstream Analyzer Bridge Release body, via gh api.
#
# If an upstream release doesn't exist (e.g. the pin is `develop`), the
# section gracefully degrades to a link.
#
# Required env vars:
#   DISTRO_VERSION   — e.g. 3.2.2.0
#   OE_VERSION       — e.g. 3.2.1.6
#   BRIDGE_VERSION   — e.g. 3.0.1
#   PREVIOUS_TAG     — previous distro tag (may be empty for first release)
#   GH_TOKEN         — for gh api authentication
#
# Output: markdown notes printed to stdout.
set -euo pipefail

OE_REPO="${OE_REPO:-DIGI-UW/OpenELIS-Global-2}"
BRIDGE_REPO="${BRIDGE_REPO:-DIGI-UW/openelis-analyzer-bridge}"

oe_release_url="https://github.com/${OE_REPO}/releases/tag/${OE_VERSION}"
bridge_release_url="https://github.com/${BRIDGE_REPO}/releases/tag/${BRIDGE_VERSION}"

# Pull an upstream release body if one exists; fall back to a "no notes"
# stub linking the upstream releases page.
fetch_upstream_body() {
  local repo="$1" tag="$2" body
  body="$(gh api "repos/${repo}/releases/tags/${tag}" --jq '.body' 2>/dev/null || true)"
  if [[ -z "$body" || "$body" == "null" ]]; then
    printf '_No upstream GitHub Release published for `%s`. See [%s releases](https://github.com/%s/releases) for the upstream changelog._\n' \
      "$tag" "$repo" "$repo"
  else
    printf '%s\n' "$body"
  fi
}

cat <<EOF
# OpenELIS Madagascar Distro ${DISTRO_VERSION}

Packaged components:

- **OpenELIS Global**: \`${OE_VERSION}\` — [upstream release notes](${oe_release_url})
- **Analyzer Bridge**: \`${BRIDGE_VERSION}\` — [upstream release notes](${bridge_release_url})

EOF

if [[ -n "${PREVIOUS_TAG:-}" ]] && git rev-parse --verify --quiet "${PREVIOUS_TAG}" > /dev/null; then
  printf '## Distro changes since `%s`\n\n' "$PREVIOUS_TAG"
  log="$(git log --pretty=format:'- %s' "${PREVIOUS_TAG}..HEAD" || true)"
  if [[ -z "$log" ]]; then
    echo "_(no commits)_"
  else
    printf '%s\n' "$log"
  fi
  echo
else
  cat <<'EOF'
## Distro changes

_First tagged release — no previous distro tag for diff._
EOF
fi

printf '\n## OpenELIS Global %s\n\n' "$OE_VERSION"
fetch_upstream_body "$OE_REPO" "$OE_VERSION"

printf '\n## Analyzer Bridge %s\n\n' "$BRIDGE_VERSION"
fetch_upstream_body "$BRIDGE_REPO" "$BRIDGE_VERSION"
