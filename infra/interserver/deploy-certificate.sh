#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $EUID -ne 0 ]]; then
  printf '%s\n' 'Execute com sudo.' >&2
  exit 1
fi
lineage=/etc/letsencrypt/live/ciframais-api
# Certbot calls directory hooks for all certificates on this host.
if [[ "${RENEWED_LINEAGE:-$lineage}" != "$lineage" ]]; then
  exit 0
fi
tls_dir=/opt/ciframais/secrets/tls
openssl x509 -in "$lineage/fullchain.pem" -noout -checkend 86400
openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost api.ciframais.com.br
openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost efi-webhooks.ciframais.com.br
cert_public_key="$(openssl x509 -in "$lineage/fullchain.pem" -pubkey -noout | openssl sha256)"
private_public_key="$(openssl pkey -in "$lineage/privkey.pem" -pubout | openssl sha256)"
if [[ "$cert_public_key" != "$private_public_key" ]]; then
  printf '%s\n' 'Certificado e chave privada nao correspondem.' >&2
  exit 1
fi

install -d -m 700 "$tls_dir"
for prefix in api efi; do
  install -m 600 "$lineage/fullchain.pem" "$tls_dir/$prefix-fullchain.pem"
  install -m 600 "$lineage/privkey.pem" "$tls_dir/$prefix-key.pem"
done

# Resolve the running container by labels, without executing a script from
# the deploy user's writable checkout inside this root-owned renewal hook.
containers="$(docker ps --filter label=com.docker.compose.project=ciframais \
  --filter label=com.docker.compose.service=nginx --filter status=running \
  --format '{{.ID}}')"
while IFS= read -r container_id; do
  [[ -n "$container_id" ]] || continue
  docker exec "$container_id" nginx -t
  docker exec "$container_id" nginx -s reload
done <<< "$containers"
printf '%s\n' 'Certificados instalados; Nginx recarregado se estiver em execucao.'
