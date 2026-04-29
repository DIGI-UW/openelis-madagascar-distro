#!/usr/bin/env bash
# Verifies docker compose files parse and merge (no containers started).
# Tests every overlay combination scripts/restart-stack.sh and the docs use.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

docker compose -f compose.yaml config -q
docker compose -f compose.yaml -f compose.validate.yaml config -q
docker compose -f compose.yaml -f compose.letsencrypt.yaml config -q
docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  -f compose.letsencrypt.yaml \
  config -q

echo "OK: compose files are valid (base + validate + letsencrypt, in every combination)."
