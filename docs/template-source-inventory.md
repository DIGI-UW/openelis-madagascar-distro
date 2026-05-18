# Template Source Inventory

This Madagascar distro is the source reference for extracting a clean
`openelis-distro-template` repository. The template repository should be created
fresh with `git init`; files from this repo should be copied deliberately after
classification, not by preserving Madagascar git history.

## Generic Template Core

These files are broadly reusable after replacing Madagascar-specific defaults in
the new template repo only:

- `docker-compose.yml`
- `compose.letsencrypt.yaml`
- `.github/workflows/pr.yml`
- `.github/workflows/release.yml`
- `scripts/build-release-notes.sh`
- `scripts/build-tarball.sh`
- `scripts/check-release-pins.sh`
- `scripts/fix-config-permissions.sh`
- `scripts/generate-letsencrypt-certs.sh`
- `scripts/pin-versions.sh`
- `configs/configuration/backend/observation-history-types/environmental-observation-types.csv`
- `configs/configuration/backend/nce-categories/nce-categories.csv`
- `configs/configuration/backend/nce-types/nce-types.csv`
- `configs/configuration/backend/questionnaires/generic-sample-logbook-questionnaire.json`

Pure vendor analyzer profiles can move into the template after a final copy-time
check confirms they contain no Madagascar, LA2M, or site-specific notes:

- `configs/analyzer-profiles/astm/horiba-micros60.json`
- `configs/analyzer-profiles/astm/horiba-pentra60.json`
- `configs/analyzer-profiles/astm/mindray-ba88a.json`
- `configs/analyzer-profiles/astm/stago-start4.json`
- `configs/analyzer-profiles/astm/sysmex-xn.json`
- `configs/analyzer-profiles/hl7/abbott-architect.json`
- `configs/analyzer-profiles/hl7/mindray-bc2000.json`
- `configs/analyzer-profiles/hl7/mindray-bc5380.json`
- `configs/analyzer-profiles/hl7/mindray-bs200.json`
- `configs/analyzer-profiles/hl7/mindray-bs300.json`
- `configs/analyzer-profiles/hl7/mindray-bs360e.json`
- `configs/analyzer-profiles/file/dtprime.json`

## Madagascar Payload

These files are Madagascar production configuration and should stay in generated
country repos, not in the base template:

- `configs/configuration/backend/address-hierarchy/madagascar-levels.csv`
- `configs/configuration/backend/address-hierarchy/madagascar-values.csv`
- `configs/configuration/backend/dictionaries/madagascar-dictionary-entries.csv`
- `configs/configuration/backend/locales/madagascar-locales.csv`
- `configs/configuration/backend/roles/madagascar-lab-roles.csv`
- `configs/configuration/backend/sample-types/madagascar-sample-types.csv`
- `configs/configuration/backend/site-information/madagascar-site-information.csv`
- `configs/configuration/backend/test-results/madagascar-test-results.csv`
- `configs/configuration/backend/test-sections/madagascar-test-sections.csv`
- `configs/configuration/backend/tests/madagascar-tests.csv`
- `configs/analyzer/analyzer-test-map.csv`
- `configs/menu/menu_config.json`
- `configs/odoo/odoo-test-product-mapping.csv`

These analyzer profiles carry Madagascar/site test-code mappings or notes and
should remain country payload unless they are later split into a generic vendor
profile plus country overlay:

- `configs/analyzer-profiles/astm/genexpert-astm.json`
- `configs/analyzer-profiles/hl7/genexpert-hl7.json`
- `configs/analyzer-profiles/file/fluorocycler-xt.json`
- `configs/analyzer-profiles/file/genexpert-csv.json`
- `configs/analyzer-profiles/file/multiskan-fc.json`
- `configs/analyzer-profiles/file/quantstudio.json`
- `configs/analyzer-profiles/file/tecan-f50.json`
- `configs/analyzer-profiles/file/wondfo-csv.json`

The converter scripts under `scripts/converters/` show a reusable host-side
adaptation pattern, but the current scripts target Madagascar lab file formats.
Treat them as country payload for the first template extraction.

## Runtime And Local Artifacts

Generated runtime state must not be copied into the template or committed back
to this country repo:

- `.env`
- `.env.letsencrypt`
- `.env.local`
- `.env.*.local`
- `compose.yaml`
- `compose.override.yaml`
- `compose.override.yml`
- `docker-compose.override.yml`
- `configs/database/data*/`
- `configs/logs/`
- `configs/letsencrypt/live/`
- `configs/letsencrypt/archive/`
- `configs/letsencrypt/renewal/`
- `configs/letsencrypt/accounts/`
- `configs/properties/TotalSystemConfiguration.properties`
- `configs/properties/ChangedSystemConfiguration.properties`
- any checksum or checksums properties files

The base template should ship `.env.example`, `.gitignore`, and empty placeholder
directories only where needed for Docker Compose path resolution.
