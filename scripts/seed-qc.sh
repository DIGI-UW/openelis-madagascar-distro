#!/usr/bin/env bash
# seed-qc.sh — Distro-specific QC config seed for the Madagascar demo.
#
# Seeds:
#   1. GeneXpert / ASTM lane:
#      - Westgard STANDARD preset for HIV-VL on Cepheid GeneXpert
#      - ACTIVE control lot LOT-HIVVL-N (manufacturer mean=1250, SD=125)
#   2. QuantStudio / FILE lane (qadocs/ test fixtures):
#      - Westgard STANDARD preset for VIH-1 on QuantStudio 5
#      - ACTIVE control lots LOT-LPC-26B (mean=32.00 Ct, SD=0.50)
#                            LOT-HPC-26B (mean=25.00 Ct, SD=0.40)
#      Lot numbers + Ct mean/SD chosen to match the synthetic fixture set
#      in qadocs/QuantStudio Failing QC Samples — z-scores are calibrated
#      against these exact mean+SD values per fixture README.
#
# Why MANUFACTURER_FIXED calculation method:
#   QCControlLotServiceImpl auto-promotes the lot ESTABLISHMENT → ACTIVE
#   when manufacturer mean+SD are set, seeding qc_statistics in one shot.
#   With INITIAL_RUNS we'd need 10+ baseline runs first — defeats the
#   point of a deterministic demo seed.
#
# Why SD=125.0:
#   Matches the mock astm-mock-server astm_handler.py MOLECULAR rule
#   (SD = 10% of target = 1250 × 0.10). Keeps `--qc-deviation N`
#   deterministic — N maps 1:1 to N standard deviations on the OE side.
#
# Why analyzer_test_map join (not naive LOINC lookup):
#   OE catalogs sometimes carry orphan duplicate test rows for the same
#   LOINC. Ingest resolves test_id via analyzer_test_map; the seed must
#   target the same row or the lot lives under a test_id ingest never
#   sees, and Westgard never fires.
#
# Idempotent: safe to re-run — both POSTs accept 409 as already-exists.
#
# Usage:
#   ./scripts/seed-qc.sh                     # seed against https://localhost
#   BASE_URL=https://demo.example ./scripts/seed-qc.sh
#
# Requires the analyzer harness (seed-analyzers.sh) to have run first:
# the GeneXpert analyzer must exist with HIV-VL in its analyzer_test_map.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BASE_URL="${BASE_URL:-https://localhost}"
TEST_USER="${TEST_USER:-admin}"
TEST_PASS="${TEST_PASS:-adminADMIN!}"
DB_CONTAINER="${DB_CONTAINER:-openelisglobal-database}"

# Source distro .env if present (provides admin credentials, base URL).
if [ -f "$ROOT/.env" ]; then
  set -a && . "$ROOT/.env" && set +a
fi

psql_query() {
  docker exec -i "$DB_CONTAINER" psql -U clinlims -d clinlims -t -A -c "$1"
}

CLEAN=true
if [[ "${1:-}" == "--no-clean" ]]; then
  CLEAN=false
fi

if [ "$CLEAN" = true ]; then
  echo "[seed-qc] Cleaning stale QC tables (FK-safe order)..."
  # FKs cascade analyzer → qc_control_lot → qc_result/statistics → violation/alert.
  # Delete leaves before roots so any subsequent analyzer DELETE doesn't
  # trip fk_qc_control_lot_analyzer.
  docker exec -i "$DB_CONTAINER" psql -U clinlims -d clinlims -c "
    DELETE FROM clinlims.qc_alert;
    DELETE FROM clinlims.qc_rule_violation;
    DELETE FROM clinlims.qc_result;
    DELETE FROM clinlims.qc_statistics;
    DELETE FROM clinlims.westgard_rule_config;
    DELETE FROM clinlims.qc_control_lot;
  " 2>&1 | sed 's/^/  /'
fi

echo "[seed-qc] Resolving HIV-VL test_id and GeneXpert instrument_id..."
GENEXPERT_INST_ID="$(psql_query "SELECT id FROM clinlims.analyzer WHERE name='Cepheid GeneXpert (ASTM Mode)' ORDER BY id LIMIT 1;")"
HIVVL_TEST_ID="$(psql_query "SELECT atm.test_id FROM clinlims.analyzer_test_map atm WHERE atm.analyzer_id=${GENEXPERT_INST_ID:-0} AND atm.analyzer_test_name='HIV-VL' LIMIT 1;")"

if [ -z "$HIVVL_TEST_ID" ] || [ -z "$GENEXPERT_INST_ID" ]; then
  echo "[seed-qc] WARN: cannot seed QC — IDs unresolved (HIV-VL test_id='$HIVVL_TEST_ID', GeneXpert instrument_id='$GENEXPERT_INST_ID')" >&2
  echo "[seed-qc]   Run scripts/restart-stack.sh --seed-harness first to register the analyzer." >&2
  exit 1
