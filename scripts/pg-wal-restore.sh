#!/usr/bin/env bash
# PostgreSQL restore_command target:
#   restore_command = '/opt/zutomayo/scripts/pg-wal-restore.sh %f %p'
set -euo pipefail
umask 077

wal_name="${1:-}"
destination="${2:-}"
offsite_uri="${PG_WAL_OFFSITE_URI:-}"
identity_file="${PG_BACKUP_AGE_IDENTITY_FILE:-}"

[[ "$wal_name" =~ ^[0-9A-Fa-f]{24}(\.[A-Za-z0-9._-]+)?$ ]] || exit 1
[[ -n "$destination" && "$offsite_uri" == s3://* && -r "$identity_file" ]] || exit 1
command -v aws >/dev/null 2>&1 || exit 1
command -v age >/dev/null 2>&1 || exit 1

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pg-wal-restore.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
remote_prefix="${offsite_uri%/}"
encrypted="$work_dir/${wal_name}.age"
checksum_file="${encrypted}.sha256"
aws s3 cp --only-show-errors "$remote_prefix/${wal_name}.age" "$encrypted"
aws s3 cp --only-show-errors "$remote_prefix/${wal_name}.age.sha256" "$checksum_file"
expected="$(awk 'NR == 1 {print $1}' "$checksum_file")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$encrypted" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$encrypted" | awk '{print $1}')"
fi
[[ -n "$expected" && "$actual" == "$expected" ]] || exit 1

mkdir -p "$(dirname "$destination")"
age --decrypt --identity "$identity_file" --output "$destination" "$encrypted"
