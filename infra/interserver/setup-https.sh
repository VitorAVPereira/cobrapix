#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $EUID -ne 0 ]]; then
  printf '%s\n' 'Execute com sudo.' >&2
  exit 1
fi
case "${1:-}" in
  homologation) ca_filename=certificate-chain-homolog.crt ;;
  production) ca_filename=certificate-chain-prod.crt ;;
  *) printf '%s\n' 'Uso: sudo bash infra/interserver/setup-https.sh homologation|production' >&2; exit 1 ;;
esac
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
secrets_dir=/opt/ciframais/secrets
[[ -f "$secrets_dir/api.env" ]] || { printf '%s\n' 'Configuracao inicial ausente.' >&2; exit 1; }
# Exact match for the format written by setup.sh; do not source a secrets file.
grep -qx "EFI_ENV=$1" "$secrets_dir/api.env" || {
  printf '%s\n' 'EFI_ENV em api.env deve corresponder ao ambiente informado (sem aspas).' >&2
  exit 1
}
command -v curl >/dev/null
command -v openssl >/dev/null
command -v certbot >/dev/null

ca_temp="$(mktemp)"
trap 'rm -f -- "$ca_temp"' EXIT
# Official URLs: https://dev.efipay.com.br/docs/api-pix/webhooks/
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 60 \
  "https://certificados.efipay.com.br/webhooks/$ca_filename" -o "$ca_temp"
expected_hash="$(awk -v name="$ca_filename" '{sub(/\r$/, ""); if ($2 == name) print $1}' "$script_dir/efi-ca.sha256")"
[[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]] || { printf '%s\n' 'Fingerprint de referencia ausente.' >&2; exit 1; }
actual_hash="$(sha256sum "$ca_temp" | cut -d ' ' -f 1)"
[[ "$actual_hash" == "$expected_hash" ]] || {
  printf '%s\n' 'A cadeia Efi mudou. Verifique a origem e atualize a referencia antes de instalar.' >&2
  exit 1
}
openssl crl2pkcs7 -nocrl -certfile "$ca_temp" | openssl pkcs7 -print_certs -noout >/dev/null

install -d -m 700 "$secrets_dir/tls"
install -d -m 755 /var/www/ciframais-acme
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
if [[ -f "$secrets_dir/nginx.conf" && ! -e "$secrets_dir/nginx.conf.before-https" ]]; then
  install -m 600 "$secrets_dir/nginx.conf" "$secrets_dir/nginx.conf.before-https"
fi
install -m 600 "$ca_temp" "$secrets_dir/tls/efi-client-ca.pem"
install -m 600 "$script_dir/nginx.conf" "$secrets_dir/nginx.conf"
install -m 700 "$script_dir/deploy-certificate.sh" /etc/letsencrypt/renewal-hooks/deploy/ciframais
bash /etc/letsencrypt/renewal-hooks/deploy/ciframais
printf '%s\n' \
  'Arquivos HTTPS preparados. A API precisa estar saudavel antes de iniciar Nginx.' \
  'A renovacao ainda precisa ser reconfigurada para webroot e testada conforme HTTPS.md.'
