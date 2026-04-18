#!/usr/bin/env bash
# Verifies docker compose files parse and merge (no containers started).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
docker compose -f docker-compose.yml config >/dev/null
docker compose -f docker-compose.yml -f docker-compose.validate.yml config >/dev/null
docker compose -f docker-compose.yml -f docker-compose.letsencrypt.yml config >/dev/null
docker compose \
  -f docker-compose.yml \
  -f docker-compose.validate.yml \
  -f docker-compose.letsencrypt.yml \
  config >/dev/null
echo "OK: compose files are valid (base + validate + letsencrypt overlays)."
