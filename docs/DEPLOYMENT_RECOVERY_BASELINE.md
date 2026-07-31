# Deployment Recovery Baseline

Status: Local evidence controls validated; staging rehearsal pending  
Workstream: `LS-04`  
Evidence ID: `LS-EV-20260731-06`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: `704c1aa5f2b030011b681316421a74677b447f44` / `0.2.5`

This document records local validation of the source-recovery runner, structured smoke receipt, and operational evidence gate. It is not a staging deployment receipt and does not prove that an older release can run against the current forward-only schema.

## Local Controls

| Control                   | Result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| Environment guard         | Staging only; documented production host refused                     |
| Release identity          | Clean local `master` must exactly equal `origin/master`              |
| Dataset identity          | Explicit SHA-256 is written to and read back from release env        |
| Graceful stop             | `game`, `api`, and `platform` must stop before reconstruction starts |
| Backup evidence           | Deploy-created PostgreSQL dump and SHA-256 are reverified            |
| Schema evidence           | Migration identity/checksum recorded; schema gate rerun after deploy |
| Post-deploy evidence      | Health/readiness, build ID, application smoke, and assets recorded   |
| Player impact             | Independent observer must account for every controlled active match  |
| Artifact integrity        | Raw log, smoke receipt, and match-impact receipt are hashed          |
| Operational evidence gate | Missing or inconsistent release, data, impact, or check fields fail  |
| Repository verification   | `npm run verify` passed; 199/199 files and 1,555/1,555 tests passed  |

The smoke command now emits a mode-`0600` JSON receipt even when a check fails. The recovery report consumes that receipt instead of setting every check from the deploy process exit code. A successful report therefore requires separate evidence for service stop, deploy completion, backup integrity, source checkout, schema compatibility, health/readiness, build identity, battle assets, application smoke, and controlled WebSocket/match outcome.

## Recovery Semantics

The current server4 Beta deployer builds the clean `origin/master` source on the host. It has no immutable previous-release selector and most migrations are forward-only. The locally prepared drill therefore proves only:

> The exact known-good release and dataset can be reconstructed through the normal guarded deployment path after a graceful application stop.

It does not prove arbitrary rollback to the previous commit. That stronger claim requires immutable release artifacts plus an explicit compatibility check showing that the previous runtime accepts the current database schema.

## Scope Limits

- No staging or production host was contacted during this local implementation.
- No application services were stopped and no real player session was interrupted.
- No measured recovery duration, user impact, backup identity, smoke receipt, or match outcome exists yet.
- The independent controlled-match observer remains an operator-run input; the recovery gate validates its completeness and release binding.
- Production remains outside this script's allowed target set.

`LS-04` therefore remains `Evidence pending`.

## Staging Acceptance Steps

1. Deploy a production-like staging topology from a clean `master` and bind the card-dataset evidence SHA-256.
2. Start at least one controlled authenticated match and a separate observer that records completed, reconnected, and failed outcomes.
3. Run [`server4-recovery-drill.sh`](../scripts/server4-recovery-drill.sh) using [`deployment-recovery.md`](runbooks/deployment-recovery.md).
4. Confirm the generated report is `passed`, recovery is within 1,800 seconds, every controlled match is accounted for, and manual intervention is recorded.
5. Archive the raw log, smoke receipt, match-impact receipt, and recovery report in access-controlled operational storage.
6. Combine the report with restore and alert evidence through `npm run release:operational-evidence:hardening`, then obtain operator review.
