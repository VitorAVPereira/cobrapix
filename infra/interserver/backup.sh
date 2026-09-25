#!/usr/bin/env bash
# Backup of PostgreSQL (custom format) and the encrypted WhatsApp attachments.
# Usage: sudo bash infra/interserver/backup.sh [/var/backups/ciframais]
# Keys are NOT copied here: keep a protected copy of /opt/ciframais/secrets/api.env.
set -euo pipefail
umask 077

if [[ $EUID -ne 0 ]]; then
  printf '%s\n' 'Execute com sudo: sudo bash infra/interserver/backup.sh' >&2
  exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
destination="${1:-/var/backups/ciframais}"
media_root=/var/lib/ciframais
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$destination/$stamp"

install -d -m 700 "$destination" "$target"
# Dump first: files added afterwards are harmless (no row), and every row in the
# dump already has its file on disk.
bash "$script_dir/compose.sh" exec -T postgres \
  pg_dump -U postgres -d ciframais --format=custom --no-owner >"$target/ciframais.dump"
if [[ -d "$media_root/communication-media" ]]; then
  tar -C "$media_root" -czf "$target/communication-media.tgz" communication-media
fi
(cd "$target" && sha256sum -- * >SHA256SUMS)
# Validates the dump without restoring it.
bash "$script_dir/compose.sh" exec -T postgres pg_restore --list <"$target/ciframais.dump" >/dev/null

printf 'Backup criado em %s\n' "$target"
printf '%s\n' \
  'Copie esta pasta para fora da VPS junto com uma copia protegida de /opt/ciframais/secrets/api.env.' \
  'Sem as chaves de api.env, credenciais do banco e anexos nao podem ser lidos.'
