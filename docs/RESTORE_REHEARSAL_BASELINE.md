# Restore Rehearsal Baseline

Status: Local runner validated; production-derived evidence pending  
Workstream: `LS-02`  
Evidence ID: `LS-EV-20260731-04`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: `704c1aa5f2b030011b681316421a74677b447f44` / `0.2.5`

This document records a local, isolated validation of the restore runner and evidence gate. It is not a production restore receipt and does not establish the service RPO or RTO.

## Local Rehearsal Result

An ephemeral PostgreSQL source container was migrated through `000047_knowledge_search_zero_results`, populated with synthetic release fixtures, dumped in PostgreSQL custom format, and restored into a second container without exposing the restore database port.

| Field                   | Result                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Runner result           | Passed                                                                             |
| Restore duration        | 10 seconds                                                                         |
| Dump SHA-256            | `d61bcbbbf8aac181007d4ed497fa0769882e4481387e3220c2925c92647e0816`                 |
| Restore image           | `postgres@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c` |
| Applied migration rows  | 41; expected migration and checksum matched                                        |
| Evidence gate           | Fixture, schema, legal-hold, and boardgame-state checks all passed                 |
| Repository verification | `npm run verify` exited 0; 199/199 files and 1,554/1,554 tests passed              |
| Raw local artifact      | System temporary storage only; not retained as official operational evidence       |

The seven attributable fixtures each restored exactly once:

| Fixture                   | Result |
| ------------------------- | -----: |
| Account                   |      1 |
| Deck                      |      1 |
| Canonical match history   |      1 |
| Leaderboard participant   |      1 |
| Match-linked chat message |      1 |
| Authored feedback post    |      1 |
| Boardgame match and seat  |      1 |

The restored database also reported zero unvalidated constraints, invalid relationship-outbox statuses, active-hold deletion violations, deleted-account social references, and malformed boardgame JSON payloads.

## Scope Limits

- The source data was synthetic, not production-derived.
- The local dump was intentionally unencrypted under `PG_BACKUP_ALLOW_UNENCRYPTED=true`; production evidence must use the configured age encryption and protected artifact store.
- The input timestamps were controlled to exercise the evidence calculation. The resulting local RPO and RTO values are runner checks, not service-level measurements.
- No login, deck UI, match-history UI, chat, or post-restore application smoke was run against this temporary database.
- The local artifact is not an immutable, access-controlled operational receipt.

`LS-02` therefore remains `Evidence pending`.

## Production Acceptance Steps

1. Create or identify the seven attributable fixtures in an approved staging dataset derived from the target production release.
2. Produce a fresh encrypted backup with its checksum, object version, completion timestamp, and immutable source release identity.
3. Restore it on an isolated runner using the pinned PostgreSQL image and the exact fixture and migration identifiers documented in [`database-restore.md`](runbooks/database-restore.md).
4. Run the schema and evidence gates, then exercise account, deck, history, leaderboard, chat, feedback, and boardgame read paths against the restored database.
5. Store the redacted receipt in access-controlled operational storage, record measured RPO/RTO, and update the stabilization tracker only after operator review.
