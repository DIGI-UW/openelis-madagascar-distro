# openelis-madagascar-distro

OpenELIS Global deployment package for Madagascar — Docker Compose stack
with the Madagascar configuration profile, analyzer bridge, and lab-data
converters bundled.

This repo IS the deployment artifact: every tagged release is consumable
as a [GitHub auto-archive](https://github.com/DIGI-UW/openelis-madagascar-distro/releases),
a `git clone --branch <tag>`, or a downloaded Release tarball. Ozone-style
consumers and direct implementers all use the same versioned tag.

## Quickstart (localhost demo)

```bash
git clone https://github.com/DIGI-UW/openelis-madagascar-distro
cd openelis-madagascar-distro
docker compose up -d
```

Then open https://localhost/ in your browser:

| URL | Credentials |
|---|---|
| https://localhost/ | `admin` / `adminADMIN!` |

The default `.env` ships demo credentials (`ADMIN_PASSWORD=superuser`,
`OE_DB_PASSWORD=clinlims`) suitable for localhost evaluation. Change
these before any non-localhost deployment.

## Production deployment

| Topic | Pointer |
|---|---|
| Let's Encrypt TLS for a public hostname | [docs/letsencrypt.md](docs/letsencrypt.md) |
| Resetting the database between runs | [docs/database-reset.md](docs/database-reset.md) |
| Deploying / restarting the analyzer bridge | [docs/analyzer-bridge-deploy-runbook.md](docs/analyzer-bridge-deploy-runbook.md) |
| Permission errors on `configs/` | `./scripts/fix-config-permissions.sh` |

The Let's Encrypt overlay reads `LETSENCRYPT_*` vars from
`.env.letsencrypt` (start from `.env.letsencrypt.example`), plus the base
`.env`. See `docs/letsencrypt.md` for the full walkthrough.

## Lab-data utilities

`scripts/convert-*.py` are one-shot converters for analyzer file formats
shipped with this distro:

- `convert-fluorocycler-legacy.py` — FluoroCycler XT legacy export → ASTM
- `convert-multiskan-skanit.py` — Thermo Multiskan SkanIt → ASTM
- `convert-tecan-magellan.py` — Tecan Magellan → ASTM

Run with `python3 scripts/convert-<analyzer>.py --help` for usage.

## Developing or testing this distro

The dev workspace, Playwright E2E tests, build overlays, and dev
orchestration scripts live in the sibling
[openelis-madagascar-test-harness][harness] repo. The harness consumes
this distro at a tag (or as a sibling clone) and adds a mock analyzer +
test runner on top.

[harness]: https://github.com/DIGI-UW/openelis-madagascar-test-harness
