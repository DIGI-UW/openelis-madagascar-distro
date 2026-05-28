# Let's Encrypt (public hostnames)

This distro serves the UI at `/` and the API at `/api/` through the `proxy` service.
For public hostnames, use HTTP-01 with the optional compose overlay and helper script.
The proxy config is hostname-agnostic; the certificate lineage and SAN list are driven by
compose env vars.

## Prerequisites

- DNS `A` (or equivalent) for each requested hostname → this host’s public IP.
  This includes the analyzer-bridge upload UI host `bridge.mgtest.openelis-global.org`
  (now in the default SAN list — see below).
- **TCP 80** reachable from the internet (Let’s Encrypt validation).
- Base stack already mounts `./configs/nginx/certbot` for the ACME webroot (`docker-compose.yml`).
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
   `/etc/letsencrypt/live/$LETSENCRYPT_CERT_NAME/` and symlink into the paths nginx uses
   (the lineage directory is selected by `LETSENCRYPT_CERT_NAME`, falling back to
   `LETSENCRYPT_PRIMARY_DOMAIN` then the legacy `LETSENCRYPT_DOMAIN`):

   ```bash
   docker compose -f docker-compose.yml -f compose.letsencrypt.yaml up -d --force-recreate proxy
   ```

   Set the env vars below in Compose or your shell before running the script.

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `LETSENCRYPT_EMAIL` | Yes (for `certbot`) | — | ACME account / notices |
| `LETSENCRYPT_DOMAINS` | No | `mgtest.openelis-global.org,bridge.mgtest.openelis-global.org` | Comma- or space-separated SAN list (includes the bridge upload UI host) |
| `LETSENCRYPT_PRIMARY_DOMAIN` | No | first entry in `LETSENCRYPT_DOMAINS` | Default cert lineage / primary hostname |
| `LETSENCRYPT_CERT_NAME` | No | `LETSENCRYPT_PRIMARY_DOMAIN` | Explicit lineage name under `configs/letsencrypt/live/` |
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

When a certificate already exists under `configs/letsencrypt/live/<cert-name>/`, the script renews it
when the requested SAN list matches, or expands the lineage when the requested SAN list changes.
Use `./scripts/generate-letsencrypt-certs.sh --dry-run` to test renewal without production quota impact.

## Wildcard DNS

A DNS wildcard (e.g. `*.madagascar.openelis-global.org`) does **not** replace a public certificate for
that name; wildcard issuance requires DNS-01 and is out of scope for this HTTP-01 flow.

## Analyzer-bridge upload UI

The `proxy` routes a dedicated hostname to the analyzer-bridge upload UI
(`configs/nginx/nginx.conf`, `server_name bridge.mgtest.openelis-global.org`). It proxies to
`https://bridge.openelis.org:8443` and redirects `/` → `/admin/upload/index.html`. The bridge
requires HTTP Basic Auth, aligned with the OE admin credentials (`admin` /
`${OE_ADMIN_PASSWORD}`, default `adminADMIN!`) via `BRIDGE_SECURITY_USERNAME` /
`BRIDGE_SECURITY_PASSWORD` on the `openelis-analyzer-bridge` service.

The bridge host is in the default SAN list so a single certificate covers it. For a
deployment on a **different** public host, add `bridge.<your-host>` to `LETSENCRYPT_DOMAINS`
and update `server_name` in `configs/nginx/nginx.conf` to match.

## Verification checklist

After issuance and `docker compose ... --force-recreate proxy` with `compose.letsencrypt.yaml`:

```bash
curl -I "http://madagascar.openelis-global.org"
curl -I "http://mgtest.openelis-global.org"
curl -v "https://madagascar.openelis-global.org/"
curl -v "https://mgtest.openelis-global.org/"
curl -sSf -X POST \
  'https://madagascar.openelis-global.org/api/OpenELIS-Global/ValidateLogin?apiCall=true' \
  -d 'loginName=admin&password=adminADMIN!'
# Bridge upload UI (Basic Auth = OE admin creds):
curl -I "https://bridge.mgtest.openelis-global.org/"                       # 301 -> /admin/upload/index.html
curl -u admin:adminADMIN! "https://bridge.mgtest.openelis-global.org/admin/upload/index.html"   # 200
```

Expect HTTP→HTTPS redirect, a trusted certificate chain in the browser (no `-k`), and a successful login
response. On the same machine without public DNS, continue using `https://localhost/` with `-k`.
