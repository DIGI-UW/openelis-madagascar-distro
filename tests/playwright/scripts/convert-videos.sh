#!/usr/bin/env bash
#
# Post-run video converter: .webm → .mp4 with human-readable analyzer names.
#
# Usage (from tests/playwright or distro root):
#   ./tests/playwright/scripts/convert-videos.sh
#
# Output lands in test-results/videos/<AnalyzerName>.mp4
#
# Requires Docker (uses jrottenberg/ffmpeg image since ffmpeg is not on host).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# test-results lives at the distro root (bind-mounted from compose),
# not under tests/playwright/
DISTRO_ROOT="$(realpath "$SCRIPT_DIR/../../..")"
TEST_RESULTS="${TEST_RESULTS:-$DISTRO_ROOT/test-results}"
OUT_DIR="$TEST_RESULTS/videos"

mkdir -p "$OUT_DIR"

# Map truncated Playwright directory names to human-readable analyzer names.
# Playwright truncates long test names to a hash + suffix; we match on the
# unique fragments that survive the truncation.
human_name() {
  local dir="$1"
  case "$dir" in
    *QuantStudio*7*|*--7-FILE*)    echo "QuantStudio-7";;
    *QuantStudio*5*|*--5-FILE*)    echo "QuantStudio-5";;
    *FluoroCycler*|*-VL-FILE*)     echo "FluoroCycler-XT";;
    *GeneXpert*)                   echo "GeneXpert-ASTM";;
    *Mindray*BC*|*bc5380*)         echo "Mindray-BC5380";;
    *Mindray*BS-200*|*bs200*)      echo "Mindray-BS200";;
    *Mindray*BS-300*|*bs300*)      echo "Mindray-BS300";;
    *Wondfo*|*wondfo*)             echo "Wondfo-Finecare";;
    *Tecan*|*tecan*)               echo "Tecan-F50";;
    *Multiskan*|*multiskan*)       echo "Multiskan-FC";;
    *)                             echo "$(basename "$dir")";;
  esac
}

count=0
for dir in "$TEST_RESULTS/test-output"/*-harness-demo-video/; do
  [ -d "$dir" ] || continue
  webm="$dir/video.webm"
  [ -f "$webm" ] || continue

  name="$(human_name "$(basename "$dir")")"
  mp4="$OUT_DIR/${name}.mp4"

  echo "Converting: $(basename "$dir") → ${name}.mp4"
  docker run --rm \
    -v "$webm:/input/video.webm:ro" \
    -v "$OUT_DIR:/output" \
    jrottenberg/ffmpeg:7-alpine \
    -i /input/video.webm \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    -y "/output/${name}.mp4" \
    2>/dev/null

  size=$(du -h "$mp4" | cut -f1)
  echo "  ✓ ${name}.mp4 ($size)"
  count=$((count + 1))
done

echo ""
echo "Converted $count videos to $OUT_DIR"
ls -lh "$OUT_DIR"/*.mp4 2>/dev/null
