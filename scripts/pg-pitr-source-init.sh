#!/bin/sh
# The disposable source has no published port and lives on an internal-only
# network. Permit the pinned PITR worker to use PostgreSQL's replication wire
# protocol without introducing a credential that could leak into artifacts.
set -eu

printf '\nhost replication all all trust\n' >>"$PGDATA/pg_hba.conf"