fi
echo "[seed-qc]   HIV-VL test_id=${HIVVL_TEST_ID}, GeneXpert instrument_id=${GENEXPERT_INST_ID}"

echo "[seed-qc] Applying Westgard STANDARD preset..."
PRESET_LOG="$(mktemp)"
PRESET_CODE=$(curl -sk -o "$PRESET_LOG" -w "%{http_code}" \
  -X POST -u "${TEST_USER}:${TEST_PASS}" \
  "${BASE_URL}/api/OpenELIS-Global/rest/qc/ruleConfig/preset" \
  --data-urlencode "testId=${HIVVL_TEST_ID}" \
  --data-urlencode "instrumentId=${GENEXPERT_INST_ID}" \
  --data-urlencode "preset=STANDARD")
case "$PRESET_CODE" in
  200) echo "[seed-qc]   Westgard preset STANDARD applied" ;;
  409) echo "[seed-qc]   Westgard preset already exists (idempotent skip)" ;;
  *)   echo "[seed-qc]   ERROR: preset POST returned HTTP ${PRESET_CODE}" >&2
       sed 's/^/    /' "$PRESET_LOG" >&2
       rm -f "$PRESET_LOG"
       exit 1 ;;
esac
rm -f "$PRESET_LOG"

echo "[seed-qc] Creating control lot LOT-HIVVL-N (mean=1250, SD=125, ACTIVE)..."
ACTIVATION_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LOT_LOG="$(mktemp)"
LOT_CODE=$(curl -sk -o "$LOT_LOG" -w "%{http_code}" \
  -X POST -u "${TEST_USER}:${TEST_PASS}" \
  -H "Content-Type: application/json" \
  "${BASE_URL}/api/OpenELIS-Global/rest/qc/controlLot" \
  -d "{
    \"productName\": \"HIV-VL Quantitative Control (Normal)\",
    \"lotNumber\": \"LOT-HIVVL-N\",
    \"manufacturer\": \"Cepheid\",
    \"controlLevel\": \"NORMAL\",
    \"testId\": ${HIVVL_TEST_ID},
    \"instrumentId\": ${GENEXPERT_INST_ID},
    \"calculationMethod\": \"MANUFACTURER_FIXED\",
    \"manufacturerMean\": 1250.0,
    \"manufacturerStdDev\": 125.0,
    \"activationDate\": \"${ACTIVATION_TS}\",
    \"expirationDate\": \"2027-12-31T00:00:00Z\",
    \"unitOfMeasure\": \"copies/mL\"
  }")
case "$LOT_CODE" in
  200|201)
    LOT_ID="$(python3 -c "import json,sys; print(json.load(open('$LOT_LOG')).get('id',''))" 2>/dev/null || echo "")"
    echo "[seed-qc]   Control lot LOT-HIVVL-N created (id=${LOT_ID})" ;;
  409)
    echo "[seed-qc]   Control lot LOT-HIVVL-N already exists (idempotent skip)" ;;
  *)
    echo "[seed-qc]   ERROR: lot POST returned HTTP ${LOT_CODE}" >&2
    sed 's/^/    /' "$LOT_LOG" >&2
    rm -f "$LOT_LOG"
    exit 1 ;;
esac
rm -f "$LOT_LOG"

## ── QuantStudio / FILE lane ────────────────────────────────────────────────
echo
echo "[seed-qc] Resolving VIH-1 test_id and QuantStudio 5 instrument_id..."
QS5_INST_ID="$(psql_query "SELECT id FROM clinlims.analyzer WHERE name='QuantStudio 5' ORDER BY id LIMIT 1;")"
VIH1_TEST_ID="$(psql_query "SELECT atm.test_id FROM clinlims.analyzer_test_map atm WHERE atm.analyzer_id=${QS5_INST_ID:-0} AND atm.analyzer_test_name='VIH-1' LIMIT 1;")"

if [ -z "$QS5_INST_ID" ] || [ -z "$VIH1_TEST_ID" ]; then
  echo "[seed-qc] WARN: skipping QuantStudio QC seed — IDs unresolved (VIH-1 test_id='$VIH1_TEST_ID', QuantStudio 5 instrument_id='$QS5_INST_ID')" >&2
  echo "[seed-qc]   Re-run scripts/restart-stack.sh --seed-harness to register QuantStudio 5." >&2
