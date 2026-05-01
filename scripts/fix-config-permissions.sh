#!/usr/bin/env bash
# Re-claim ownership of configs/configuration/backend after a container run.
#
# The OE webapp image runs as root, so its startup writes
# <domain>-checksums.properties files into the bind-mounted configuration
# tree as root-owned. The host user (e.g. `ubuntu`) then can't edit catalog
# CSVs alongside those checksum files without permission errors.
#
# This script does the proper fix: chown the tree back to the host user
# and apply tight perms (owner+group read-write, world read-only) instead
# of the previous chmod -R a+rwX (world-writable). Requires sudo because
# the files were written by container-side root.
#
# Run after a fresh container start that wrote new checksum files.
# Idempotent.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="${ROOT}/configs/configuration/backend"
HOST_USER="${SUDO_USER:-${USER:-$(id -un)}}"

if [[ ! -d "${BACKEND}" ]]; then
  echo "Missing ${BACKEND}; nothing to do." >&2
  exit 1
fi

sudo chown -R "${HOST_USER}:${HOST_USER}" "${BACKEND}"
chmod -R u+rwX,g+rwX,o+rX "${BACKEND}"
echo "Updated ownership/permissions on ${BACKEND}"
echo "  owner: ${HOST_USER}:${HOST_USER}"
echo "  mode:  u+rwX,g+rwX,o+rX (was: a+rwX)"
