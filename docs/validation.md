# Analyzer validation (distro)

This repository now includes a self-contained, docker-based validation path:
- published OE + bridge images
- published mock image
- distro-local Playwright demo tests (`tests/playwright`)

## Published `develop` images

The default stack uses floating tags (`itechuw/openelis-global-2:develop`, `itechuw/openelis-analyzer-bridge:develop`, etc.). After wiring fixes:

1. **OE → bridge registration** — In webapp logs, expect `Bridge registration complete: N bindings pushed` with **N > 0** when analyzers exist and `ANALYZER_BRIDGE_URL` points at the bridge HTTPS URL (see `docker-compose.yml`).
2. **`discovered-sources` 404** — If the bridge still logs `404` for `.../discovered-sources` after aligning `ORG_ITECH_AHB_FORWARD_HTTP_SERVER_URI` and `ANALYZER_BRIDGE_URL`, treat that as a **version skew** between the published `develop` webapp and bridge images (not a distro-only misconfiguration).

## Local image builds (no merge wait)

For local PR validation, build from source and point this distro stack at local tags:

```bash
cd /path/to/OpenELIS-Global-2
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -t itechuw/openelis-global-2:local .
```

Optional bridge local build:

```bash
cd /path/to/openelis-analyzer-bridge
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -t itechuw/openelis-analyzer-bridge:local .
```

Then use a local compose override copied from [`docker-compose.local-images.example.yml`](../docker-compose.local-images.example.yml):

```bash
cp docker-compose.local-images.example.yml docker-compose.local-images.yml
```

Bring up with base + validate + local images:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.validate.yml \
  -f docker-compose.local-images.yml \
  up -d
```

Verify running image tags:

```bash
docker inspect openelisglobal-webapp --format '{{.Config.Image}}'
docker inspect openelis-analyzer-bridge --format '{{.Config.Image}}'
```

Notes:
- Keep `docker-compose.local-images.yml` local and untracked (`.gitignore`) because local source paths are machine-specific.
- Prefer `:local`/`:pr-<id>` tags instead of `:develop` to avoid accidental overwrite when pulling published images.

## Validation overlay (mock + MLLP + demo tests)

Bring up the stack with the image-based overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.validate.yml up -d
```

The Playwright runner uses Compose **profile** `demo` so a normal `up -d` does not start the one-shot test container.

Readiness checks:

```bash
docker compose -f docker-compose.yml -f docker-compose.validate.yml ps
curl -k -sSf https://localhost:8442/actuator/health
curl -sSf http://localhost:8085/health
```

The overlay adds **`itechuw/astm-mock-server:latest`** (published mock; same family as upstream `analyzer-mock-server`) and extra bridge ports/env for ASTM forward-to-mock and HL7/MLLP.

## Run the 10 Madagascar demo tests (local, dockerized)

1. Ensure the stack is up with the validate overlay.
2. Run the demo runner service:

```bash
COMPOSE_PROFILES=demo docker compose -f docker-compose.yml -f docker-compose.validate.yml run --rm demo-tests
```

Optional overrides:

```bash
BASE_URL=https://proxy TEST_USER=admin TEST_PASS=adminADMIN! \
COMPOSE_PROFILES=demo docker compose -f docker-compose.yml -f docker-compose.validate.yml run --rm demo-tests
```

Artifacts:
- `test-results/playwright-report`
- `test-results/test-output`

No upstream checkout is required at runtime.

## ASTM read timeouts (~60s)

After **correct wiring** (`ANALYZER_BRIDGE_URL`, forward URL `/OpenELIS-Global/analyzer`, consistent ASTM listen ports), if logs still show long ASTM read timeouts, investigate **network path to instrument** (host port `12000` → container `12001`), firewalls, and whether the analyzer is actually sending on the expected port.

## Compose merge sanity check

From the repo root:

```bash
./scripts/validate-compose.sh
```

This runs `docker compose ... config` for the base file and the merged validate overlay (no containers started).
