# Public Beta Release Readiness Remediation Plan

Last updated: 2026-07-19

Owner: Tech Lead

Status: Active

Target: Public Beta go/no-go review after all P0 gates are closed

## Purpose

This document is the persistent source of truth for the Public Beta remediation work identified by the repository-wide release readiness review. It is intentionally limited to release blockers and high-impact first-session issues. It does not authorize broad feature work or architecture refactors.

Public Beta remains **No-Go** until every P0 item below is either complete with evidence or explicitly waived by the accountable owner. A legal or IP gate cannot be waived by engineering.

## Working Rules

- Freeze non-P0 feature work while P0 remediation is active.
- Tie every release result to one commit SHA, database migration version, and card dataset hash.
- Code and executable evidence take precedence over older audit documents.
- Update the status and evidence columns in this file in the same change that completes an item.
- Do not mark an item complete based only on configuration, unit tests, or a historical rehearsal.
- Before commit or push, run `npm run verify` from the repository root.

## Status Legend

| Status                     | Meaning                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| Not started                | No implementation or current-release evidence exists.                                           |
| In progress                | Implementation or validation is actively underway.                                              |
| External decision required | Engineering can prepare the product surface, but another accountable party must close the gate. |
| Verification pending       | Implementation exists; required release evidence is incomplete.                                 |
| Complete                   | Definition of done is met and current-release evidence is recorded.                             |

## P0 Tracker

| ID    | Workstream                                             | Status               | Primary owner                  | Estimate       | Dependency                     | Required evidence                                                   |
| ----- | ------------------------------------------------------ | -------------------- | ------------------------------ | -------------- | ------------------------------ | ------------------------------------------------------------------- |
| RR-01 | IP policy, Privacy, Terms, operator identity, contact  | Verification pending | Product / Operations           | 1 day evidence | Public mailbox delivery        | Policy record, route checks, deletion/contact rehearsal             |
| RR-02 | Tutorial phase correctness                             | Complete             | Frontend / Game UX             | 1-2 days       | None                           | Unit regression, tutorial E2E, desktop/mobile screenshots           |
| RR-03 | Tutorial first-action flow and completion coverage     | Verification pending | Frontend / Game UX / QA        | 3-5 days       | RR-02                          | First action <= 60 seconds, full-flow E2E, step funnel              |
| RR-04 | Quick Match bounded wait and fallback                  | Verification pending | Frontend / Platform            | 3-4 days       | Funnel event contract          | Timeout/fallback E2E, stale queue cleanup tests                     |
| RR-05 | Authenticated production-like multiplayer gate         | Verification pending | Backend / DevOps / QA          | 5-6 days       | Staging reverse-proxy topology | Zero skipped critical journeys, traces and server logs              |
| RR-06 | Exact-release card dataset audit and smoke gate        | Verification pending | Rules / Backend                | 2-3 days       | Release database snapshot      | Dataset hash, card/effect counts, audit and 20-card smoke output    |
| RR-07 | Release backup restore rehearsal                       | Verification pending | DevOps / Backend               | 1 day          | Release backup                 | RPO/RTO record and restored account/deck/history/leaderboard data   |
| RR-08 | First-session, tutorial, queue, and match funnel       | Verification pending | Product / Frontend / Backend   | 2-3 days       | Privacy-approved event schema  | Event contract tests and usable funnel dashboard/query              |
| RR-09 | Targeted mobile, performance, and battle feedback pass | Verification pending | Frontend / Game UX / QA        | 3-4 days       | Stable release candidate       | Low-end device results, responsive checks, performance measurements |
| RR-10 | Release candidate rehearsal and go/no-go               | Not started          | QA / Tech Lead / Product / Ops | 2 days         | RR-01 through RR-09            | Signed checklist tied to exact release commit and dataset           |

## Critical Path

1. Freeze the release candidate and record its commit, migration, and dataset identity.
2. Fix tutorial correctness before changing tutorial structure.
3. Implement the tutorial flow, Quick Match behavior, and funnel event contract.
4. Establish the authenticated staging topology before treating multiplayer E2E as release evidence.
5. Validate the exact card dataset, then deploy that exact candidate to staging.
6. Restore one release backup and verify player-visible persisted data.
7. Run the device/browser matrix and controlled multiplayer rehearsal.
8. Hold the go/no-go review. Do not add last-minute features.

## Definitions Of Done

### RR-01: Legal And Trust Surface

