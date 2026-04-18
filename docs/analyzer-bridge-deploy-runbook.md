# Analyzer Bridge Deploy Runbook

Operational runbook for deploying the non-destructive analyzer bridge
(openelis-analyzer-bridge PR #34) to mgtest UAT. The bridge is now strictly
read-only with respect to watched directories and tracks all processing
state in a local SQLite `FileStateStore`. The distro compose has been
updated with:

- `${ANALYZER_HOST_MOUNT:-/mnt}:${ANALYZER_HOST_MOUNT:-/mnt}:ro` on both the
  webapp and the bridge services (containment from Phase 0.3)
- A new named `bridge-state` docker volume bound at
  `/data/openelis-analyzer-bridge/` inside the bridge container
- `BRIDGE_FILE_STATE_STORE_PATH=/data/openelis-analyzer-bridge/state.db`
  environment variable on the bridge service

This document covers the cutover procedure from the old destructive bridge
to the new non-destructive one.

## Before the cutover (Phase 0.4 snapshot)

The old bridge wrote successfully-processed files to
`/tmp/openelis-analyzer-bridge/analyzer-archive/` and failed files to
`/tmp/openelis-analyzer-bridge/analyzer-error/` inside its container. Once
the new bridge image is deployed those directories are no longer consulted,
so any files still sitting in them at cutover time become orphaned. Before
restarting the bridge container, copy them out so Herbert and the Madagascar
team don't lose diagnostic history:

```bash
# From the mgtest host, with the bridge container still running:
DISTRO_ROOT=/opt/openelis-madagascar-distro   # adjust to your deploy path
BACKUP_DIR=/home/ubuntu/bridge-pre-upgrade-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

docker exec openelis-analyzer-bridge sh -c \
  'ls -la /tmp/openelis-analyzer-bridge/ 2>/dev/null || true'

docker cp openelis-analyzer-bridge:/tmp/openelis-analyzer-bridge/analyzer-archive \
  "$BACKUP_DIR/analyzer-archive" || true
docker cp openelis-analyzer-bridge:/tmp/openelis-analyzer-bridge/analyzer-error \
  "$BACKUP_DIR/analyzer-error" || true

tar -czf "$BACKUP_DIR.tar.gz" -C "$(dirname "$BACKUP_DIR")" "$(basename "$BACKUP_DIR")"
```

Upload `$BACKUP_DIR.tar.gz` to the Madagascar drive folder and link it from
the relevant analyzer tracker tickets before continuing. If either directory
is empty or missing, the `|| true` clauses keep the snapshot going — the
new bridge does not need these files to function, they are purely for
historical diagnostic.

## During the cutover (Phase 0.5 drain)

```bash
cd $DISTRO_ROOT

# 1. Pull the latest compose changes (adds :ro mount + bridge-state volume +
#    env var)
git fetch origin
git checkout demo/madagascar-analyzers
git pull

# 2. Stop the bridge container cleanly. Let in-flight FHIR POSTs drain —
#    the old bridge commits its "processed" set on FHIR success before
#    attempting cleanup, so a graceful stop is safe.
docker compose stop openelis-analyzer-bridge
docker compose logs --tail 50 openelis-analyzer-bridge | grep -i 'processing\|error' || true

# 3. Confirm the new image tag is pulled — if the compose pins :develop
#    the `pull` below picks up the new commit.
docker compose pull openelis-analyzer-bridge

# 4. Remove the old container so compose recreates it with the new
#    volume mounts + env var.
docker compose rm -f openelis-analyzer-bridge

# 5. Start the new bridge. The FileStateStore auto-initializes an empty
#    state.db on the new bridge-state volume; the first rescan will
#    observe any files still in the ${ANALYZER_HOST_MOUNT} directories
#    and process them as fresh observations.
docker compose up -d openelis-analyzer-bridge

# 6. Verify the new state store opened successfully.
docker compose logs openelis-analyzer-bridge | grep -E 'FileStateStore|state.db'
# Expected line: "FileStateStore opened at /data/openelis-analyzer-bridge/state.db (WAL mode)"
```

## After the cutover — smoke test

```bash
# 7. Verify the :ro mount is actually read-only from the bridge's POV.
docker exec openelis-analyzer-bridge \
  sh -c 'touch /mnt/la2m/central/analyzers_results/_smoke_test && echo WRITE_SUCCEEDED || echo WRITE_DENIED_AS_EXPECTED'
# Expected: WRITE_DENIED_AS_EXPECTED

# 8. Verify the bridge-state volume is writable and contains the new db.
docker exec openelis-analyzer-bridge ls -la /data/openelis-analyzer-bridge/
# Expected: state.db, state.db-shm, state.db-wal (WAL mode artifacts)

# 9. Drop a known-bad real fixture and watch the state store.
#    Use Arbo-extraitQS5.xls (the file from Herbert's 2026-04-09 report).
#    It will fail to parse (profile is HIV-VL, file is arbovirus panel)
#    — this is expected. The point is to verify the file stays in place
#    and the state store records FAILED_NEEDS_HANDLING.
cp docs/debug-local/Arbo-extraitQS5.xls /mnt/la2m/central/analyzers_results/QuantStudio-5/

# Wait ~30s for stability check + retries to complete (default 3 attempts
# with exponential backoff: 1s, 2s, 4s = ~10s total, plus stability window
# and rescan cycle).
sleep 30

# 10. Confirm the file is still on disk.
ls -la /mnt/la2m/central/analyzers_results/QuantStudio-5/Arbo-extraitQS5.xls
# Expected: file present, same size as when we dropped it.

# 11. Confirm no legacy sidecar files were written.
ls /mnt/la2m/central/analyzers_results/QuantStudio-5/ | grep -E '\.(error|failed)$' || echo "NO SIDECARS (expected)"

# 12. Query the admin endpoint to confirm the state row.
#     (Replace $BRIDGE_USER / $BRIDGE_PASS with the configured HTTP Basic creds.)
curl -u "$BRIDGE_USER:$BRIDGE_PASS" -k \
  https://localhost:8442/admin/file-state?status=FAILED_NEEDS_HANDLING
# Expected JSON: one row with analyzerId matching QuantStudio-5, contentHash,
#                status=FAILED_NEEDS_HANDLING, a structured lastError message.
```

## If something goes wrong

- **State store failed to open** — check `docker compose logs openelis-analyzer-bridge`
  for `CRITICAL: FileStateStore database at ... failed to open`. The bridge auto-renames
  a corrupt state.db to `state.db.corrupt-<timestamp>` and creates a fresh one.
  This is safe — the OpenELIS FHIR receive path is idempotent on
  `(sampleAccession, testCode, analyzerId)` so re-POSTing a small number of
  already-processed files is a no-op on the OE side.
- **Files still disappear from the mount** — the `:ro` mount should prevent
  this at the filesystem layer. If it happens, `docker inspect
  openelis-analyzer-bridge` should show the mount with `"Mode": "ro"` in the
  `Mounts` section. If it shows `rw`, the compose change didn't take effect
  — rerun steps 4-5.
- **`/admin/file-state` returns 401** — the endpoint requires the HTTP Basic
  credentials configured via `bridge.security.username` /
  `bridge.security.password`. In the distro, these are set in the bridge's
  secret config. See the existing docs for `/input` auth — same credentials.
- **Rollback is required** — revert the webapp submodule pointer commit on
  `fix/madagascar-accession-results-file-e2e` (DIGI-UW/OpenELIS-Global-2#3372)
  and redeploy the previous bridge image. Do NOT revert the compose `:ro`
  mount — the old destructive bridge is still unsafe, and reverting to `rw`
  would restart data loss.

## Related documents

- Plan: `OpenELIS-Global-2:.claude/plans/mellow-honking-cascade.md` (Phase 0
  + Phase 1)
- Bridge PR: DIGI-UW/openelis-analyzer-bridge#34
- Webapp PR: DIGI-UW/OpenELIS-Global-2#3372
- File inventory: `OpenELIS-Global-2:docs/analyzer-file-inventory.md`
