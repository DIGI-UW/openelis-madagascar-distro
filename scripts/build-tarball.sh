#!/usr/bin/env bash
# Build a release tarball of this distro.
#
# Output: openelis-madagascar-distro-<ref>.tar.gz at the repo root, with
# a top-level openelis-madagascar-distro-<ref>/ wrap dir — byte-shape
# identical to a GitHub auto-archive at the same ref.
#
# Uses `git archive`, which reads from the git tree (not the working
# directory), so runtime state written into the source tree by a running
# stack (postgres data, certbot volumes, tomcat logs) never ends up in
# the artifact.
#
# Usage:
#   ./scripts/build-tarball.sh                  # HEAD, name from git describe
#   ./scripts/build-tarball.sh 3.2.2.0          # specific tag
#   REF_NAME=main ./scripts/build-tarball.sh    # explicit name override (CI)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REF="${1:-HEAD}"
REF_NAME="${REF_NAME:-$(git describe --tags --always "$REF" 2>/dev/null || echo "local")}"
WRAP_DIR="openelis-madagascar-distro-${REF_NAME}"
TARBALL="${WRAP_DIR}.tar.gz"

echo "[build] ref:     $REF ($REF_NAME)"
echo "[build] tarball: ${ROOT}/${TARBALL}"

git archive --format=tar.gz \
    --prefix="${WRAP_DIR}/" \
    --output="${TARBALL}" \
    "$REF"

SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
ENTRIES="$(tar tzf "$TARBALL" | wc -l)"
echo "[build] done — ${SIZE}, ${ENTRIES} entries"
echo
echo "Verify the artifact boots a healthy stack:"
echo "  cd /tmp && tar xzf '${ROOT}/${TARBALL}'"
echo "  cd /tmp/${WRAP_DIR}"
echo "  docker compose up -d"
echo "  curl -k -sSf https://localhost/ -o /dev/null && echo OK"