- The owner decision records the official fan-work guideline, public asset posture, non-commercial limits, remaining interpretation risk, takedown conditions, and triggers that reopen the decision.
- Privacy and Terms identify the operator, contact method, collected data, retention, subprocessors, deletion, moderation, and appeal paths.
- Privacy, Terms, and contact routes are reachable before login and from account settings on desktop and mobile.
- Account deletion and contact handling are rehearsed once.

### RR-02: Tutorial Phase Correctness

- `phaseInstruction` only shows game-over copy for a confirmed game-over state.
- Every setup and battle phase shown during tutorial has deliberate copy or intentionally renders no instruction.
- Unknown future phases fail safely instead of claiming the match ended.
- Regression tests cover the pre-janken tutorial state and actual game-over state.

### RR-03: Tutorial First-Action Flow

- The first meaningful player action occurs within three tutorial steps and 60 seconds in moderated testing.
- Mandatory onboarding is reduced to the minimum needed to complete the scripted match; deeper explanations are contextual or skippable.
- Full tutorial completion, skip, exit, and resume paths are automated at desktop and 390x844.
- Analytics records start, step view, first action, exit, and completion without collecting card or chat content unnecessarily.

### RR-04: Quick Match Bounded Wait

- The UI shows elapsed wait time and presents a decision point after 45 seconds.
- Players can continue waiting, cancel, or use the existing Custom Room and Invite paths.
- Disconnect, refresh, cancellation, duplicate tabs, and server TTL all clean stale queue entries.
- No client state can remain indefinitely in an unexitable matching state.

### RR-05: Authenticated Multiplayer Gate

- HTTPS, secure HttpOnly cookies, reverse proxy, WebSocket upgrade, Redis, Postgres, API, frontend, and Colyseus match production topology.
- Two real sessions complete login, deck selection, Quick Match, chat, disconnect/reconnect, result submission, and match history.
- Friend invite and spectator hidden-information behavior are included.
- Critical authenticated tests run once with zero conditional skips, failures, retries, or flakes. Five consecutive runs are production-hardening evidence.

### RR-06: Exact Card Dataset Gate

- Validation runs against the database snapshot intended for release, not the synthetic 90-card E2E seed.
- Evidence records commit SHA, dataset hash, total cards, translation counts, parsed effect counts, and failures.
- Rule audit, derived-effect audit, deck legality, preset deck size, serialization, Local/AI/Online match smoke, and representative effects pass.
- Any failure blocks deployment.

### RR-07: Operational Recovery

- A staging backup is restored and account, deck, match history, and leaderboard data are verified.
- Actual RPO and RTO are recorded against the Beta targets.
- Full alert-delivery, chaos, and source-deployment recovery rehearsals remain documented and executable but do not block the current Beta.

### RR-08: Release Funnel

- Events cover tutorial start/step/first action/exit/complete, queue start/checkpoint/cancel/match, and match start/reconnect/complete/first win.
- Events include locale, viewport class, entry route, queue duration, match mode, application version, and dataset hash where applicable.
- Chat content and unnecessary raw identifiers are excluded.
- Product can calculate home-to-first-match and first-match completion funnels.

### RR-09: Targeted Experience Pass

- A low-end Android device can complete a match without blocked actions, text overlap, or horizontal overflow.
- The 390x844 battle surface keeps hand, phase, life, cost, and primary action legible and stable.
- Initial load, battle entry, INP, long tasks, and card-image behavior are measured on slow network/device profiles.
- Any sound or haptic feedback remains optional and is never the only signal; mute and reduced-motion preferences are respected.

### RR-10: Go/No-Go

- `npm run verify`, exact-dataset gates, authenticated staging E2E, and the browser/device matrix pass against one release candidate.
- One release backup restore is current and tied to the candidate.
- A controlled 10-20 player rehearsal completes without a Critical or High first-match blocker.
- Product, Legal, Tech Lead, QA, and Operations record the final decision and known accepted risks.

## Verification Matrix

| Gate                      | Command or procedure                                   | Pass condition                                                     | Evidence location                                        |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Repository CI mirror      | `npm run verify`                                       | All formatting, lint, typecheck, unit, and build stages pass       | Passed for current worktree through `release:gate`       |
| Tutorial regression       | Targeted Vitest command plus `e2e/tutorial.spec.ts`    | Correct copy and full flow pass at desktop/mobile                  | Pending RR-02/RR-03                                      |
| Responsive UI             | Player responsive smoke suites plus device check       | No blocked controls, overflow, or overlap                          | Automated player surfaces pass; physical Android pending |
| Low-end web performance   | `npm run smoke:performance` against production preview | Initial load and warm battle entry remain within synthetic budgets | Automated profile passes; field Web Vitals pending       |
| Authenticated multiplayer | `npm run e2e:authenticated-staging`                    | One full two-player run with zero critical skips/failures/flakes   | Runner complete; external staging evidence pending       |
| Card rules                | Release DB rule audit and smoke commands               | Exact dataset passes with recorded hash/counts                     | Pending RR-06                                            |
| Security dependencies     | `npm audit --omit=dev`                                 | No unresolved production vulnerability beyond accepted policy      | Pending release candidate                                |
| Recovery                  | Release restore drill                                  | RPO/RTO met; account/deck/history/leaderboard round-trip passes    | Runner complete; external staging rehearsal pending      |
| Production hardening      | `npm run release:gate:hardening`                       | Chaos/load/canary/alerts/provider/recovery and five-run E2E pass   | Deferred until after Beta                                |

