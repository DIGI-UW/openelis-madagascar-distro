# AGENTS.md

## Purpose

This repository is the Docker Compose distribution for a context-specific
OpenELIS package.

Its job is to assemble and operate OpenELIS for a particular country or health
system context, including:
- distro-specific container wiring
- environment configuration
- analyzer bridge and mock integration
- image tag selection (`OE_IMAGE_TAG` / `BRIDGE_IMAGE_TAG`)
- validation overlays
- Playwright demo and validation runs

In this repository, "distro work" means packaging and operating OpenELIS in a
deployment-specific way, not redefining core application architecture.

For core OpenELIS backend and frontend implementation rules, always read the
upstream app guidance first:
- `../OpenELIS-Global-2/AGENTS.md`

Also consult:
- `README.md`
- `docs/validation.md`
- `docs/letsencrypt.md` (optional public HTTPS)

## Repo Boundary

This repo owns:
- Docker Compose orchestration
- distro-level configuration and overrides
- analyzer validation wiring
- Playwright validation assets under `tests/playwright`

This repo does not own:
- core Java backend architecture
- core React frontend architecture
- database schema design
- analyzer parsing and application business logic

When an issue may be caused by product code, image behavior, Liquibase, or
backend/frontend implementation, inspect `../OpenELIS-Global-2` before changing
the distro.

## Working Rules

- Use TDD for implementation work in manageable chunks when changing code.
- Validate after each checkpoint.
- Before large changes, refactors, or environment pivots, explain the plan and
  get confirmation.
- Prefer runtime evidence over guesswork: logs, health endpoints, image tags,
  compose config, and targeted probes.
- Do not improvise destructive environment resets without checking docs and
  upstream guidance first.

## Compose Rules

Filenames follow the modern Compose spec (`compose.yaml`, not `docker-compose.yml`).

Base stack:
- `compose.yaml`

Analyzer validation overlay:
- `compose.validate.yaml`

Public TLS (Let's Encrypt, optional):
- `compose.letsencrypt.yaml` — proxy reads `/etc/letsencrypt` and uses `configs/nginx/docker-entrypoint.sh`
- `docs/letsencrypt.md` — issuance, dry-run, and renewal

Image tag selection:
- All OpenELIS images use `${OE_IMAGE_TAG:-develop}`. The bridge uses `${BRIDGE_IMAGE_TAG:-develop}`.
- Default runs use the published `:develop` tag.
- For local builds, run `./scripts/restart-stack.sh --rebuild` (auto-builds + sets `OE_IMAGE_TAG=local`) or export `OE_IMAGE_TAG=local` manually.
- There is **no** `local-images.yml` overlay — the env var replaces it.

For local analyzer validation, prefer the restart script which uses all layers
and waits for health:

```bash
./scripts/restart-stack.sh          # restart, keep data
./scripts/restart-stack.sh --clean  # restart, remove volumes (DB, certs, indexes)
./scripts/restart-stack.sh --rebuild # build :local images first, then restart
```

Or manually with all layers:

```bash
docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  -f compose.letsencrypt.yaml \
  up -d
```

After rebuilding local images, do not assume `docker compose up -d` will
recreate containers. Use `--force-recreate` for the affected services.

## Health Rules

Do not declare the distro healthy from `docker ps` alone.

OpenELIS is considered up only when these succeed:

```bash
curl -k -sSf https://localhost:8443/OpenELIS-Global/health
curl -k -sSf -X POST \
  'https://localhost/api/OpenELIS-Global/ValidateLogin?apiCall=true' \
  -d 'loginName=admin&password=adminADMIN!'
```

Bridge is considered up only when this succeeds:

```bash
curl -k -sSf https://localhost:8442/actuator/health
```

When running with the validate overlay, also verify the mock:

```bash
curl -sSf http://localhost:8085/health
```

## Database Reset Rules

## Reset Modes

Treat "clean state" as one of these explicit modes:

- `service-restart`: recreate the intended compose stack and re-verify health.
- `test-data-reset`: preserve the seeded database, then refresh E2E fixtures
  using upstream reset/loader scripts.
- `cold-reset`: destructive database wipe or volume replacement. This is not the
  routine E2E reset path.

Preferred upstream scripts for `test-data-reset`:
- `../OpenELIS-Global-2/src/test/resources/reset-test-database.sh`
- `../OpenELIS-Global-2/src/test/resources/load-test-fixtures.sh`

For analyzer E2E bring-up, prefer:

```bash
docker compose \
  -f compose.yaml \
  -f compose.validate.yaml \
  up -d
```

Set `OE_IMAGE_TAG=local` to validate locally-built images; omit it (default
`develop`) for published-image validation.

Hard rule:
- Never treat deleting `configs/database/data2` as a generic safe database reset.

Why:
- This distro may depend on seeded or image-initialized database state beyond
  what the webapp can create on top of an empty Postgres directory.
- An empty bind-mounted database directory can leave OpenELIS unable to start
  cleanly.

Preferred reset options:
1. Use upstream test-data reset and fixture-loading scripts in
   `../OpenELIS-Global-2/src/test/resources/` when the goal is to clean test
   data, not destroy the whole database.
2. Restore from a known-good seeded snapshot when a quick recovery is required.
3. Only perform a true cold-start wipe after verifying the documented bootstrap
   path for this distro and image set.

If the docs do not clearly describe a database reset path:
- stop
- inspect this repo's docs plus `../OpenELIS-Global-2`
- state the uncertainty explicitly
- avoid destructive improvisation

Detailed distro reset runbook:
- `docs/database-reset.md`

## Analyzer Validation Rules

For analyzer demo or video runs:
- ensure the validate overlay is active
- ensure OE, bridge, and mock health checks pass first
- ensure the intended image tags are actually running
- only then run Playwright

When debugging analyzer failures:
- inspect `openelisglobal-webapp` logs
- inspect `openelis-analyzer-bridge` logs
- distinguish wiring/config issues from product regressions
- verify OE readiness before interpreting bridge timeout or routing failures

## Playwright Rules

Use the repo's Playwright config and scripts under `tests/playwright`.

For local long-running runs:
- keep output visible
- use `tee` to a temp log so progress can be monitored
- confirm the report and artifacts came from the latest run

Before claiming a validation run is good, verify:
- the tests actually ran
- the intended project ran
- the expected artifacts were generated
- reporter behavior was not changed unexpectedly by `CI`

## Git and PR Safety

- Never push directly to `develop`.
- Keep distro changes in this repo and product changes in
  `../OpenELIS-Global-2` on their correct branches and PRs.
- If work spans both repos, check status in both repos before claiming the work
  is complete.
- After a resumed session, re-check current branch, local image assumptions, and
  running container state before acting.
