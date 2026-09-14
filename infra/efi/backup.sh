#!/usr/bin/env bash
# Host-only daily backup. Credentials are supplied by the root-only environment file.
set -euo pipefail
umask 077
: "${PGSERVICEFILE:?Set a root-only PostgreSQL service file}"
: "${PGSERVICE:?Set the database service name}"
: "${BACKUP_AGE_RECIPIENT:?Set an age public recipient; keep the private key off this host}"
: "${BACKUP_BUCKET:?Set a dedicated unversioned backup bucket}"
: "${AWS_REGION:=sa-east-1}"
export AWS_REGION
command -v pg_dump >/dev/null
command -v age >/dev/null
command -v aws >/dev/null
command -v node >/dev/null
# Versioning can retain deleted credentials beyond the configured deadline.
versioning=$(aws s3api get-bucket-versioning --bucket "$BACKUP_BUCKET" --query Status --output text)
[[ "$versioning" == "None" || "$versioning" == "" ]] || { echo 'Backup bucket must never have versioning enabled.' >&2; exit 1; }
node "$(dirname "$0")/expire-backups.cjs" --apply
backup_file=$(mktemp --suffix=.age /tmp/ciframais-backup.XXXXXXXX)
trap 'rm -f -- "$backup_file"' EXIT
pg_dump --format=custom --no-owner --no-acl | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$backup_file"
[[ -s "$backup_file" ]]
backup_key="ciframais/database/$(date -u +%Y-%m-%dT%H-%M-%SZ).dump.age"
aws s3 cp "$backup_file" "s3://$BACKUP_BUCKET/$backup_key" --sse AES256 --only-show-errors
echo 'Encrypted database backup and retention completed.'
