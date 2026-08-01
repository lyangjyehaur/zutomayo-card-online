# Source Deployment Recovery Drill

## Scope

This is the Public Beta recovery proof for the current source-built server4 deployment. It is not an immutable-image rollback or a database downgrade. The drill gracefully stops all staging application services, then reconstructs the exact clean `origin/master` candidate through the normal guarded deploy path and independently records the backup, schema, readiness, build ID, battle assets, application smoke, and controlled-match outcome.

The script refuses the documented production host and cannot run unless both staging guards are explicit.

## Preconditions

- Run from a clean local `master` exactly matching `origin/master`.
- Use a disposable or production-like staging host with the server4 Compose topology and private battle assets available locally.
- Obtain the exact card `datasetSha256` from the staging card-dataset evidence for this release.
- Start a controlled authenticated match and an independent observer that writes the match-impact JSON after shutdown/reconnect behavior is known.
- Confirm the release database restore fixture IDs are recorded. The normal deploy creates and verifies a new pre-deploy backup during this drill.
- Keep an operator on the alert destination to record firing and resolved receipts.

The observer output must be written to the path in `RECOVERY_MATCH_IMPACT_REPORT` while the drill is running. It must use this schema and account for every active controlled match:

```json
{
  "schemaVersion": 1,
  "releaseSha": "<40-character origin/master SHA>",
  "impact": {
    "activeMatchesAtStop": 1,
    "completedMatches": 0,
    "reconnectedMatches": 1,
    "failedMatches": 0,
    "manualInterventions": 0,
    "receiptUrl": "https://ops.example.com/evidence/recovery-match"
  }
}
```

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
export RECOVERY_DATASET_SHA256=<64-character card dataset SHA-256>
export RECOVERY_MATCH_IMPACT_REPORT=artifacts/recovery/match-impact.json
./scripts/server4-recovery-drill.sh
```

The drill records a raw log and `server4-recovery-<timestamp>.json`. Success means:

- the staging services were actually stopped;
- the normal deploy produced a non-empty PostgreSQL backup whose checksum was reverified;
- the remote source checkout equals the release SHA;
- the remote release environment binds the deployed frontend build to the recorded card dataset SHA-256;
- an independent post-deploy schema gate accepted the recorded migration and checksum;
- `/health`, `/ready`, build ID, application smoke, and required private battle assets passed and were written to a separate smoke receipt;
- every controlled active match is recorded as completed, reconnected, or failed, with manual-intervention count and an HTTPS evidence link;
- the raw log, smoke receipt, and match-impact receipt are bound to the recovery report by SHA-256.

If the deploy fails, the report is written with `status: failed` and staging may remain unavailable. Preserve the logs and fix forward; do not edit the report.

## Limitation

This proves reconstructability of the exact known-good Beta candidate. It does not claim arbitrary rollback across incompatible migrations. A previous commit is recoverable only after separately proving it accepts the current forward-only schema. Until immutable release artifacts and previous-release compatibility are rehearsed, describe this capability as exact-release reconstruction, not rollback.
