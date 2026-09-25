#!/usr/bin/env bash
# Compile the distro check against pinned Bridge code, never a separate schema copy.
# Usage: scripts/check-analyzer-catalog.sh /path/to/bridge [catalog-directory] [manifest]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_SOURCE="${1:?Provide a checkout of the manifest-pinned Analyzer Bridge revision}"
CATALOG="${2:-$ROOT/configs/analyzer-profiles}"
MANIFEST="${3:-$ROOT/configs/analyzer-catalog-manifest.json}"
EXPECTED_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bridgeRevision"])' "$MANIFEST")"
python3 - "$MANIFEST" <<'PY_CHECK'
import json,pathlib,sys
path=pathlib.Path(sys.argv[1]);manifest=json.loads(path.read_text())
expected=manifest['bridgeImage']
assert '@sha256:' in expected, 'Bridge image must have an immutable digest'
compose=path.parent.parent/'docker-compose.yml'
images=[line.split(':',1)[1].strip() for line in compose.read_text().splitlines() if line.lstrip().startswith('image:')]
assert expected in images, 'Compose Bridge image does not match the validated catalog manifest'
PY_CHECK
ACTUAL_SHA="$(git -C "$BRIDGE_SOURCE" rev-parse HEAD)"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Bridge checkout is $ACTUAL_SHA; manifest requires $EXPECTED_SHA" >&2
  exit 1
fi
if ! git -C "$BRIDGE_SOURCE" diff --quiet HEAD -- src pom.xml contracts astm-http-lib; then
  echo "Bridge source has local changes; use the pinned source for release validation" >&2
  exit 1
fi
BUILD="$ROOT/test-artifacts/analyzer-catalog"
mkdir -p "$BUILD/classes"
mvn -q -f "$BRIDGE_SOURCE/astm-http-lib/pom.xml" -DskipTests install
mvn -q -f "$BRIDGE_SOURCE/pom.xml" -DskipTests compile dependency:build-classpath \
  -Dmdep.outputFile=target/catalog-classpath.txt
CLASSPATH="$BRIDGE_SOURCE/target/classes:$(cat "$BRIDGE_SOURCE/target/catalog-classpath.txt")"
javac -cp "$CLASSPATH" -d "$BUILD/classes" "$ROOT/scripts/profile-catalog/CatalogCheck.java"
java -cp "$BUILD/classes:$CLASSPATH" org.itech.ahb.profile.CatalogCheck "$CATALOG" "$MANIFEST"
