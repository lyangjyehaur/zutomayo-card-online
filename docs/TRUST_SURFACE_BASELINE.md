# Trust Surface Baseline

Status: Local evidence controls validated; production-like rehearsal pending  
Workstream: `LS-10`  
Evidence ID: `LS-EV-20260731-08`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: `704c1aa5f2b030011b681316421a74677b447f44` / `0.2.5`

This document records local validation of the public trust-surface and account-deletion evidence contract. It is not a mailbox receipt, legal opinion, or staging execution receipt. No staging or production endpoint was contacted while preparing it.

## Existing Trust Surface

| Surface                    | Repository implementation                                                               |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Operator and contact       | Public operator name and `contact@mail.zutomayocard.online`                             |
| Public policies            | `/legal`, `/legal/privacy`, `/legal/terms`, and `/legal/contact` before authentication  |
| Retention                  | Published periods backed by `DATA_RETENTION.md` and the retention worker                |
| Account rights             | Authenticated Profile export and password-confirmed account deletion                    |
| Moderation and appeal      | Chat and deck-share reports, admin review, sanctions, blocks, and email appeal guidance |
| Rightsholder handling      | Recorded fan-work position and reversible takedown runbook                              |
| Authenticated policy entry | Privacy, Terms, and Contact actions in Profile                                          |

These implementations remain subject to owner and legal review. Engineering validation does not determine whether the published fan-work position is legally sufficient.

## Staging Evidence Contract

`npm run e2e:trust-staging` creates a new local-auth test account and requires one retry-free Chromium journey with ten independent markers:

1. All four public policy routes are reachable without login.
2. The operator and exact mailto contact are visible.
3. Retention and deletion behavior are published.
4. Moderation appeal instructions are published.
5. Rightsholder notice and takedown handling are published.
6. Authenticated Profile links back to Privacy, Terms, and Contact.
7. Account export downloads valid JSON containing the synthetic account but no password or token fields.
8. The synthetic account is deleted through the visible Profile confirmation flow.
9. Its previous session can no longer read Profile.
10. Login cannot restore the deleted identity after any auth rate-limit cooldown.

The runner refuses the known production hostname and any configured `PRODUCTION_HOSTNAME`. It is bound to the full release SHA, five immutable image references, migration checksum, dataset SHA-256, provenance, and hashed Playwright artifacts. The release gate cross-checks migration and dataset identity and blocks on any missing result.

## Local Verification

| Check                                                       | Result                      |
| ----------------------------------------------------------- | --------------------------- |
| Trust, release-gate, policy, and operational-contract tests | 45/45 tests passed          |
| Full unit/coverage suite                                    | 1,560/1,560 tests passed    |
| App and script TypeScript checks                            | Passed                      |
| Playwright collection                                       | One Chromium test collected |
| Repository verification                                     | Passed, including PWA build |

## Scope Limits

- The public routes and account flow have not yet been exercised against production-like staging.
- No controlled mailbox delivery or acknowledgment receipt exists in this evidence set.
- No legal or rights-holder approval was inferred from code or tests.
- Production retention remains unproven while `LS-RISK-05` is open.
- The test deletes only the synthetic account created in the same journey; it does not use an existing player account.

`LS-10` therefore remains `Evidence pending`.

## Acceptance Steps

1. Generate card-dataset evidence and deploy the exact immutable release to production-like staging.
2. Configure the staging URLs, `PRODUCTION_HOSTNAME`, release manifest, dataset SHA-256, and isolated local-auth E2E password.
3. Run `npm run e2e:trust-staging -- --output .release-evidence/staging/trust-surface.json`.
4. Confirm all ten markers, zero skips/failures/flakes, account export, deletion, session revocation, and deleted-login rejection.
5. Run the combined release gate and archive its hashed artifacts in access-controlled storage.
6. Separately send one controlled mailbox message, record redacted delivery/acknowledgment timestamps and assigned operator, and complete Product/Operator review.
