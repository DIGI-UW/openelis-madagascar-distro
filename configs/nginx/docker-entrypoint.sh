#!/bin/sh
set -e

# Symlink Let's Encrypt material into the paths nginx expects, or wait for certgen self-signed.
# Mirrors OpenELIS-Global-2 nginx-proxy/docker-entrypoint.sh

CERT_NAME="${LETSENCRYPT_CERT_NAME:-${LETSENCRYPT_PRIMARY_DOMAIN:-${LETSENCRYPT_DOMAIN:-madagascar.openelis-global.org}}}"

LETSENCRYPT_CERT="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"
LETSENCRYPT_KEY="/etc/letsencrypt/live/${CERT_NAME}/privkey.pem"

NGINX_CERT="/etc/nginx/certs/apache-selfsigned.crt"
NGINX_KEY="/etc/nginx/keys/apache-selfsigned.key"

mkdir -p "$(dirname "$NGINX_CERT")" "$(dirname "$NGINX_KEY")"

file_exists() {
    [ -f "$1" ] && [ ! -L "$1" ] || ([ -L "$1" ] && [ -e "$1" ])
}

if file_exists "$LETSENCRYPT_CERT" && file_exists "$LETSENCRYPT_KEY"; then
    echo "✓ Let's Encrypt certificates found for ${CERT_NAME}"
    echo "Creating symlinks to Let's Encrypt certificates..."
    rm -f "$NGINX_CERT" "$NGINX_KEY"
    ln -sf "$LETSENCRYPT_CERT" "$NGINX_CERT"
    ln -sf "$LETSENCRYPT_KEY" "$NGINX_KEY"
    echo "✓ Symlinks created:"
    echo "  $NGINX_CERT -> $LETSENCRYPT_CERT"
    echo "  $NGINX_KEY -> $LETSENCRYPT_KEY"
elif file_exists "$NGINX_CERT" && file_exists "$NGINX_KEY"; then
    echo "✓ Using existing self-signed certificates from certs service"
else
    echo "⚠ Certificates not found. Waiting for certs service to generate them..."
    for i in $(seq 1 30); do
        if file_exists "$NGINX_CERT" && file_exists "$NGINX_KEY"; then
            echo "✓ Certificates found after ${i} seconds"
            break
        fi
        sleep 1
    done

    if ! file_exists "$NGINX_CERT" || ! file_exists "$NGINX_KEY"; then
        echo "⚠ Certificates still not found. Generating temporary self-signed certificate..."
        rm -f "$NGINX_CERT" "$NGINX_KEY"
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$NGINX_KEY" \
            -out "$NGINX_CERT" \
            -subj "/CN=localhost" \
            2>/dev/null || {
            echo "ERROR: Failed to generate temporary certificate and certificates not found"
            echo "Please ensure certs service is running or Let's Encrypt certificates are available"
            exit 1
        }
        echo "✓ Temporary self-signed certificate generated"
    fi
fi

if ! file_exists "$NGINX_CERT" || ! file_exists "$NGINX_KEY"; then
    echo "ERROR: Certificates not available at expected paths:"
    echo "  Certificate: $NGINX_CERT"
    echo "  Key: $NGINX_KEY"
    exit 1
fi

nginx -t
exec nginx -g "daemon off;"
