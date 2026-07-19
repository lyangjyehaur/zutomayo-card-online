# Source Deployment Recovery Drill

## Scope

This is the Public Beta recovery proof for the current source-built server4 deployment. It is not an immutable-image rollback or a database downgrade. The drill stops all staging application services, then reconstructs the exact clean `origin/master` candidate through the normal guarded deploy path and requires its schema, readiness, build ID, and smoke checks to pass.

The script refuses the documented production host and cannot run unless both staging guards are explicit.

## Preconditions

- Run from a clean local `master` exactly matching `origin/master`.
- Use a disposable or production-like staging host with the server4 Compose topology and private battle assets available locally.
- Confirm the release database has already been backed up and the restore fixture IDs are recorded.
- Keep an operator on the alert destination to record firing and resolved receipts.

## Execute

```bash
export DEPLOY_ENVIRONMENT=staging
export RECOVERY_CONFIRM=source-redeploy-staging
export SERVER_HOST=staging-host.example.com
export SERVER_PORT=22
export SERVER_USER=deploy
export REMOTE_DIR=/opt/zutomayo-card-online-staging
export COMPOSE_FILE=docker-compose.server4.yml
export RECOVERY_REPORT_DIR=artifacts/recovery
./scripts/server4-recovery-drill.sh
```

The drill records a raw log and `server4-recovery-<timestamp>.json`. Success means:

- the staging services were actually stopped;
- the remote source checkout equals the release SHA;
- the normal migration/schema checks accepted the current database;
- `/health`, `/ready`, build ID, and required private battle assets passed the existing deploy smoke.

If the deploy fails, the report is written with `status: failed` and staging may remain unavailable. Preserve the logs and fix forward; do not edit the report.

## Limitation

This proves reconstructability of the exact known-good Beta candidate. It does not claim arbitrary rollback across incompatible migrations. A previous commit is recoverable only after separately proving it accepts the current forward-only schema.
