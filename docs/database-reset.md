# Distro Database Reset

This runbook defines how to return the Madagascar distro to a clean E2E-ready
state without guessing.

Use this file together with:
- `AGENTS.md`
- `docs/validation.md`
- `../OpenELIS-Global-2/AGENTS.md`

## What "clean" means here

For this distro, a clean E2E state does not normally mean "empty Postgres".

It means:
- the intended compose layers are running
- OE, bridge, and mock are healthy
- the expected image tags are running
- E2E test data has been reset and reloaded in a controlled way

## Reset Modes

### 1. Service restart

Use this when:
- containers are stale
- local images were rebuilt
- you need to recreate the running stack

This does not destroy the database.

### 2. Test-data reset

Use this when:
- you want a fresh E2E dataset
- the stack should keep its seeded database foundation
- you are preparing to run Playwright from a known state

This is the normal reset path for demo and analyzer E2E work.

It relies on upstream scripts in `../OpenELIS-Global-2/src/test/resources/`:
- `reset-test-database.sh`
- `load-test-fixtures.sh`

### 3. Cold reset

Use this only when:
- you have verified the bootstrap path for this image set
- you intentionally want to destroy persisted DB state

Do not use a cold reset as the routine answer to "make it clean for E2E".

## Hard Rule

Do not casually delete `configs/database/data2`.

Why:
- this distro may depend on seeded or image-initialized database state
- an empty bind-mounted Postgres directory is not the same thing as a supported
  clean bootstrap
- a naive wipe can leave OE unable to start cleanly

If you are not certain a cold reset is documented and supported, stop and use a
service restart plus upstream test-data reset instead.

## Recommended Analyzer E2E Reset Flow

### Step 1. Validate compose layering

```bash
./scripts/validate-compose.sh
```

### Step 2. Start or recreate the intended stack

Published-image validation:

```bash
docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  up -d
```

Local-image validation (build, then run with `OE_IMAGE_TAG=local`):

```bash
./scripts/restart-stack.sh --rebuild
# or, manually:
OE_IMAGE_TAG=local docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  up -d --force-recreate
```

If only some local-image services changed, recreate the affected services
explicitly:

```bash
OE_IMAGE_TAG=local docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  up -d --force-recreate \
  oe.openelis.org frontend.openelis.org openelis-analyzer-bridge analyzer-mock
```

### Step 3. Wait for readiness

Do not rely on `docker ps` alone.

Check compose state:

```bash
docker compose -f compose.yaml -f compose.validate.yaml ps
```

Check OE:

```bash
curl -k -sSf https://localhost:8443/OpenELIS-Global/health
curl -k -sSf -X POST \
  'https://localhost/api/OpenELIS-Global/ValidateLogin?apiCall=true' \
  -d 'loginName=admin&password=adminADMIN!'
```

Check bridge:

```bash
curl -k -sSf https://localhost:8442/actuator/health
```

Check mock:

```bash
curl -sSf http://localhost:8085/health
```

Optional image-tag verification:

```bash
docker inspect openelisglobal-webapp --format '{{.Config.Image}}'
docker inspect openelis-analyzer-bridge --format '{{.Config.Image}}'
docker inspect openelis-analyzer-mock --format '{{.Config.Image}}'
```

### Step 4. Reset and reload E2E test data

From the upstream repo:

```bash
cd /home/ubuntu/OpenELIS-Global-2
./src/test/resources/load-test-fixtures.sh --reset --analyzers=full
```

Why this path:
- it resets test-scoped rows instead of destroying the whole database
- it verifies schema and seed dependencies before loading fixtures
- it reloads the analyzer and E2E data expected by local validation flows

If you only need reset without reload, use:

```bash
cd /home/ubuntu/OpenELIS-Global-2
./src/test/resources/reset-test-database.sh --force
```

In normal E2E preparation, prefer `load-test-fixtures.sh --reset --analyzers=full`
over reset-only.

### Step 5. Re-check readiness

After fixture reset/reload, confirm OE and bridge are still healthy:

```bash
curl -k -sSf https://localhost:8443/OpenELIS-Global/health
curl -k -sSf -X POST \
  'https://localhost/api/OpenELIS-Global/ValidateLogin?apiCall=true' \
  -d 'loginName=admin&password=adminADMIN!'
curl -k -sSf https://localhost:8442/actuator/health
curl -sSf http://localhost:8085/health
```

### Step 6. Run Playwright

Dockerized demo runner:

```bash
COMPOSE_PROFILES=demo docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  run --rm demo-tests
```

Local video or ad hoc runs from `tests/playwright` should only happen after the
reset and readiness checks above pass.

## Analyzer-state reset (test environment only)

Use this in addition to the test-data reset (above) when:

- `analyzer_test_map` rows are pointing to wrong tests and provenance
  is unclear (legacy admin entry, deleted profiles, etc.)
- `analyzer_results` staging table has accumulated rows for analyzers
  whose mappings or configuration you intend to recreate
- `analyzer` table has `PENDING_REGISTRATION` stubs from prior
  unregistered-source discovery runs that you want to clear out
- bridge `dead-letters/` directory is full of captured-but-unrouted
  ASTM messages from unregistered sources

The standard `reset-test-database.sh` only resets E2E* / TEST-* sample
+ storage rows — it does NOT touch the analyzer subsystem. The analyzer
ids in the production-data range (e.g. 397, 552, 634, 635) are
preserved by design.

For analyzer-state reset use:

```bash
./scripts/reset-analyzer-state.sh \
  --force \
  --include-stubs \
  --include-deadletters
```

Hard precondition: `--include-deadletters` will refuse to run unless a
real-message backup exists at `~/astm-fixtures-real-YYYYMMDD/`. The
bridge dead-letter dir is the only place real captured ASTM messages
live; clearing it without backup is destructive and unrecoverable.

After running, restart the stack:

```bash
./scripts/restart-stack.sh
```

The bridge will re-create empty watch dirs on startup; analyzer
re-creation goes through the normal UI / OE auto-registration flow.

## When to Escalate

Stop and investigate before running tests if:
- OE health is up but login keeps failing
- bridge health is degraded or `httpforward` is not `UP`
- mock health is unavailable while using the validate overlay
- local image tags are not the ones you intended to validate
- you are considering deleting `configs/database/data2`

## References

- `AGENTS.md`
- `docs/validation.md`
- `../OpenELIS-Global-2/AGENTS.md`
- `../OpenELIS-Global-2/src/test/resources/FIXTURE_LOADER_README.md`
- `../OpenELIS-Global-2/src/test/resources/load-test-fixtures.sh`
- `../OpenELIS-Global-2/src/test/resources/reset-test-database.sh`
- `../OpenELIS-Global-2/projects/analyzer-harness/README.md`
