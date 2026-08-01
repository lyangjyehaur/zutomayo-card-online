# Player And Product Evidence Baseline

Status: Evidence pending  
Workstream: `LS-09`  
Evidence ID: `LS-EV-20260731-11`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: local `704c1aa` plus task-scoped changes / `0.2.5`

This document defines the privacy-preserving evidence needed to choose the next player-facing work. Instrumentation and a fail-closed evidence gate exist locally; no production analytics query or moderated-player receipt was collected in this repository task.

## Current Evidence

The existing Umami event contract covers:

| Required baseline   | Existing events or source                                                       | Current status                                                                      |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Home to first match | Entry route, `F_Queue_Match`, `F_Match_Start`, `F_Match_Complete`               | Instrumented; production saved query and first-match cohort receipt pending         |
| Queue to match      | `F_Queue_Start`, `F_Queue_Checkpoint`, `F_Queue_Cancel`, `F_Queue_Match`        | Instrumented; production receipt pending                                            |
| Match completion    | `F_Match_Start`, `F_Match_Complete`                                             | Instrumented; production aggregate currently shows zero canonical completed matches |
| Reconnect           | `F_Match_Connection_Attempt`, `F_Match_Connection_Success`, `F_Match_Reconnect` | Instrumented; production receipt pending                                            |
| Tutorial completion | `F_Tutorial_Start`, first action, exit, and complete events                     | Instrumented; production receipt pending                                            |
| Returning players   | Aggregate Umami visitor/session cohorts                                         | Source exists; a release-bound saved query is pending                               |

The 2026-07-31 production database snapshot recorded 22 accounts, 16 decks, 69 match-participant records, 83 room-participant records, and zero canonical completed matches. These values confirm limited use but cannot establish conversion, success rate, time-to-value, reconnect reliability, or return rate.

Earlier tutorial remediation froze implementation only after local behavior and visual checks. Its moderated first-time-player timing and comprehension evidence also remains pending and may be supplied through this workstream.

## Evidence Gate

[`playerProductEvidenceGate.ts`](../scripts/playerProductEvidenceGate.ts) validates one JSON evidence packet. It requires:

1. A full release SHA and dataset SHA-256 matching the command-line expectations.
2. At least seven days under one `buildId` and card dataset.
3. All six required journey measurements, including explicit zero-event measurements.
4. HTTPS receipts for each saved aggregate query.
5. At least five de-identified observations or equivalent structured-feedback records.
6. Coverage of tutorial, queue, match, and reconnect tasks across the observations.
7. Product problems referenced by observation codes, with frequency equal to the number of supporting observations.
8. Problems ordered by `impact * frequency` so prioritization can be reproduced.

The gate rejects unknown observation fields, non-HTTPS receipts, raw contact/identifier patterns in issue summaries, under-seven-day windows, cross-release data, missing journey categories, unattributed issues, and priority-order mismatches.

Run it only against an access-controlled packet. Do not commit the raw packet or private receipt URLs:

```bash
npm run evidence:player-product -- \
  --input /secure/path/player-product-evidence.json \
  --release-sha "$RELEASE_SHA" \
  --dataset-sha256 "$CARD_DATASET_SHA256" \
  --output .release-evidence/player-product-summary.json
```

The generated summary contains only journey rates, observation count, ranked issue IDs, and release identity. `.release-evidence/` remains untracked.

## Packet Shape

The access-controlled input uses this structure. Values below are illustrative, not evidence:

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "releaseSha": "<40 hex>",
  "buildId": "<same 40 hex>",
  "datasetSha256": "<64 hex>",
  "window": {
    "startedAt": "2026-08-01T00:00:00.000Z",
    "finishedAt": "2026-08-08T00:00:00.000Z"
  },
  "journeys": {
    "homeToFirstMatch": {
      "population": 0,
      "outcomes": 0,
      "medianSeconds": null,
      "p95Seconds": null,
      "receiptUrl": "https://private.example/receipt"
    }
  },
  "observationMethod": "moderated-sessions",
  "observations": [],
  "issues": []
}
```

The real packet must include all six journey keys: `homeToFirstMatch`, `queueToMatch`, `matchCompletion`, `reconnect`, `tutorialCompletion`, and `returningPlayers`.

Each observation contains only:

- `id`: a local `obs-*` code with no account or participant identity.
- `observedAt`: an exact timestamp inside the evidence window.
- `participantType`: `first-time`, `returning`, or `representative`.
- `viewportClass`: `mobile`, `tablet`, or `desktop`.
- `taskResults`: structured `completed`, `blocked`, or `not-observed` values.
- `problemIds`: `PP-NNN` references.
- `receiptUrl`: an access-controlled research receipt.

Do not put names, nicknames, email addresses, user/account IDs, room/match/invite/deck IDs, chat content, recordings, or free-form participant statements in the Git-tracked baseline or generated summary.

## Completion Criteria

`LS-09` remains `Evidence pending` until Product/Frontend review a passing packet and record:

- the six release-bound rates and timing distributions;
- at least five observation records or approved equivalent feedback;
- the ranked problem list with impact and frequency;
- which changes enter the next cycle and which are explicitly deferred;
- links to access-controlled analytics and research receipts.

Instrumentation presence and synthetic tests are not substitutes for player evidence.

## Local Verification

| Check                                | Result                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Player/product gate characterization | 5/5 tests passed                                                                      |
| Script TypeScript check              | Passed                                                                                |
| Focused ESLint                       | Passed                                                                                |
| Full repository verification         | Passed with 204 test files, 1,581 tests, coverage gates, and the production/PWA build |

## Next Actions

1. Verify production Umami receives every allowlisted funnel event for the target release and dataset.
2. Save the six aggregate queries and open the seven-day window.
3. Schedule at least five de-identified moderated sessions, including first-time and returning players where practical.
4. Run the gate, review the ranked problems, and update the stabilization tracker without copying raw research material into Git.