## Current Baseline

Recorded during the 2026-07-19 review and remediation:

- `npm run verify`: current worktree passes with 134 test files and 1069 tests; production PWA build passed.
- Docker Playwright suite: 36 passed, 2 skipped. The skipped coverage includes critical authenticated journeys.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- `npm run release:gate`: the `beta` profile runs all 12 local/configuration checks but exposes only three external blockers: exact card data, one complete authenticated multiplayer run, and one backup restore. `production-hardening` retains the other resilience and scale gates without blocking Beta.
- Server4 Beta intentionally keeps one migration role plus the existing shared `PG_APP_*` runtime role. Per-service and operations-role isolation remains implemented for the hardened staging/production path but is explicitly deferred from the current Beta critical path.
- Derived card effect audit: passed for the repository dataset exercised by that script.
- Docker rule audit uses 90 synthetic cards with only two tutorial-fixture effect lines; it is not accepted as release dataset evidence.
- Docker game smoke failed because the seeded preset deck contained 13 cards instead of 20.
- Historical deployment documentation records a 422-card, 267-effect-line rehearsal, but it is not tied to the current release candidate.
- The read-only production API preflight now passes against `https://battle.zutomayocard.online/api/`: 422 unique cards, 250 effect cards, 267/267 parsed effect lines, 1688 verified derived translation rows, four legal preset decks, valid game config, deterministic serialization, Unicode integrity, and the full game smoke. Its dataset SHA-256 is `c2b55e2a56ad45ceff52c44d1de380b19cefb0b00536f94f92d1ff3d60a8b423`; this is useful preflight evidence but not accepted as the release DB artifact.
- Read-only production checks returned HTTP 200 for the site and health/readiness endpoints. `/api/version` and `/api/app-version` reported `0.2.1` at commit `124a911311ba8c3b8d893460fc8cce73ef088481`.
- A browser with the previous `0.2.0` PWA shell received the update prompt and successfully upgraded to `0.2.1`; no console errors were recorded. While server version data was loading, the prompt rendered the misleading fallback `尚未建立`, which is now changed to an explicit checking state.
- The current 360x800 landing page has no horizontal overflow and its primary controls meet the 44px touch-target baseline. This does not replace RR-09's physical low-end Android full-match requirement.
- Production loads the configured analytics script from `u.ztmy.art`, but no authenticated event receipt or saved funnel query was available, so RR-08 remains verification pending.
- Production About exposed a valid QQ invite plus placeholder Telegram and Discord roots. Placeholder community links are now hidden. Privacy, Terms, operator identity, contact, and the IP policy decision are implemented in the remediation worktree but are not yet deployed or mailbox-rehearsed.

## Remaining External Inputs

No additional local implementation is currently known to block the evidence runs below. Public Beta remains **No-Go** because the workspace does not have the external authority, infrastructure, release data, or human participants required to close them:

| Gate  | Exact external input still required                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-01 | Confirm `contact@mail.zutomayocard.online` receives mail, rehearse one redacted rightsholder/privacy request, and record owner approval of the published copy. |
| RR-03 | Moderated first-time-player evidence showing the first meaningful tutorial action within 60 seconds.                                                           |
| RR-04 | Authenticated staging sessions for timeout, refresh, cancellation, and duplicate-tab queue cleanup evidence.                                                   |
| RR-05 | Production-like staging URL and credentials/topology variables for one complete retry-free authenticated two-player run.                                       |
| RR-06 | The clean 422-card release database snapshot and release provenance variables.                                                                                 |
| RR-07 | Supply one release backup and an isolated restore target; verify account, deck, match history, leaderboard, RPO, and RTO.                                      |
| RR-08 | Production Umami access to confirm allowlisted receipts and save the documented funnel query.                                                                  |
| RR-09 | A physical low-end Android device and a complete human-played match.                                                                                           |
| RR-10 | 10-20 controlled players plus Product, Legal, QA, Tech Lead, and Operations sign-off against one immutable release candidate.                                  |

