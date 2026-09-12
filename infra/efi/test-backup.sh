#!/usr/bin/env bash
# Run only inside a disposable container with --network none.
set -euo pipefail
mkdir -p /tmp/efi-backup-fixture/bin
export PATH="/tmp/efi-backup-fixture/bin:$PATH"
export PGSERVICEFILE=/tmp/fixture PGSERVICE=fixture
export BACKUP_AGE_RECIPIENT=fixture BACKUP_BUCKET=fixture-backups
cat > /tmp/efi-backup-fixture/bin/pg_dump <<'EOF'
#!/bin/bash
if [[ "${FAIL_DUMP:-}" == 1 ]]; then exit 1; fi
printf 'synthetic database fixture'
EOF
cat > /tmp/efi-backup-fixture/bin/age <<'EOF'
#!/bin/bash
if [[ "${FAIL_AGE:-}" == 1 ]]; then exit 1; fi
cat
EOF
cat > /tmp/efi-backup-fixture/bin/aws <<'EOF'
#!/bin/bash
case "$1 $2" in
  's3api get-bucket-versioning')
    if [[ "$*" == *'--query Status'* ]]; then printf 'None'; else printf '{}'; fi ;;
  's3api list-objects-v2') printf '{"Contents":[]}' ;;
  's3 cp') test -s "$3"; touch /tmp/efi-backup-fixture/uploaded ;;
  *) exit 2 ;;
esac
EOF
chmod 700 /tmp/efi-backup-fixture/bin/*
bash /verification/backup.sh
test -f /tmp/efi-backup-fixture/uploaded
rm /tmp/efi-backup-fixture/uploaded
if FAIL_DUMP=1 bash /verification/backup.sh; then echo 'Unexpected dump success' >&2; exit 1; fi
test ! -f /tmp/efi-backup-fixture/uploaded
if FAIL_AGE=1 bash /verification/backup.sh; then echo 'Unexpected encryption success' >&2; exit 1; fi
test ! -f /tmp/efi-backup-fixture/uploaded
test -z "$(find /tmp -maxdepth 1 -name 'ciframais-backup.*.age' -print)"
echo 'PASS backup pipeline: upload only after successful dump/encryption; temporary files removed on success/failure'
