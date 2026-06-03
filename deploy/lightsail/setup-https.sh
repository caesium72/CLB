#!/usr/bin/env bash
# Demo TLS via nip.io (static IP → <ip>.nip.io). Run: sudo bash deploy/lightsail/setup-https.sh
set -euo pipefail

LIGHTSAIL_IP="${LIGHTSAIL_IP:-18.142.200.48}"
NIP_HOST="${NIP_HOST:-${LIGHTSAIL_IP}.nip.io}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_NAME="clb-acel-demo"
NGINX_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"
CERTBOT_WEBROOT="/var/www/certbot"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

apt-get update
apt-get install -y nginx certbot
mkdir -p "$CERTBOT_WEBROOT"

cat >"$NGINX_AVAILABLE" <<EOF
server {
    listen 80;
    server_name ${NIP_HOST};
    location /.well-known/acme-challenge/ { root ${CERTBOT_WEBROOT}; }
    location / { return 200 'obtaining certificate'; add_header Content-Type text/plain; }
}
EOF

ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot certonly --webroot -w "$CERTBOT_WEBROOT" -d "$NIP_HOST" \
  --non-interactive --agree-tos --register-unsafely-without-email

sed "s/DEMO_NIP_HOST/${NIP_HOST}/g" "$REPO_ROOT/deploy/lightsail/nginx.conf" >"$NGINX_AVAILABLE"
nginx -t && systemctl reload nginx

echo "HTTPS ready: https://${NIP_HOST}/orchestrator/health"
echo "Anvil RPC:   https://${NIP_HOST}/rpc  (HTTP: http://${LIGHTSAIL_IP}:8545)"
echo "Vercel env:  deploy/lightsail/vercel.env.example"