else
  echo "[seed-qc]   VIH-1 test_id=${VIH1_TEST_ID}, QuantStudio 5 instrument_id=${QS5_INST_ID}"

  echo "[seed-qc] Applying Westgard STANDARD preset for QuantStudio 5..."
  QS_PRESET_LOG="$(mktemp)"
  QS_PRESET_CODE=$(curl -sk -o "$QS_PRESET_LOG" -w "%{http_code}" \
    -X POST -u "${TEST_USER}:${TEST_PASS}" \
    "${BASE_URL}/api/OpenELIS-Global/rest/qc/ruleConfig/preset" \
    --data-urlencode "testId=${VIH1_TEST_ID}" \
    --data-urlencode "instrumentId=${QS5_INST_ID}" \
    --data-urlencode "preset=STANDARD")
  case "$QS_PRESET_CODE" in
    200) echo "[seed-qc]   Westgard preset STANDARD applied (QS5)" ;;
    409) echo "[seed-qc]   Westgard preset already exists (idempotent skip)" ;;
    *)   echo "[seed-qc]   WARN: QS5 preset POST returned HTTP ${QS_PRESET_CODE}" >&2
         sed 's/^/    /' "$QS_PRESET_LOG" >&2 ;;
  esac
  rm -f "$QS_PRESET_LOG"

  # Two lots: LPC (Low Positive) at mean=32.00 SD=0.50, HPC (High Positive)
  # at mean=25.00 SD=0.40. Values match qadocs fixture set per README.
  for level in LPC HPC; do
    # controlLevel = "LPC" / "HPC" matches the matched qcRule
    # SPECIMEN_ID_PREFIX operand the bridge propagates as
    # Observation.extension[control-level]. This lets OE's Tier-2 resolver
    # do straight equality on (testId, instrumentId, controlLevel) without
    # any LPC↔NORMAL translation table.
    if [ "$level" = "LPC" ]; then
      LOT_NUM="LOT-LPC-26B"; LOT_LEVEL="LPC"; LOT_MEAN="32.00"; LOT_SD="0.50"
      LOT_NAME="HIV-1 LTR Low Positive Control"
    else
      LOT_NUM="LOT-HPC-26B"; LOT_LEVEL="HPC"; LOT_MEAN="25.00"; LOT_SD="0.40"
      LOT_NAME="HIV-1 LTR High Positive Control"
    fi
    QS_LOT_LOG="$(mktemp)"
    QS_LOT_CODE=$(curl -sk -o "$QS_LOT_LOG" -w "%{http_code}" \
      -X POST -u "${TEST_USER}:${TEST_PASS}" \
      -H "Content-Type: application/json" \
      "${BASE_URL}/api/OpenELIS-Global/rest/qc/controlLot" \
      -d "{
        \"productName\": \"${LOT_NAME}\",
        \"lotNumber\": \"${LOT_NUM}\",
        \"manufacturer\": \"Thermo Fisher\",
        \"controlLevel\": \"${LOT_LEVEL}\",
        \"testId\": ${VIH1_TEST_ID},
        \"instrumentId\": ${QS5_INST_ID},
        \"calculationMethod\": \"MANUFACTURER_FIXED\",
        \"manufacturerMean\": ${LOT_MEAN},
        \"manufacturerStdDev\": ${LOT_SD},
        \"activationDate\": \"${ACTIVATION_TS}\",
        \"expirationDate\": \"2027-12-31T00:00:00Z\",
        \"unitOfMeasure\": \"Ct\"
      }")
    case "$QS_LOT_CODE" in
      200|201) echo "[seed-qc]   Control lot ${LOT_NUM} created (mean=${LOT_MEAN} Ct, SD=${LOT_SD})" ;;
      409)     echo "[seed-qc]   Control lot ${LOT_NUM} already exists (idempotent skip)" ;;
      *)       echo "[seed-qc]   WARN: ${LOT_NUM} POST returned HTTP ${QS_LOT_CODE}" >&2
               sed 's/^/    /' "$QS_LOT_LOG" >&2 ;;
    esac
    rm -f "$QS_LOT_LOG"
  done
fi

echo
echo "[seed-qc] Done. Drive QC violations with:"
echo "  GeneXpert (ASTM):"
echo "    curl -X POST http://localhost:8085/simulate/astm/genexpert_astm \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"destination\":\"tcp://openelis-analyzer-bridge:12001\",\"qc\":true,\"qc_deviation\":3.5,\"source_ip\":\"10.42.20.10\"}'"
echo "    → fires 1₃ₛ rejection (z=3.5)"
echo
echo "  QuantStudio (FILE upload via bridge UI):"
echo "    curl -u bridge:changeme -X POST https://localhost:8442/admin/upload \\"
echo "      -F analyzerId=<QS5-id> -F file=@qadocs/QuantStudio_Failing_QC_Samples/qc-only_01_1-3s.csv"
echo "    → fires 1₃ₛ on LPC z-score=+3.0 (Ct=33.500 vs mean 32.00, SD 0.50)"
