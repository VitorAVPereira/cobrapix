#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -r /opt/ciframais/secrets/postgres.env ]]; then
  printf '%s\n' 'Execute primeiro: sudo bash infra/interserver/setup.sh' >&2
  exit 1
fi
exec docker compose --project-directory "$script_dir" \
  --env-file /opt/ciframais/secrets/postgres.env \
  -f "$script_dir/compose.yaml" "$@"
