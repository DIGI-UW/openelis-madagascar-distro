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

## Image pinning

Every service in `compose.yaml` resolves its image from an env var in
`.env` — each pin is a release tag plus a sha256 manifest-list digest:

```
OE_WEBAPP_IMAGE=itechuw/openelis-global-2:3.2.1.6@sha256:0fb3a481...
OE_BRIDGE_IMAGE=itechuw/openelis-analyzer-bridge:3.0.1@sha256:6d43bf5b...
...
```

`docker compose pull` returns the exact bytes regardless of when or
where it runs — even if upstream republishes the tag, the digest pin
doesn't move.

To bump pins (maintainer workflow):

```bash
./scripts/pin-versions.sh                  # refresh digests for current versions
./scripts/pin-versions.sh 3.2.1.7 3.0.2    # bump OE images + bridge
git diff .env                              # review
git commit .env -m "chore: bump pins to OE 3.2.1.7 + bridge 3.0.2"
```

Distro tags release independently of upstream OE versioning — distro
`3.2.2.0` could ship with upstream OE `3.2.1.6` images.

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
