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

`compose.yaml` ships sensible localhost-demo defaults (DB password, admin
password, TLS material paths) so the stack boots out of the box without a
local `.env`. To override anything for production, copy `.env.example` to
`.env` and edit. **`.env` is gitignored — never commit it.**

## Image pinning

Every service in `compose.yaml` is pinned directly to a literal
`repo:tag@sha256:<digest>` reference:

```yaml
image: itechuw/openelis-global-2:3.2.1.6@sha256:0fb3a481...
image: itechuw/openelis-analyzer-bridge:3.0.1@sha256:6d43bf5b...
```

The tag is human-readable documentation ("this is the 3.2.1.6 release");
the digest is the immutability lock — `docker compose pull` returns the
exact bytes regardless of when or where it runs, even if upstream
republishes the tag.

To bump pins (maintainer workflow) — accepts any published upstream tag,
release name or `develop`:

```bash
./scripts/pin-versions.sh                       # refresh digests, current tags
./scripts/pin-versions.sh 3.2.1.7 3.0.2         # bump both to release tags
./scripts/pin-versions.sh develop 3.0.1         # OE to current develop snapshot; bridge to release
./scripts/pin-versions.sh develop develop       # both at current develop snapshots
git diff compose.yaml                            # review
git commit compose.yaml -m "chore: bump pins to ..."
```

Distro tags release independently of upstream OE versioning — distro
`3.2.2.0` could ship with OE `3.2.1.6` images, OE `develop` snapshots,
or any mix.

## Cutting a release

Releases are produced by the `Release` GitHub Actions workflow
(`workflow_dispatch`). The workflow collects all version inputs up front,
refreshes image digests in `compose.yaml`, validates the result is
release-shaped, then tags and publishes — no local `git tag`/`git push`
step.

To cut a release:

1. **Actions → Release → Run workflow** in the GitHub UI.
2. Fill in the inputs:
   - `distro_version` — e.g. `3.2.2.0`. Must not collide with an existing tag.
   - `oe_version` — OE image tag, e.g. `3.2.1.6`.
   - `bridge_version` — Analyzer Bridge image tag, e.g. `3.0.1`.
   - `base_ref` *(optional)* — branch or commit to release from; defaults to `main`. Useful for backports.
   - `allow_develop_pins` *(optional)* — leave **off** for normal releases. The workflow fails if any image pin is non-release (`:develop`/`:latest`/missing digest) unless this is on.
   - `draft` *(optional)* — leave **on** (default) to review the Release before publishing.
   - `prerelease` *(optional)* — flag the Release as pre-release.
3. Click **Run workflow**.

The workflow then:

1. Validates `distro_version` shape, captures the previous tag, and confirms the new tag doesn't already exist.
2. Runs `scripts/pin-versions.sh <oe> <bridge>` to refresh digests in `compose.yaml`.
3. Runs `scripts/check-release-pins.sh` to assert every pin is release-shaped.
4. If digests changed, commits the diff (a release commit reachable **only via the new tag**); otherwise tags the existing `base_ref` HEAD.
5. Builds the release tarball via `scripts/build-tarball.sh`.
6. Publishes a GitHub Release with notes assembled from the upstream OE and Analyzer Bridge release bodies plus the distro-side commit log since the previous distro tag, with the tarball attached.

Review the draft Release in the GitHub UI, then publish when satisfied.
At any commit (`main` or a release tag), `compose.yaml` carries fully
resolved literal image references; consumers cloning at the tag (or
downloading the auto-archive or the Release tarball) get a self-contained,
byte-reproducible package.

## Production deployment

| Topic | Pointer |
|---|---|
| Let's Encrypt TLS for a public hostname | [docs/letsencrypt.md](docs/letsencrypt.md) |
| Permission errors on `configs/` | `./scripts/fix-config-permissions.sh` |

The Let's Encrypt overlay reads `LETSENCRYPT_*` vars from `.env`. Start
from `.env.example` (uncomment the LE block) and follow
`docs/letsencrypt.md` for the full walkthrough.

## Lab-data utilities

`scripts/convert-*.py` are standalone preprocessors that normalize raw
analyzer exports into the shape each `configs/analyzer-profiles/file/*.json`
profile expects, before the bridge picks the file up:

- `convert-fluorocycler-legacy.py` — legacy manually-copy-pasted FluoroCycler XT XLSX → standardized FC-XT XLSX template (`configs/templates/FC-XT_Template.xlsx`).
- `convert-multiskan-skanit.py` — Thermo Multiskan SkanIt dual-plate-grid XLSX export → well-per-row CSV.
- `convert-tecan-magellan.py` — Tecan Infinite F50 custom Magellan two-sheet XLSX → well-per-row CSV.

Requires `openpyxl` (`pip install openpyxl`). Run with
`python3 scripts/convert-<analyzer>.py --help` for usage.

## Developing or testing this distro

The dev workspace, Playwright E2E tests, build overlays, and dev
orchestration scripts live in the sibling
[openelis-madagascar-test-harness][harness] repo. The harness consumes
this distro at a tag (or as a sibling clone) and adds a mock analyzer +
test runner on top.

[harness]: https://github.com/DIGI-UW/openelis-madagascar-test-harness
