#!/usr/bin/env bash
# Restart the full OpenELIS stack (all overlays).
#
# Usage:
#   ./scripts/restart-stack.sh          # restart, keep data
#   ./scripts/restart-stack.sh --clean  # restart, remove volumes (DB, certs, indexes)
#
# Robustness:
# - `compose down` is wrapped in `timeout 60` with `-t 5 --remove-orphans`
#   so a stuck container (e.g. autoheal in "health: starting") can't hang
#   the whole script indefinitely.
# - If compose down hangs or fails, falls back to direct
#   `docker rm -f` on project-labeled containers.
# - Readiness is judged by login-form render, not /health 200 (a 200 on
#   /health doesn't mean the webapp is actually serving requests).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT_LABEL="com.docker.compose.project=openelis-madagascar-distro"
COMPOSE="docker compose \
  -f docker-compose.yml \
  -f docker-compose.validate.yml \
  -f docker-compose.local-images.yml \
  -f docker-compose.letsencrypt.yml"

CLEAN_FLAG=""
if [[ "${1:-}" == "--clean" ]]; then
  CLEAN_FLAG="-v"
  echo "[mode] --clean: volumes will be wiped"
else
  echo "[mode] preserve volumes"
fi

echo "[1/6] Stopping stack (compose down -t 5 --remove-orphans, 60s cap)..."
if ! timeout 60 $COMPOSE down $CLEAN_FLAG -t 5 --remove-orphans; then
  echo "[1/6] compose down hung or failed — force-removing project containers..."
  CONTAINERS="$(docker ps -aq --filter "label=${PROJECT_LABEL}" 2>/dev/null || true)"
  if [[ -n "$CONTAINERS" ]]; then
    echo "$CONTAINERS" | xargs -r docker rm -f
  fi
fi

if [[ -n "$CLEAN_FLAG" ]]; then
  echo "[2/6] Wiping project-labeled volumes (belt-and-suspenders)..."
  VOLS="$(docker volume ls -q --filter "label=${PROJECT_LABEL}" 2>/dev/null || true)"
  if [[ -n "$VOLS" ]]; then
    echo "$VOLS" | xargs -r docker volume rm -f
  fi
  # Postgres data is a HOST BIND MOUNT at configs/database/data3, not a
  # docker-managed volume — `down -v` never touches it, so rows persist
  # across "clean" restarts unless we nuke it here. Requires sudo because
  # postgres runs as uid 999 inside the container and writes data as
  # that uid on the host (mode 0700). Also removes any archaeological
  # data/data2/... directories from previous workaround attempts.
  echo "[2/6] Wiping postgres bind-mount data dir (sudo required)..."
  DB_DATA_PARENT="${ROOT}/configs/database"
  if [[ -d "$DB_DATA_PARENT" ]]; then
    for d in "$DB_DATA_PARENT"/data "$DB_DATA_PARENT"/data2 "$DB_DATA_PARENT"/data3; do
      if [[ -d "$d" ]]; then
        sudo rm -rf "$d"
      fi
    done
    mkdir -p "$DB_DATA_PARENT/data3"
    echo "    Fresh empty data3/ created"
  fi
fi

echo "[3/6] Starting stack..."
$COMPOSE up -d --remove-orphans

echo "[4/6] Clearing any stale Liquibase lock (waits up to 30s for DB)..."
DB_CONTAINER=""
for i in $(seq 1 6); do
  DB_CONTAINER="$(docker ps -q -f name=openelisglobal-database 2>/dev/null || true)"
  if [[ -n "$DB_CONTAINER" ]]; then break; fi
  sleep 5
done
if [[ -n "$DB_CONTAINER" ]]; then
  docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims \
    -c "UPDATE databasechangeloglock SET locked=false, lockgranted=NULL, lockedby=NULL WHERE id=1;" \
    2>/dev/null || echo "    (lock clear no-op — expected on fresh DB)"
else
  echo "    DB container not up yet — skipping lock clear"
fi

echo "[5/6] Waiting for stack readiness (same contract as tests/auth.setup.ts)..."
# Readiness = the exact check Playwright runs before every test:
#   1. GET /health returns 200
#   2. POST /api/OpenELIS-Global/ValidateLogin?apiCall=true returns {"success":true}
# If both pass, the stack is ready for tests. Do NOT invent alternative
# readiness probes — they miss edge cases that this one catches.
TEST_USER="${TEST_USER:-admin}"
TEST_PASS="${TEST_PASS:-adminADMIN!}"
READY=""
for i in $(seq 1 60); do
  if ! curl -k -sSf https://localhost/health >/dev/null 2>&1; then
    sleep 5
    continue
  fi
  LOGIN_JSON="$(curl -k -sS -X POST \
    "https://localhost/api/OpenELIS-Global/ValidateLogin?apiCall=true" \
    --data-urlencode "loginName=${TEST_USER}" \
    --data-urlencode "password=${TEST_PASS}" 2>/dev/null || true)"
  if echo "$LOGIN_JSON" | grep -q '"success":true'; then
    READY="yes"
    echo "    Stack ready after ~$((i*5))s (health + ValidateLogin both passed)"
    break
  fi
  sleep 5
done
if [[ -z "$READY" ]]; then
  echo "[5/6] FAIL: stack not ready after 300s"
  echo "    Last 40 webapp log lines:"
  docker logs openelisglobal-webapp --tail 40 2>&1 || true
  exit 1
fi

echo "[6/6] Smoke-checking bridge + mock..."
curl -k -sSf https://localhost:8442/actuator/health &>/dev/null && echo "    Bridge: UP" || echo "    Bridge: not ready"
curl -sSf http://localhost:8085/health &>/dev/null && echo "    Mock: UP" || echo "    Mock: not ready"
echo "done"
