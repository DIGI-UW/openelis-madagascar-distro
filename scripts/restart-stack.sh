#!/usr/bin/env bash
# Restart the full OpenELIS stack (all overlays).
#
# Usage:
#   ./scripts/restart-stack.sh                    # restart, keep data
#   ./scripts/restart-stack.sh --clean             # restart, wipe DB + volumes
#   ./scripts/restart-stack.sh --rebuild           # rebuild all images first
#   ./scripts/restart-stack.sh --clean --rebuild   # full reset: rebuild + wipe + restart
#   ./scripts/restart-stack.sh --clean --seed-harness  # also run the analyzer harness seed
#
# Image selection: compose.yaml + compose.validate.yaml pin every locally-
# buildable service to `:local` with native `build:` directives:
#   - oe.openelis.org (webapp)        → ${OE_REPO:-../OpenELIS-Global-2}
#   - frontend.openelis.org           → ${OE_REPO:-../OpenELIS-Global-2}/frontend
#   - openelis-analyzer-bridge        → ${BRIDGE_REPO:-../openelis-analyzer-bridge}
#   - analyzer-mock                   → ${OE_REPO:-../OpenELIS-Global-2}/tools/analyzer-mock-server
# Everything else (db, fhir, proxy) is hardcoded to `:develop` and pulled
# from the registry. No env-var indirection — bare `docker compose up -d`
# from any shell uses locally-built images if present and builds them
# on first up if absent.
#
# --rebuild forces a fresh build of all four locally-buildable services
# (and demo-tests). Requires OE_REPO env var or ../OpenELIS-Global-2 to
# exist; same for BRIDGE_REPO or ../openelis-analyzer-bridge.
#
# --seed-harness runs $OE_REPO/projects/analyzer-harness/seed-analyzers.sh
# against the running stack — creates the 7 pre-seeded non-Demo analyzers
# (FluoroCycler XT, Wondfo Finecare FS-205, QuantStudio 5/7, Tecan Infinite
# F50, Thermo Multiskan FC, Cepheid GeneXpert (ASTM Mode)) via REST API.
# This matches what CI's `23_Seed analyzers via REST API` step does, so
# the file-import-results.spec.ts tests (which look up pre-seeded analyzers
# by name) can run locally. Requires OE_REPO. Only runs AFTER the v5 §5
# invariant check — REST API seeding is a valid user action; Liquibase
# seeding would be a violation.
#
# Robustness:
# - `compose down` is wrapped in `timeout 60` with `-t 5 --remove-orphans`
#   so a stuck container (e.g. autoheal in "health: starting") can't hang
#   the whole script indefinitely.
# - If compose down hangs or fails, falls back to direct
#   `docker rm -f` on project-labeled containers.
# - Readiness requires both /health 200 AND ValidateLogin success.
#   /health alone routes through the proxy to the frontend container, so a
#   200 there doesn't prove the backend is up. ValidateLogin proves it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT_LABEL="com.docker.compose.project=openelis-madagascar-distro"
COMPOSE="docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  -f compose.letsencrypt.yaml"

CLEAN_FLAG=""
REBUILD_FLAG=""
SEED_HARNESS_FLAG=""
OE_REPO="${OE_REPO:-$(realpath "$ROOT/../OpenELIS-Global-2" 2>/dev/null || echo "")}"

for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN_FLAG="-v"; echo "[mode] --clean: volumes will be wiped";;
    --rebuild) REBUILD_FLAG="yes"; echo "[mode] --rebuild: local images will be built";;
    --seed-harness) SEED_HARNESS_FLAG="yes"; echo "[mode] --seed-harness: seed 7 harness analyzers via REST API (CI parity)";;
  esac
done
if [[ -z "$CLEAN_FLAG" && -z "$REBUILD_FLAG" ]]; then
  echo "[mode] preserve volumes, no rebuild"
fi

if [[ -n "$REBUILD_FLAG" ]]; then
  if [[ -z "$OE_REPO" || ! -d "$OE_REPO" ]]; then
    echo "ERROR: --rebuild requires OE_REPO env var or ../OpenELIS-Global-2 to exist"
    echo "  Set: export OE_REPO=/path/to/OpenELIS-Global-2"
    exit 1
  fi
  echo "[0/7] Building local images..."
  BUILD_LOG_DIR="/tmp/restart-stack-build"
  mkdir -p "$BUILD_LOG_DIR"
  echo "  → webapp + frontend via compose build (full log: $BUILD_LOG_DIR/compose-build.log)"
  OE_REPO="$OE_REPO" DOCKER_BUILDKIT=1 $COMPOSE build --pull 2>&1 \
    | tee "$BUILD_LOG_DIR/compose-build.log" | tail -1
  echo "  → demo-tests... (full log: $BUILD_LOG_DIR/demo-tests.log)"
  docker build -t madagascar-demo-tests:local \
    -f "$ROOT/tests/playwright/Dockerfile" "$ROOT/tests/playwright" 2>&1 \
    | tee "$BUILD_LOG_DIR/demo-tests.log" | tail -1
  echo "  All images built. compose.yaml pins :local for webapp/frontend."
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

