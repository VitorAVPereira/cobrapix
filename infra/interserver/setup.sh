#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $EUID -ne 0 ]]; then
  printf '%s\n' 'Execute com sudo: sudo bash infra/interserver/setup.sh' >&2
  exit 1
fi
command -v openssl >/dev/null
docker compose version
docker info >/dev/null
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
secrets_dir=/opt/ciframais/secrets

# Refuse to regenerate credentials. Changing these files alone would not
# change the password of a PostgreSQL role in an existing volume.
for filename in postgres.env api.env nginx.conf; do
  if [[ -e "$secrets_dir/$filename" || -L "$secrets_dir/$filename" ]]; then
    printf 'Arquivo ja existe; nada foi alterado: %s\n' "$secrets_dir/$filename" >&2
    exit 1
  fi
done
if docker volume inspect ciframais_postgres >/dev/null 2>&1; then
  printf '%s\n' 'Volume PostgreSQL existente. Recusando gerar novas credenciais.' >&2
  exit 1
fi

install -d -m 700 "$secrets_dir" "$secrets_dir/tls"
# UID 1000 is the node user inside the API image. Parent remains root-only.
install -d -m 750 -o 1000 -g 1000 "$secrets_dir/efi"
# Private attachment volume: writable only by the API user, never served by nginx.
install -d -m 755 /var/lib/ciframais
install -d -m 700 -o 1000 -g 1000 /var/lib/ciframais/communication-media

# Hex passwords are safe to embed in a PostgreSQL URL without percent encoding.
postgres_password="$(openssl rand -hex 32)"
app_password="$(openssl rand -hex 32)"
jwt_secret="$(openssl rand -hex 32)"
webhook_secret="$(openssl rand -hex 32)"
payment_key="$(openssl rand -hex 32)"
set -o noclobber
cat > "$secrets_dir/postgres.env" <<EOF
POSTGRES_PASSWORD=$postgres_password
APP_DB_PASSWORD=$app_password
EOF
cat > "$secrets_dir/api.env" <<EOF
NODE_ENV=production
JWT_SECRET=$jwt_secret
EFI_WEBHOOK_SECRET=$webhook_secret
PAYMENT_ACTIVE_KEY_VERSION=v1
PAYMENT_ENCRYPTION_KEYS='{"v1":"$payment_key"}'
EOF
cat "$script_dir/api.env.example" >> "$secrets_dir/api.env"
cat "$script_dir/../efi/nginx.conf" > "$secrets_dir/nginx.conf"
chmod 600 "$secrets_dir/postgres.env" "$secrets_dir/api.env" "$secrets_dir/nginx.conf"

printf '%s\n' \
  'Configuracao inicial criada em /opt/ciframais/secrets (sem exibir senhas).' \
  'API ainda precisa de dominios, certificados e credenciais reais.' \
  'Proximo passo: sudo bash infra/interserver/compose.sh up -d --wait postgres redis'
