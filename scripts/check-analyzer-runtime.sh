#!/usr/bin/env bash
# Run after check-analyzer-catalog.sh has validated and compiled the pinned Bridge.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_SOURCE="$(cd "${1:?Provide the manifest-pinned Bridge checkout}" && pwd)"
BUILD="$ROOT/test-artifacts/analyzer-catalog"
mkdir -p "$BUILD/classes" "$BUILD/runtime"
CLASSPATH="$BRIDGE_SOURCE/target/classes:$(cat "$BRIDGE_SOURCE/target/catalog-classpath.txt")"
javac -cp "$CLASSPATH" -d "$BUILD/classes" "$ROOT/scripts/profile-catalog/FileProfileAcceptance.java" "$ROOT/scripts/profile-catalog/SocketProfileAcceptance.java"
python3 - "$ROOT" > "$BUILD/cases.tsv" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);manifest=json.loads((root/'configs/analyzer-catalog-manifest.json').read_text())
profiles={}
for path in (root/'configs/analyzer-profiles').rglob('*.json'):
    p=json.loads(path.read_text());id=p['profileMeta']['id']
    if id not in profiles or p['catalog']['revision']>profiles[id][1]['catalog']['revision']:profiles[id]=(path,p)
for id in manifest['requiredProfileIds']:
    path,p=profiles[id]
    if p['catalog']['status']!='ACTIVE':
        assert id in manifest['inactiveProfileIds'],f'Unexpected inactive profile {id}'
        continue
    assert id not in manifest['inactiveProfileIds'],f'Unexpected active profile {id}'
    case=root/'tests/analyzer-catalog'/id/'case.json';assert case.is_file(),f'Missing acceptance case {id}'
    runner='FileProfileAcceptance' if p['protocol']['name']=='FILE' else 'SocketProfileAcceptance'
    print(id,path,case,runner,sep='\t')
PY
# HAPI's local ID generator writes id_file in cwd; keep it inside ignored artifacts.
cd "$BUILD/runtime"
while IFS=$'\t' read -r profile definition scenario runner; do
  java -cp "$BUILD/classes:$CLASSPATH" "org.itech.ahb.connection.$runner" "$definition" "$scenario" > "$BUILD/$profile.log" 2>&1 || {
    cat "$BUILD/$profile.log" >&2
    exit 1
  }
  grep '^PASS ' "$BUILD/$profile.log"
done < "$BUILD/cases.tsv"
