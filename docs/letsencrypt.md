# Let's Encrypt (public hostnames)

This distro serves the UI at `/` and the API at `/api/` through the `proxy` service.
For public hostnames, use HTTP-01 with the optional compose overlay and helper script.
The proxy config is hostname-agnostic; the certificate lineage and SAN list are driven by
compose env vars.

Upstream reference: `../OpenELIS-Global-2/docs/LETSENCRYPT_SETUP.md` and
`../OpenELIS-Global-2/nginx-proxy/docker-entrypoint.sh` (same symlink behavior).

## Prerequisites

- DNS `A` (or equivalent) for each requested hostname → this host’s public IP.
- **TCP 80** reachable from the internet (Let’s Encrypt validation).
- Base stack already mounts `./volume/nginx/certbot` for the ACME webroot (`docker-compose.yml`).
- If you added the certbot mount after the proxy was first created, **recreate** the proxy so the mount appears inside the container:  
  `docker compose -f docker-compose.yml up -d --force-recreate proxy`  
  (Otherwise `/var/www/certbot` is missing in the container and validation returns 404 or redirects.)

## Bring-up

1. Start the stack (proxy must be running):

   ```bash
   docker compose -f docker-compose.yml up -d
   ```

2. **Quota-safe check** (recommended before real issuance):

   ```bash
   export LETSENCRYPT_EMAIL='you@example.com'
   ./scripts/generate-letsencrypt-certs.sh --dry-run
   ```

   `--dry-run` exercises ACME without consuming Let’s Encrypt **production** issuance quota.

3. Issue or update the real certificate:

   ```bash
   ./scripts/generate-letsencrypt-certs.sh
   ```

4. Recreate the proxy with the Let’s Encrypt overlay so nginx can read
   `/etc/letsencrypt/live/$LETSENCRYPT_DOMAIN/` and symlink into the paths nginx uses:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.letsencrypt.yml up -d --force-recreate proxy
   ```

   Set the env vars below in Compose or your shell before running the script.

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `LETSENCRYPT_EMAIL` | Yes (for `certbot`) | — | ACME account / notices |
| `LETSENCRYPT_DOMAINS` | No | `madagascar.openelis-global.org,mgtest.openelis-global.org` | Comma- or space-separated SAN list |
| `LETSENCRYPT_PRIMARY_DOMAIN` | No | first entry in `LETSENCRYPT_DOMAINS` | Default cert lineage / primary hostname |
| `LETSENCRYPT_CERT_NAME` | No | `LETSENCRYPT_PRIMARY_DOMAIN` | Explicit lineage name under `volume/letsencrypt/live/` |
| `LETSENCRYPT_DOMAIN` | Legacy | — | Backward-compatible single-domain fallback |
| `LETSENCRYPT_STAGING` | No | `false` | First-time `certonly` only: use `--staging` (untrusted chain) |

Example for two names on one certificate:

```bash
export LETSENCRYPT_DOMAINS="madagascar.openelis-global.org,mgtest.openelis-global.org"
export LETSENCRYPT_PRIMARY_DOMAIN="madagascar.openelis-global.org"
export LETSENCRYPT_CERT_NAME="madagascar.openelis-global.org"
./scripts/generate-letsencrypt-certs.sh
```

## Renewal

When a certificate already exists under `volume/letsencrypt/live/<cert-name>/`, the script renews it
when the requested SAN list matches, or expands the lineage when the requested SAN list changes.
Use `./scripts/generate-letsencrypt-certs.sh --dry-run` to test renewal without production quota impact.

## Wildcard DNS

A DNS wildcard (e.g. `*.madagascar.openelis-global.org`) does **not** replace a public certificate for
that name; wildcard issuance requires DNS-01 and is out of scope for this HTTP-01 flow.

## Verification checklist

After issuance and `docker compose ... --force-recreate proxy` with `docker-compose.letsencrypt.yml`:

```bash
curl -I "http://madagascar.openelis-global.org"
curl -I "http://mgtest.openelis-global.org"
curl -v "https://madagascar.openelis-global.org/"
curl -v "https://mgtest.openelis-global.org/"
curl -sSf -X POST \
  'https://madagascar.openelis-global.org/api/OpenELIS-Global/ValidateLogin?apiCall=true' \
  -d 'loginName=admin&password=adminADMIN!'
```

Expect HTTP→HTTPS redirect, a trusted certificate chain in the browser (no `-k`), and a successful login
response. For the same machine without public DNS, continue using `https://localhost/` with `-k` as in
`docs/validation.md`.
