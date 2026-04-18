#!/usr/bin/env bash
# Reset analyzer-specific state in OE + clear bridge dead-letters.
#
# Use this when:
# - DB has stale `analyzer_test_map` / `analyzer_results` rows from
#   prior demo or test runs, OR
# - PENDING_REGISTRATION stub analyzers have accumulated, OR
# - bridge `/tmp/openelis-analyzer-bridge/dead-letters/` is full of
#   captured-but-unrouted ASTM messages from unregistered sources, AND
# - the test-data ranges (`E2E*`, `TEST-*`) reset by upstream
#   `reset-test-database.sh` are NOT enough (because the rows you want
#   wiped have integer ids in production-data range, e.g. analyzer 397).
#
# This script ONLY touches the analyzer subsystem. It is complementary
# to `OpenELIS-Global-2/src/test/resources/reset-test-database.sh`,
# which handles E2E* / TEST-* sample + storage data.
#
# Usage:
#   ./scripts/reset-analyzer-state.sh                # interactive
#   ./scripts/reset-analyzer-state.sh --force        # skip prompt
#   ./scripts/reset-analyzer-state.sh --include-stubs       # also wipe PENDING_REGISTRATION
#   ./scripts/reset-analyzer-state.sh --include-deadletters # also clear bridge DLQ
#
# REQUIRES: a real-message backup at ~/astm-fixtures-real-YYYYMMDD/
#   (or symlink) before bridge dead-letters can be cleared. See
#   docs/database-reset.md "Analyzer-state reset" section.
#
# Refs:
# - docs/database-reset.md (analyzer-state reset section)
# - .claude/plans/abundant-chasing-hoare.md (Phase 1 of the GeneXpert
#   ASTM remediation plan, 2026-04-14)

set -euo pipefail

FORCE=false
INCLUDE_STUBS=false
INCLUDE_DEADLETTERS=false
ANALYZER_IDS="397, 552, 634, 635"  # GeneXperts in the Madagascar test env
DB_CONTAINER="openelisglobal-database"
BRIDGE_CONTAINER="openelis-analyzer-bridge"
BACKUP_GLOB="$HOME/astm-fixtures-real-*"

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true;;
    --include-stubs) INCLUDE_STUBS=true;;
    --include-deadletters) INCLUDE_DEADLETTERS=true;;
    --analyzer-ids=*) ANALYZER_IDS="${arg#--analyzer-ids=}";;
    *) echo "Unknown arg: $arg" >&2; exit 2;;
  esac
done

echo "============================================"
echo "Reset analyzer-specific state"
echo "============================================"
echo "  Targeted analyzer ids:   $ANALYZER_IDS"
echo "  Include PENDING stubs:   $INCLUDE_STUBS"
echo "  Clear bridge dead-letters: $INCLUDE_DEADLETTERS"
echo ""

if [ "$INCLUDE_DEADLETTERS" = true ]; then
  shopt -s nullglob
  BACKUPS=( $BACKUP_GLOB )
  shopt -u nullglob
  if [ "${#BACKUPS[@]}" -eq 0 ]; then
    echo "ERROR: no backup found at $BACKUP_GLOB."
    echo "  Bridge dead-letters are real captured ASTM messages — back them"
    echo "  up first (see docs/database-reset.md). Refusing to clear DLQ."
    exit 3
  fi
  echo "  Backup detected at: ${BACKUPS[0]} (DLQ-clear allowed)"
fi

if [ "$FORCE" != true ]; then
  echo ""
  echo "⚠️  Press Ctrl+C to cancel, or Enter to proceed..."
  read -r
fi

echo ""
echo "[1/4] Wiping analyzer_results for analyzer_id IN ($ANALYZER_IDS)..."
docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims -c \
  "DELETE FROM analyzer_results WHERE analyzer_id::int IN ($ANALYZER_IDS);"

echo ""
echo "[2/4] Wiping analyzer_test_map for analyzer_id IN ($ANALYZER_IDS)..."
docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims -c \
  "DELETE FROM analyzer_test_map WHERE analyzer_id::int IN ($ANALYZER_IDS);"

echo ""
echo "[3/4] Wiping analyzer rows themselves..."
docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims -c \
  "DELETE FROM analyzer WHERE id::int IN ($ANALYZER_IDS);"

if [ "$INCLUDE_STUBS" = true ]; then
  echo ""
  echo "[3a] Wiping PENDING_REGISTRATION stubs and their dependent rows..."
  # Note: docker exec needs -i to pipe stdin (heredoc). Without -i the
  # SQL script is silently dropped.
  docker exec -i "$DB_CONTAINER" psql -U clinlims -d clinlims <<'SQL'
    DELETE FROM analyzer_results  WHERE analyzer_id IN (SELECT id FROM analyzer WHERE status = 'PENDING_REGISTRATION');
    DELETE FROM analyzer_test_map WHERE analyzer_id IN (SELECT id FROM analyzer WHERE status = 'PENDING_REGISTRATION');
    DELETE FROM analyzer          WHERE status = 'PENDING_REGISTRATION';
SQL
fi

if [ "$INCLUDE_DEADLETTERS" = true ]; then
  echo ""
  echo "[4/4] Clearing bridge dead-letter directory..."
  docker exec "$BRIDGE_CONTAINER" sh -c \
    "rm -f /tmp/openelis-analyzer-bridge/dead-letters/*"
  echo "  Cleared. (Original captures preserved at: ${BACKUPS[0]})"
else
  echo ""
  echo "[4/4] Skipped DLQ clear (no --include-deadletters)."
fi

echo ""
echo "============================================"
echo "Done. Verify with:"
echo "  docker exec $DB_CONTAINER psql -U clinlims -d clinlims -c \\"
echo "    \"SELECT id, name, status FROM analyzer WHERE id::int IN ($ANALYZER_IDS) OR status = 'PENDING_REGISTRATION';\""
echo ""
echo "Then restart the stack:"
echo "  ./scripts/restart-stack.sh"
echo "============================================"
