## OpenELIS Docker Compose Distribution Setup for Magadascar
Docker Compose setup for OpenELIS-Global2

You can find more information on how to set up OpenELIS at our [docs page](http://docs.openelis-global.org/)

[![Build Status](https://github.com/I-TECH-UW/OpenELIS-Global-2/actions/workflows/ci.yml/badge.svg)](https://github.com/I-TECH-UW/OpenELIS-Global-2/actions/workflows/ci.yml)

[![Publish Docker Image Status](https://github.com/I-TECH-UW/OpenELIS-Global-2/actions/workflows/publish-and-test.yml/badge.svg)](https://github.com/I-TECH-UW/OpenELIS-Global-2/actions/workflows/publish-and-test.yml)

[![Build Off Line Docker Images](https://github.com/I-TECH-UW/openelis-docker/actions/workflows/build-installer.yml/badge.svg)](https://github.com/I-TECH-UW/openelis-docker/actions/workflows/build-installer.yml)

## ONLINE INSTALLATION

## Updating the DB Passord (Optional)
1. Update the Enviroment vaiable `OE_DB_PASSWORD` in the [.env](./.env) file for the 'clinlims' user

1. Update the Enviroment vaiable `ADMIN_PASSWORD` in the [.env](./.env) file for the 'admin' user

### Running OpenELIS Global with docker-compose
    docker compose up -d

#### The Instance can be accessed at 

| Instance  |     URL       | credentials (user: password)|
|---------- |:-------------:|------:                       |
| OpenELIS Frontend  |    https://localhost/  |  admin: adminADMIN!

### HTTPS (public hostname, Let's Encrypt)

Optional overlay `compose.letsencrypt.yaml` and `scripts/generate-letsencrypt-certs.sh` enable
trusted TLS for one or more public hostnames (HTTP-01). The hostname list is configurable through
Compose env vars such as `LETSENCRYPT_DOMAINS`, `LETSENCRYPT_PRIMARY_DOMAIN`, and `LETSENCRYPT_CERT_NAME`.
See [`docs/letsencrypt.md`](./docs/letsencrypt.md).

### Analyzer bridge and validation

- **`ANALYZER_BRIDGE_URL`** is set on the webapp so OpenELIS can register analyzers with the bridge (`compose.yaml`).
- Bridge forward URL uses the CI-style base **`/OpenELIS-Global/analyzer`** (see `configs/astm/configuration.yml` and bridge env).
- **`compose.validate.yaml`** adds analyzer mock wiring plus a local `demo-tests` runner for the 10 Madagascar demo Playwright flows (enable with Compose profile **`demo`**; see `docs/validation.md`).
- **`docs/validation.md`** documents the self-contained bring-up + demo test flow.
- If startup logs show **permission denied** writing checksums under `configs/configuration/backend/`, run once: `./scripts/fix-config-permissions.sh`
- Compose merge check: `./scripts/validate-compose.sh`

       
    

