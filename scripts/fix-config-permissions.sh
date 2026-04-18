#!/usr/bin/env bash
# OpenELIS may write *-checksums.properties under configuration/backend/ at startup.
# If the bind-mounted tree is owned by root and Tomcat runs as another UID, chmod avoids
# permission-denied noise in logs (run once on the host after clone or as needed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="${ROOT}/configs/configuration/backend"
if [[ -d "${BACKEND}" ]]; then
  chmod -R a+rwX "${BACKEND}"
  echo "Updated permissions on ${BACKEND}"
else
  echo "Missing ${BACKEND}; nothing to do." >&2
  exit 1
fi
