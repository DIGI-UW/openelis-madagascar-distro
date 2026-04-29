#!/usr/bin/env bash
# Issue or renew Let's Encrypt certs (HTTP-01) for the distro reverse proxy.
# Prerequisites: openelisglobal-proxy running with ./volume/nginx/certbot mounted and
# nginx serving /.well-known/acme-challenge/ (see configs/nginx/nginx.conf).
#
# Usage:
#   export LETSENCRYPT_EMAIL='you@example.com'
#   ./scripts/generate-letsencrypt-certs.sh --dry-run    # quota-safe validation (no production issuance)
#   ./scripts/generate-letsencrypt-certs.sh              # new cert or renew if due
#
# Optional env:
#   LETSENCRYPT_DOMAINS       comma- or space-separated SAN list
#   LETSENCRYPT_DOMAIN        legacy single-domain fallback
#   LETSENCRYPT_PRIMARY_DOMAIN primary domain / default cert name
#   LETSENCRYPT_CERT_NAME     explicit cert lineage name under volume/letsencrypt/live/
#   LETSENCRYPT_STAGING=true  first-time certonly only: real staging CA (untrusted chain)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EMAIL="${LETSENCRYPT_EMAIL:-}"
STAGING="${LETSENCRYPT_STAGING:-false}"
DRY_RUN=false
FORCE_RENEW=false

usage() {
    sed -n '1,22p' "$0" | tail -n +2
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            ;;
        --staging)
            STAGING=true
            ;;
        --force-renew)
            FORCE_RENEW=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
    shift
done

mkdir -p ./volume/letsencrypt ./volume/nginx/certbot

DOMAINS_INPUT="${LETSENCRYPT_DOMAINS:-${LETSENCRYPT_DOMAIN:-mgtest.openelis-global.org}}"
DOMAINS_INPUT="${DOMAINS_INPUT//,/ }"
read -r -a RAW_DOMAINS <<<"$DOMAINS_INPUT"
if [ "${#RAW_DOMAINS[@]}" -eq 0 ]; then
    echo "ERROR: At least one hostname is required via LETSENCRYPT_DOMAINS or LETSENCRYPT_DOMAIN" >&2
    exit 1
fi

DOMAINS=()
for domain in "${RAW_DOMAINS[@]}"; do
    [ -n "$domain" ] || continue
    skip=false
    for seen in "${DOMAINS[@]}"; do
        if [ "$seen" = "$domain" ]; then
            skip=true
            break
        fi
    done
    [ "$skip" = true ] || DOMAINS+=("$domain")
done

PRIMARY_DOMAIN="${LETSENCRYPT_PRIMARY_DOMAIN:-${DOMAINS[0]}}"
CERT_NAME="${LETSENCRYPT_CERT_NAME:-$PRIMARY_DOMAIN}"

if [ -z "$EMAIL" ]; then
    echo "ERROR: LETSENCRYPT_EMAIL is required" >&2
    echo "Example: export LETSENCRYPT_EMAIL='you@example.com' && $0" >&2
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^openelisglobal-proxy$'; then
    echo "ERROR: Container openelisglobal-proxy must be running (ACME HTTP-01)." >&2
    echo "Start the stack first, e.g. docker compose -f compose.yaml up -d proxy" >&2
    exit 1
fi

CERT_PATH="./volume/letsencrypt/live/${CERT_NAME}/fullchain.pem"
RENEWAL_PATH="./volume/letsencrypt/renewal/${CERT_NAME}.conf"

DOMAIN_ARGS=()
for domain in "${DOMAINS[@]}"; do
    DOMAIN_ARGS+=(-d "$domain")
done

current_domains() {
    if [ ! -f "$CERT_PATH" ]; then
        return 1
    fi

    openssl x509 -in "$CERT_PATH" -noout -ext subjectAltName 2>/dev/null \
        | tr ',' '\n' \
        | sed -n 's/.*DNS:\([^[:space:]]*\).*/\1/p' \
        | sed '/^$/d' \
        | sort -u
}

desired_domains() {
    printf '%s\n' "${DOMAINS[@]}" | sed '/^$/d' | sort -u
}

domains_match=false
if [ -f "$CERT_PATH" ]; then
    if [ "$(current_domains)" = "$(desired_domains)" ]; then
        domains_match=true
    fi
fi

run_certbot() {
    docker run --rm \
        -v "$ROOT/volume/letsencrypt:/etc/letsencrypt" \
        -v "$ROOT/volume/nginx/certbot:/var/www/certbot" \
        certbot/certbot:latest "$@"
}

echo "Certificate name: ${CERT_NAME}"
echo "Requested hostnames: ${DOMAINS[*]}"

if [ -f "$CERT_PATH" ] && [ "$domains_match" = true ] && [ "$FORCE_RENEW" != true ]; then
    echo "Certificate exists: $CERT_PATH"
    RENEW_ARGS=(renew --non-interactive)
    if [ "$DRY_RUN" = true ]; then
        RENEW_ARGS=(renew --dry-run)
    fi
    echo "Running: certbot ${RENEW_ARGS[*]}"
    run_certbot "${RENEW_ARGS[@]}"
else
    if [ -f "$CERT_PATH" ] || [ -f "$RENEWAL_PATH" ]; then
        echo "Updating existing certificate lineage ${CERT_NAME}..."
    else
        echo "Requesting new certificate for ${CERT_NAME}..."
    fi
    CERTONLY_ARGS=(
        certonly
        --webroot
        --webroot-path=/var/www/certbot
        --cert-name "$CERT_NAME"
        --email "$EMAIL"
        --agree-tos
        --no-eff-email
        --non-interactive
    )
    if [ -f "$CERT_PATH" ] || [ -f "$RENEWAL_PATH" ]; then
        CERTONLY_ARGS+=(--expand)
    fi
    if [ "$FORCE_RENEW" = true ] && [ "$DRY_RUN" != true ]; then
        CERTONLY_ARGS+=(--force-renewal)
    fi
    CERTONLY_ARGS+=("${DOMAIN_ARGS[@]}")
    if [ "$DRY_RUN" = true ]; then
        CERTONLY_ARGS+=(--dry-run)
    fi
    if [ "$STAGING" = true ]; then
        CERTONLY_ARGS+=(--staging)
    fi
    echo "Running: certbot ${CERTONLY_ARGS[*]}"
    run_certbot "${CERTONLY_ARGS[@]}"
fi

echo ""
echo "Next: recreate or restart proxy with the Let's Encrypt overlay so nginx loads certs:"
echo "  docker compose -f compose.yaml -f compose.letsencrypt.yaml up -d --force-recreate proxy"