echo "[6/7] Smoke-checking bridge + mock..."
curl -k -sSf https://localhost:8442/actuator/health &>/dev/null && echo "    Bridge: UP" || echo "    Bridge: not ready"
curl -sSf http://localhost:8085/health &>/dev/null && echo "    Mock: UP" || echo "    Mock: not ready"

# v5 §5: no-preseeded-analyzers invariant. A fresh --clean restart must
# produce an empty clinlims.analyzer table. If any row exists post-boot
# before a test runs, some Liquibase migration or baseline CSV is seeding
# analyzer rows — a Principle X violation that produces silent
# stale-state bugs. Fail loudly with the offending rows listed.
if [[ -n "$CLEAN_FLAG" ]]; then
  echo "[7/7] Verifying no pre-seeded analyzers (v5 §5 invariant)..."
  DB_CONTAINER="$(docker ps -q -f name=openelisglobal-database 2>/dev/null || true)"
  if [[ -n "$DB_CONTAINER" ]]; then
    ANALYZER_COUNT="$(docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims \
      -tAc "SELECT COUNT(*) FROM clinlims.analyzer" 2>/dev/null | tr -d '[:space:]')"
    if [[ "$ANALYZER_COUNT" != "0" ]]; then
      echo "[7/7] FAIL: fresh DB has $ANALYZER_COUNT pre-seeded analyzer rows"
      echo "    Offending rows:"
      docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims \
        -c "SELECT id, name, analyzer_type_id, status FROM clinlims.analyzer ORDER BY id;" \
        2>&1 | sed 's/^/      /'
      echo
      echo "    Root cause is a Liquibase changeset or baseline CSV that inserts"
      echo "    analyzer rows. Per v5 §5: no pre-seeded analyzers EVER."
      exit 1
    fi
    echo "    OK: zero pre-seeded analyzers"
  else
    echo "    DB container not running — skipping invariant check"
  fi
fi

# Optional harness seed (CI parity). Runs AFTER the v5 §5 invariant — these
# rows come from REST API calls (user-level action), not Liquibase.
if [[ -n "$SEED_HARNESS_FLAG" ]]; then
  echo "[8/8] Seeding harness analyzers via REST API (matches CI step 23)..."
  if [[ -z "$OE_REPO" || ! -d "$OE_REPO" ]]; then
    echo "    ERROR: --seed-harness requires OE_REPO env var or ../OpenELIS-Global-2 to exist"
    echo "    Set: export OE_REPO=/path/to/OpenELIS-Global-2"
    exit 1
  fi
  SEED_SCRIPT="$OE_REPO/projects/analyzer-harness/seed-analyzers.sh"
  if [[ ! -x "$SEED_SCRIPT" ]]; then
    echo "    ERROR: seed script not executable or missing: $SEED_SCRIPT"
    exit 1
  fi
  BASE_URL="${BASE_URL:-https://localhost}" \
  TEST_USER="${TEST_USER:-admin}" \
  TEST_PASS="${TEST_PASS:-adminADMIN!}" \
    bash "$SEED_SCRIPT"
  echo "    Harness analyzers seeded."

  # Distro-specific QC seeding (Westgard preset + control lot for HIV-VL on
  # GeneXpert). Lives in the distro because the values (target=1250.0,
  # SD=125.0, lot=LOT-HIVVL-N) are Madagascar-deployment-specific — they
  # don't belong in upstream OE's generic harness script. Idempotent.
  echo "[8b/8] Seeding distro QC config..."
  QC_SEED_SCRIPT="$ROOT/scripts/seed-qc.sh"
  if [[ -x "$QC_SEED_SCRIPT" ]]; then
    BASE_URL="${BASE_URL:-https://localhost}" \
    TEST_USER="${TEST_USER:-admin}" \
    TEST_PASS="${TEST_PASS:-adminADMIN!}" \
      bash "$QC_SEED_SCRIPT" --no-clean
  else
    echo "    WARN: seed-qc.sh not found or not executable at $QC_SEED_SCRIPT"
  fi
fi

echo "done"
