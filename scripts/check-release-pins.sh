#!/usr/bin/env bash
# Assert compose.yaml's image: lines are release-shaped (versioned upstream
# tag + sha256 digest), no `:develop`/`:latest`/`:main` floats. Exits 0 on
# success, 1 with a per-line failure report otherwise.
#
# Used by .github/workflows/release.yml as a gate before tagging — fails the
# release if a maintainer triggered the workflow without first running
# `pin-versions.sh <release> <release>`.
#
# itechuw/certgen is allowed to track `:main` because it has no release
# versioning — `:main` is the convention everywhere in this repo. The
# digest still pins the bytes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=compose.yaml
fail=0

# Extract every `image: <ref>` line as "<line-number>:<ref>" pairs.
# Strip leading whitespace + the literal `image:` prefix.
mapfile -t entries < <(
  grep -nE '^[[:space:]]+image:[[:space:]]+' "$COMPOSE" \
    | sed -E 's|^([0-9]+):[[:space:]]+image:[[:space:]]+|\1:|'
)

for entry in "${entries[@]}"; do
  line="${entry%%:*}"
  ref="${entry#*:}"
  repo="${ref%%:*}"
  rest="${ref#*:}"
  tag="${rest%@*}"
  digest_part="${rest#*@}"

  if [[ "$rest" == "$digest_part" ]] || ! [[ "$digest_part" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "FAIL: ${COMPOSE}:${line} ${ref}" >&2
    echo "      missing or malformed @sha256:<digest> suffix" >&2
    fail=1
    continue
  fi

  if [[ "$repo" != "itechuw/certgen" ]]; then
    case "$tag" in
      develop|latest|main|master|nightly|"")
        echo "FAIL: ${COMPOSE}:${line} tag '${tag}' is a moving label —" >&2
        echo "      release pins must use a versioned upstream tag" >&2
        fail=1
        ;;
    esac
  fi
done

if (( fail )); then
  echo "" >&2
  echo "Release pins are not fully resolved. Re-run pin-versions.sh with" >&2
  echo "release tags before retrying, e.g.:" >&2
  echo "  ./scripts/pin-versions.sh 3.2.1.7 3.0.2" >&2
  exit 1
fi

echo "OK: all ${COMPOSE} image refs are release-shaped (versioned tag + sha256 digest)."