## Execution Log

| Date       | ID    | Change                                                                                                                                                                                                                                                                                                                                                                                               | Verification                                                                                                                                                                                                                                                                                                                                                                                                    | Result / follow-up                                                                                                                                                                                                                                                                                  |
| ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-19 | Plan  | Created persistent remediation tracker from repository-wide review                                                                                                                                                                                                                                                                                                                                   | Document review                                                                                                                                                                                                                                                                                                                                                                                                 | RR-02 started; Public Beta remains No-Go                                                                                                                                                                                                                                                            |
| 2026-07-19 | RR-02 | Added explicit setup/game-over phase instructions and removed the game-over fallback                                                                                                                                                                                                                                                                                                                 | Targeted Vitest: 3 passed; typecheck, ESLint, Prettier, and production build passed; Docker Tutorial Playwright: 6 passed                                                                                                                                                                                                                                                                                       | Complete; RR-03 started                                                                                                                                                                                                                                                                             |
| 2026-07-19 | RR-03 | Reduced the tutorial from 29 to 15 steps, moved the first action to step 2, fixed placement races and mobile Sheet blocking, aligned the E2E seed with the fixed scenario, and added full completion coverage                                                                                                                                                                                        | Targeted Vitest: 9 passed; typechecks and ESLint passed; Tutorial Playwright: Chromium + Android 14 passed                                                                                                                                                                                                                                                                                                      | Implementation complete; moderated <=60-second validation and funnel evidence remain pending                                                                                                                                                                                                        |
| 2026-07-19 | RR-04 | Added elapsed queue time, a 45-second fallback decision with Custom Room and Friend Invite paths, and a configurable 120-second server hard timeout with cancellation-safe cleanup                                                                                                                                                                                                                   | Targeted Quick Match/platform Vitest: 39 passed; full `npm run verify`: 127 files and 1030 tests passed; production build passed                                                                                                                                                                                                                                                                                | Implementation complete; authenticated staging fallback E2E and duplicate-tab/refresh evidence remain pending                                                                                                                                                                                       |
| 2026-07-19 | RR-06 | Added a fail-closed exact-dataset gate that binds cards, translations, presets, config, migration, commit, rule audit, and game smoke to one deterministic SHA-256; made its signed staging evidence mandatory in `release:gate`                                                                                                                                                                     | Targeted Vitest: 13 passed; full `npm run verify`: 128 files and 1034 tests passed; production build passed                                                                                                                                                                                                                                                                                                     | Implementation complete; run it against the clean 422-card release database and attach staging evidence                                                                                                                                                                                             |
| 2026-07-19 | RR-06 | Added a read-only public API preflight and repaired stale game-smoke assumptions after move wrappers, Area Enchant placement, and the 18-position Chronos mapping changed; added fail-closed replacement-character/control-byte detection to the formal dataset gate                                                                                                                                 | Production API preflight passed: 422 cards, 267/267 parsed effect lines, 1688 verified translations, four presets, valid config, deterministic dataset SHA-256 `c2b55e2a56ad45ceff52c44d1de380b19cefb0b00536f94f92d1ff3d60a8b423`, and all game-smoke assertions                                                                                                                                                | Player-visible card data is currently healthy. RR-06 remains open only because formal evidence must come from a clean release commit and the exact release database with migration/provenance binding                                                                                               |
| 2026-07-19 | RR-08 | Added a privacy-allowlisted Umami funnel contract and instrumented Tutorial, Quick Match, online start/reconnect/completion, and first win; bound events to release/dataset/locale/viewport/entry-route context and documented Beta queries                                                                                                                                                          | Targeted funnel Vitest: 3 passed; full `npm run verify`: 129 files and 1037 tests passed; production build passed; later browser audit confirmed the production analytics script loads without console errors                                                                                                                                                                                                   | Implementation complete; production Umami event receipts and saved-query verification remain pending                                                                                                                                                                                                |
| 2026-07-19 | RR-09 | Closed player-facing touch-target gaps in the landing footer, shared header, deck controls and filters, tablet Battle HUD/zones, leaderboard tabs, Community chat navigation, and friend invites; aligned responsive harnesses with current routes; added reduced-motion and production-profile performance gates; deferred the remote multi-locale font catalog and compressed the shared card back | Player UI responsive: 72/72 passed; Battle responsive: 19/19 including reduced motion; tools: 6/6; Online Lobby + Community chat workflow: 4/4; production performance profile: initial ready 4.78s/LCP 2.00s, warm Battle ready 4.30s/LCP 4.04s, INP proxy 136-144ms, max long task 53-67ms, 0 visible broken card images; full `npm run verify`: 129 files and 1037 tests passed; production PWA build passed | Implementation complete; physical low-end Android full-match check remains. Admin responsive harness now runs against current selectors/data and records 5/10 passing; mobile card-maintenance navigation and the 1024 user table remain accepted post-Beta Admin work, not player-session blockers |
| 2026-07-19 | RR-05 | Replaced conditional-skip evidence with a fail-closed staging runner: HTTPS/WSS same-origin topology validation, registration followed by real login, explicit deck selection, Secure/HttpOnly cookie checks, Quick Match/chat/reconnect/result/history, friend invite, spectator hidden-information/read-only checks, hashed raw reports, and immutable release provenance                          | Targeted gate/release-contract tests and full repository verification passed                                                                                                                                                                                                                                                                                                                                    | Beta requires one complete retry-free run; the existing five-run mode is retained as `e2e:authenticated-staging:hardening`                                                                                                                                                                          |
| 2026-07-19 | RR-07 | Added release-mode isolated restore verification for exact account/deck/history/leaderboard fixtures and schema checksum, plus optional source-redeployment and attributable six-scenario alert evidence                                                                                                                                                                                             | Full repository verification, Bash syntax, operational config, typechecks, coverage, and production build passed                                                                                                                                                                                                                                                                                                | Beta requires the restore rehearsal only; source recovery and alert delivery remain available under `release:gate:hardening`                                                                                                                                                                        |
| 2026-07-19 | Live  | Completed a login-free, non-mutating production browser pass at desktop and 360x800; verified health/version alignment, PWA upgrade recovery, landing navigation, touch targets, About/community links, analytics script presence, and browser console                                                                                                                                               | Production API reported `0.2.1` / `124a911`; cached `0.2.0` shell upgraded successfully; no console errors; no 360px horizontal overflow; primary mobile controls >=44px; full `npm run verify`: 132 files and 1057 tests passed                                                                                                                                                                                | Added explicit PWA version-loading copy and hid placeholder community roots. RR-01, RR-08, and RR-09 remained open for trust-surface, analytics, and physical-device evidence at this checkpoint                                                                                                    |
| 2026-07-19 | RR-01 | Recorded the owner decision to rely on ZUTOMAYO's public non-commercial fan-work guideline and public card-asset posture; defined the project as an unofficial, advertising-free gameplay promotion service; added operator identity, public Privacy/Terms/contact routes, account links, and a rightsholder/takedown runbook                                                                        | Policy HTML SHA-256 `38392fb8054e54d1ff9242f63e21e725dccf2fa4c924b8d87f60fe207685d35b`; public MX points to AWS SES Tokyo; 17 targeted tests, production-preview smoke/a11y 20/20, responsive UI 84/84, and full `npm run verify` with 133 files/1064 tests passed                                                                                                                                              | Individual written IP authorization is no longer a Public Beta blocker. RR-01 remains verification pending only for real mailbox delivery, one redacted contact-handling rehearsal, deployment of these routes, and final owner approval of the published copy                                      |
| 2026-07-19 | Gate  | Added explicit `beta` and `production-hardening` profiles. Beta now blocks only on exact card data, one full authenticated multiplayer run, and one backup restore; chaos, load/soak, canary, six-scenario alerts, provider lifecycle, five-run multiplayer stability, deployment recovery, and full PostgreSQL isolation are deferred.                                                              | Script typecheck and 15 targeted profile/runner tests passed; `npm run release:gate` passed all 12 local/config checks through its nested full `npm run verify` and now reports exactly 3 Beta evidence blockers                                                                                                                                                                                                | The executable gate now matches the project scale instead of treating enterprise hardening as a Public Beta prerequisite                                                                                                                                                                            |

## Deferred Until After Beta

- Broad `Board.tsx` or `App.css` refactors.
- Full primitive migration and visual consistency cleanup for QA/Admin/Error routes.
- Admin card-maintenance mobile navigation/offscreen cleanup and wide 1024px user-table treatment.
- Light theme.
- Immutable image signing, canary, and full HA expansion beyond the recovery proof required above.
- Five-run authenticated stability, 2x load/soak, chaos/failover, complete alert delivery, provider lifecycle, source deployment recovery, and the full PostgreSQL role matrix (`npm run release:gate:hardening`).
- Visual replay playback unless Beta demand validates the investment.
- Generic unit coverage increases that are not tied to a release risk.
