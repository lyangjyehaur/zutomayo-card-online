# Live Service Stabilization Plan

Status: Active  
Owner: Repository maintainer / service operator  
Established: 2026-07-30  
Last reviewed: 2026-07-31  
Review cadence: Weekly during stabilization, monthly after exit  
Scope: The already-running ZUTOMAYO CARD Online service and its supporting repository

## 1. Purpose

ZUTOMAYO CARD Online is already running with a small real user base. This document is the canonical plan for turning the current live deployment into a measured, recoverable, and maintainable service without destabilizing existing users.

This plan supersedes pre-launch readiness documents as the source of truth for current operating status. Earlier audits and remediation plans remain useful historical evidence and issue inventories, but their `No-Go` or pre-launch wording must not be used to infer that the service is offline.

The stabilization order is deliberate:

1. Establish what is deployed and how it behaves.
2. Protect user data and prove recovery.
3. Prove alerting, deployment, rollback, and critical player journeys.
4. Remove CI instability and reduce maintenance hot spots incrementally.
5. Reassess architecture only after operational evidence exists.

## 2. Operating Facts And Unknowns

Facts and unknowns are kept separate. An item is not treated as proven because code, configuration, or a runbook exists.

| Item                             | Current record                                                                                                | Evidence status                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Service state                    | Live with a small real user base                                                                              | Operator-confirmed on 2026-07-30; quantitative baseline pending              |
| Repository release               | `0.2.6`                                                                                                       | Confirmed by manifests                                                       |
| Repository inspection baseline   | `704c1aa` on `master`; `origin/master` was `fb37aed` at inspection                                            | Local repository observation; not asserted to be the deployed SHA            |
| Production build / image digests | Game, API, Platform, and host-present migration digests recorded in `LS-EV-20260731-01`; retention absent     | Partial evidence; mutable-tag and retention remediation required             |
| Production schema migration      | `000047_knowledge_search_zero_results`                                                                        | Read-only production query in `LS-EV-20260731-01`                            |
| Production card dataset hash     | `fcca13c58bde67a723b0359de377b6e17a2f905f752ecd5c8a84cda2bb137c96`                                            | Active release and public status agree in `LS-EV-20260731-01`                |
| Traffic and reliability baseline | DAU, CCU, match volume, error rate, latency, reconnect rate unknown here                                      | Evidence pending                                                             |
| Backup recoverability            | Expanded runner passed one synthetic isolated restore with seven attributable fixture classes                 | `LS-EV-20260731-04`; production-derived encrypted rehearsal pending          |
| Alert delivery                   | Rules, Alertmanager config, and fail-closed receipt validation pass locally                                   | `LS-EV-20260731-05`; production firing/resolved receipt pending              |
| Critical multiplayer journey     | Runner now requires 11 independent journey markers plus release, migration, and dataset identity              | `LS-EV-20260731-07`; a current production-like authenticated run is required |
| Legal and trust surface          | Public policy/account runner requires ten independently verified reachability, export, and deletion steps     | `LS-EV-20260731-08`; staging and mailbox receipts remain pending             |
| Maintainability hot spots        | Battle availability, public-card routes, and knowledge-search client extracted with characterization coverage | `LS-EV-20260731-09`; initial stabilization increment complete                |
| Architecture cost decision       | ADR 0001 compares keep, selected consolidation, and evidence-bounded deferral                                 | `LS-EV-20260731-10`; operational measurement packet and review pending       |
| Player and product evidence      | Six journey categories and de-identified observations have a fail-closed local evidence contract              | `LS-EV-20260731-11`; production queries and five observations pending        |
| Repository verification          | `npm run verify` exited 0 on 2026-07-31, including app/script typechecks and production build                 | Local command evidence in `LS-EV-20260731-02` through `LS-EV-20260731-11`    |
| Unit/coverage gate               | 1,581/1,581 tests passed; targeted AI suites passed 20 consecutive coverage-mode runs                         | Repository evidence in `LS-EV-20260731-02` through `LS-EV-20260731-11`       |

Production secrets, raw user identifiers, access tokens, private hostnames, and unredacted incident data must never be added to this document.

## 3. Outcomes

The initial stabilization cycle exits when all of the following are true for one identified release:

- The deployed commit, image digests, schema migration, rules version, and card dataset hash are recorded.
- Seven consecutive days of traffic and reliability measurements are available.
- A restore rehearsal verifies accounts, decks, match history, leaderboard data, and schema invariants, with measured RPO and RTO.
- At least one critical alert has been exercised through firing and resolved delivery.
- A deployment and rollback rehearsal is tied to the same release identity.
- Two authenticated sessions complete the critical multiplayer journey without skipped critical steps.
- `npm run verify` passes, and the time-sensitive AI test passes 20 consecutive targeted runs without a fallback caused by host load.
- The first maintainability slices have reduced the API and battle hot spots without changing public behavior.
- The current boardgame.io / Colyseus / API topology has a recorded keep, simplify, or defer decision based on measured costs.
- Known legal, privacy, moderation, and operator-contact risks have an accountable owner and explicit disposition.

Meeting these outcomes does not imply infinite scale or enterprise high availability. It means the service's actual operating envelope is understood and accepted.

## 4. Status Model

| Status           | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| Not started      | No current implementation or evidence has been reviewed.                        |
| In progress      | Work is active and has a named next action.                                     |
| Evidence pending | Implementation exists, but current live or production-like evidence is missing. |
| Blocked          | A named dependency or external decision prevents progress.                      |
| Accepted risk    | The owner has recorded scope, impact, expiry/review date, and mitigation.       |
| Complete         | Definition of done is met and evidence is linked in the register.               |

Only `Complete` and `Accepted risk` close an item. Configuration, a unit test, or an unverified statement is insufficient by itself.

## 5. Workstream Tracker

| ID    | Priority | Workstream                                     | Status           | Owner                | Target                   | Required evidence                                                               |
| ----- | -------- | ---------------------------------------------- | ---------------- | -------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| LS-00 | P0       | Production identity and service inventory      | In progress      | Operator             | Day 3                    | Release SHA/digests, migration, dataset hash, service/dependency inventory      |
| LS-01 | P0       | Traffic and reliability baseline               | In progress      | Operator / Backend   | Day 10                   | `LS-EV-20260731-03`: day-0 coverage audit; seven-day window not started         |
| LS-02 | P0       | Backup and restore proof                       | Evidence pending | Operator / Backend   | Day 7                    | `LS-EV-20260731-04`: local runner proof; production restore and RPO/RTO pending |
| LS-03 | P0       | Alert delivery and incident readiness          | Evidence pending | Operator             | Day 7                    | `LS-EV-20260731-05`: local config proof; live receipts and timeline pending     |
| LS-04 | P0       | Deployment and rollback safety                 | Evidence pending | Operator / Backend   | Day 14                   | `LS-EV-20260731-06`: local controls; staging recovery and match receipt pending |
| LS-05 | P0       | Authenticated multiplayer journey              | Evidence pending | Backend / QA         | Day 14                   | `LS-EV-20260731-07`: fail-closed local contract; production-like run pending    |
| LS-06 | P0       | CI determinism and flaky-test removal          | Complete         | Game / QA            | Completed 2026-07-31     | `LS-EV-20260731-02`: full verify plus 20 consecutive targeted coverage runs     |
| LS-07 | P1       | Maintainability hot spots                      | Complete         | Frontend / Backend   | Completed 2026-07-31     | `LS-EV-20260731-09`: battle, server-route, and client-domain boundaries         |
| LS-08 | P1       | Architecture cost decision                     | Evidence pending | Tech Lead / Operator | Review by 2026-08-29     | `LS-EV-20260731-10`: defer ADR; operational cost packet and review remain       |
| LS-09 | P1       | Player journey and product evidence            | Evidence pending | Product / Frontend   | Day 30                   | `LS-EV-20260731-11`: local gate; production queries and observations remain     |
| LS-10 | P0       | Legal, privacy, moderation, and operator trust | Evidence pending | Product / Operator   | Day 14                   | `LS-EV-20260731-08`: local trust gate; staging/mailbox review pending           |
| LS-11 | P2       | Player-facing AI agent                         | Planned          | Product / AI         | After stabilization exit | Product boundary, ADR, eval suite, security review, staged-rollout evidence     |

Targets are sequencing goals, not permission to mark incomplete evidence as complete. If capacity changes, update the target and decision log rather than silently carrying overdue work.

## 6. Definitions Of Done

### LS-00: Production Identity And Inventory

- Record the deployed Git SHA and immutable image digest for game, API, platform, migration, and retention units.
- Record `APP_VERSION`, `APP_BUILD_ID`, `GAME_RULES_VERSION`, the latest applied migration, and the public card dataset hash.
- Record the number of running replicas and the PostgreSQL, Redis, reverse-proxy, monitoring, backup, and external identity-provider dependencies.
- Record who can deploy, restore, rotate credentials, and receive alerts. A role or private contact directory may be linked instead of exposing personal data in Git.
- Identify any difference between the documented Compose topology and the live topology.

### LS-01: Traffic And Reliability Baseline

- Collect at least seven consecutive days of DAU, peak CCU, match starts/completions, queue duration, reconnects, HTTP 5xx, API latency, WebSocket connection latency, and dependency health.
- Use aggregated or pseudonymous data; do not add raw user or chat data to evidence.
- Compare the observations with [`SLO.md`](SLO.md). Keep, revise, or explicitly defer each target rather than assuming the documented target is already met.
- Record the current resource envelope: CPU, memory, PostgreSQL connections/storage, Redis memory, and outbound traffic.

### LS-02: Backup And Restore Proof

- Restore a production-derived, appropriately protected backup into an isolated environment.
- Run schema/checksum gates and verify representative account, deck, match history, leaderboard, chat/feedback retention, and boardgame state invariants.
- Record backup creation time, restore start/end, measured RPO/RTO, row-count or invariant results, and the release/schema identity.
- Do not overwrite the live database during the exercise.
- Link the redacted report produced through [`database-restore.md`](runbooks/database-restore.md).

### LS-03: Alert Delivery And Incident Readiness

- Exercise at least one critical service-unavailable alert and its resolved notification.
- Confirm the notification reaches the actual operator within the documented target.
- Run a tabletop or controlled incident using [`incident-response.md`](runbooks/incident-response.md), recording detection, acknowledgement, mitigation, recovery, and follow-up times.
- Create follow-up items for missing dashboards, noisy alerts, or unclear ownership.

### LS-04: Deployment And Rollback Safety

- Bind deployment evidence to immutable release and dataset identities.
- Run pre-deploy gates, migrations, readiness checks, and post-deploy smoke.
- Confirm WebSocket drain behavior and that active matches either complete, reconnect, or fail in the documented way.
- Roll back to the previous verified release or perform an equivalent production-like rehearsal.
- Record duration, user impact, schema compatibility, and any manual intervention.

### LS-05: Authenticated Multiplayer Journey

- Two independent authenticated sessions select server-backed decks and complete Quick Match or Invite matchmaking.
- The journey covers chat authorization, disconnect/reconnect, result submission, match history, and opponent hidden information.
- No critical step is conditionally skipped; retry usage and flakes are recorded.
- Evidence is tied to the tested build, migration, and dataset.
- Tests run against a topology matching production proxy, cookie, WebSocket, PostgreSQL, Redis, game, API, and platform boundaries.

### LS-06: CI Determinism

- Make AI decision timing deterministic in tests by injecting the clock and/or an explicit budget appropriate to the behavior under test.
- Preserve a separate test for real budget exhaustion.
- Pass the targeted AI choice suite 20 consecutive times under coverage or equivalent CI load.
- Run `npm run verify` from a clean, task-scoped worktree and record the result.
- Do not weaken assertions or increase global timeouts without an evidence-based reason.

### LS-07: Maintainability Hot Spots

Work is incremental and behavior-preserving. A framework rewrite, service merger, or broad CSS rewrite is outside this workstream unless separately approved through LS-08.

- Extract API route groups and middleware from `api/server.cjs` while retaining existing service contracts.
- Split battle state derivation, action availability, overlays, and presentation from `src/components/Board.tsx`; authoritative rules stay in `src/game`.
- Split `src/api/client.ts` by product domain while keeping authentication, CSRF, refresh, and error handling consistent.
- Move page/component styles out of `src/App.css` as touched; prohibit new unexplained `!important` rules.
- Each slice includes characterization or behavioral tests and records which ownership boundary became smaller.

### LS-08: Architecture Cost Decision

The default during stabilization is to keep the current topology. No live service is removed merely to reduce the component count.

The ADR must compare at least:

1. Keep boardgame.io, Colyseus, API, PostgreSQL, and Redis as deployed.
2. Consolidate selected platform lifecycle functions into the existing API/Socket.IO boundary.
3. Defer structural change and improve only code/module boundaries.

The decision uses measured incident sources, operating cost, resource consumption, latency, deployment complexity, feature dependency, migration risk, and maintainer time. If the data does not justify migration, record `defer` with a review trigger.

### LS-09: Player And Product Evidence

- Establish home-to-first-match, queue-to-match, match completion, reconnect, tutorial completion, and returning-player baselines where privacy policy permits.
- Observe at least five first-time or representative players, or document why another evidence source is more appropriate.
- Record problems, not raw personal data. Rank changes by player impact and frequency.
- Product evidence, rather than infrastructure completeness, determines the next feature cycle.

### LS-10: Legal And Trust Surface

- Confirm the operator identity/contact path, Privacy, Terms, retention, deletion, moderation, and appeal surfaces are reachable in the deployed product.
- Run one redacted contact or account-deletion handling rehearsal.
- Record the fan-work/IP position, takedown procedure, accountable owner, remaining risk, and next review trigger.
- Legal or rights-holder decisions are not replaced by engineering approval.

### LS-11: Player-Facing AI Agent

The planned agent has three distinct product capabilities. They must be specified and evaluated separately rather than shipped as one unrestricted assistant:

1. Rules assistant: answers questions from official rules, Q&A, errata, and the released card dataset with visible source citations.
2. Deck advisor: checks legality and analyzes the player's deck/collection before proposing structured card additions, removals, and reasons.
3. Player interaction: provides conversational help in approved surfaces without impersonating staff, moderators, opponents, or an authoritative rules judge.

The first implementation should remain an API-owned domain that can reuse the existing authentication, ChatService, PostgreSQL data, rate limiting, observability, and moderation boundaries. Do not introduce another permanently running service until measured latency, workload isolation, or scaling requirements justify it. Expensive asynchronous analysis may move to a worker later without changing the public contract.

Required safety and authority boundaries:

- Official rules, released rulings, card data, deck legality, user collection, and explicitly supplied conversation context are allowlisted tools or retrieval sources. The model does not query arbitrary production tables.
- Deterministic code remains authoritative for deck legality, card identity, ownership, game rules, and write validation. The model explains or proposes; it does not override validators.
- The agent cannot read opponent hidden information, credentials, private moderation evidence, unrelated chat, or internal administration data.
- The default live-match policy permits public rules explanations only. Tactical coaching, ranked-match assistance, post-match analysis, and AI-game assistance require an explicit fairness policy per mode.
- Creating or replacing a deck, sending a message, or performing another mutation requires visible player confirmation and goes through the existing authenticated API, CSRF, authorization, validation, and audit path.
- Answers distinguish official citations, deterministic calculations, recommendations, and uncertainty. Missing evidence produces a bounded refusal or escalation rather than a fabricated ruling.
- User/card/chat content is treated as untrusted input. Tool arguments are schema-validated, tool output is isolated from instructions, and prompt-injection attempts cannot widen permissions.
- Retention, provider data use, redaction, deletion, moderation, rate limits, cost budgets, timeouts, fallback behavior, and a kill switch are defined before external rollout.
- Six-language behavior is evaluated, but official Japanese source text and released translations retain provenance; the agent must not silently create a new canonical card translation.

Required evaluation and rollout evidence:

- A versioned evaluation set covers official rules/Q&A, errata conflicts, deck legality, collection-aware recommendations, ambiguous questions, unsupported requests, malicious prompts, privacy boundaries, and all supported locales.
- Every deck suggestion is machine-checkable as a structured diff and must pass the existing deck validator before presentation.
- Release thresholds cover citation correctness, factual/rules accuracy, legal-deck rate, hidden-data leakage, unsafe tool-call rate, refusal quality, latency, and per-interaction cost.
- Rollout proceeds through offline evaluation, maintainer/internal use, opt-in users, and a limited percentage of the live population. Each stage has an owner, rollback condition, and reviewed evidence.
- Agent/model/provider/prompt/tool versions are recorded with feedback and traces so regressions are reproducible without retaining unnecessary personal or chat content.

## 7. Thirty-Day Sequence

### Days 0-3: Establish Reality

- Complete LS-00.
- Start the seven-day LS-01 measurement window.
- Fix and repeatedly exercise the LS-06 AI timing test.
- Freeze architecture expansion while evidence is collected.

### Days 4-7: Protect And Detect

- Complete one LS-02 restore rehearsal.
- Complete one LS-03 firing/resolved alert exercise and incident tabletop.
- Triage any discovered data-loss or notification gap before feature work.

### Days 8-14: Deploy And Play Through

- Complete the LS-04 deployment/rollback rehearsal.
- Complete the LS-05 authenticated multiplayer journey.
- Close or explicitly accept LS-10 trust-surface risks.
- Review the first seven days of LS-01 data against the SLOs.

### Days 15-30: Reduce Change Risk

- Deliver the first small LS-07 API and battle slices.
- Collect LS-09 player evidence.
- Write the LS-08 ADR using the first two weeks of operating and maintenance data.
- Draft the LS-11 product boundary, fairness policy, data-flow diagram, and offline evaluation set; do not make live rollout a stabilization exit dependency.
- Hold a stabilization exit review and assign all residual risks an owner and review date.

## 8. Evidence And Traceability

### Evidence IDs

Use `LS-EV-YYYYMMDD-NN`, for example `LS-EV-20260730-01`. Every completed workstream references one or more evidence IDs.

Machine-generated evidence belongs in CI artifacts or access-controlled operational storage, not in Git. `.release-evidence/` and generated recovery artifacts may contain environment details and are intentionally not tracked. This document stores only redacted summaries, hashes, and durable links.

### Evidence Register

| Evidence ID       | Date       | Workstream | Release SHA / build                                               | Summary                                                                                                                                                                                                                                                              | Artifact or run link                                                                                                                       | Reviewer                |
| ----------------- | ---------- | ---------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| LS-EV-20260731-01 | 2026-07-31 | LS-00      | `fb37aed78983818d59388c182aa7fcb1f26b9ee9` / `0.2.5`              | Read-only production identity and topology inventory; retention and immutable-manifest gaps found                                                                                                                                                                    | [`PRODUCTION_INVENTORY.md`](PRODUCTION_INVENTORY.md) and access-controlled raw capture                                                     | Operator review pending |
| LS-EV-20260731-02 | 2026-07-31 | LS-06      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Deterministic AI clocks and explicit budget-exhaustion coverage; targeted run 20/20; full verify passed with 1,549 tests and production build                                                                                                                        | [`ai.test.ts`](../src/game/__tests__/ai.test.ts), [`aiChoices.test.ts`](../src/game/__tests__/aiChoices.test.ts), and local command record | Repository review       |
| LS-EV-20260731-03 | 2026-07-31 | LS-01      | Production `fb37aed`; local `704c1aa` plus task changes / `0.2.5` | Day-0 aggregate and coverage audit; prepared quick-match and connection telemetry plus corrected dashboard; full verify exited 0 with 1,553 tests; production receipts remain pending                                                                                | [`TRAFFIC_RELIABILITY_BASELINE.md`](TRAFFIC_RELIABILITY_BASELINE.md) and [`funnel-analytics.md`](funnel-analytics.md)                      | Operator review pending |
| LS-EV-20260731-04 | 2026-07-31 | LS-02      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Synthetic isolated restore passed in 10 seconds with seven fixture classes and schema, legal-hold, and boardgame-state invariants; full verify passed with 1,554 tests; production-derived encrypted rehearsal pending                                               | [`RESTORE_REHEARSAL_BASELINE.md`](RESTORE_REHEARSAL_BASELINE.md)                                                                           | Repository review       |
| LS-EV-20260731-05 | 2026-07-31 | LS-03      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Promtool accepted 28 rules, amtool accepted three receivers, reconnect/dependency rules and receipt validation were hardened, and full verify passed with 1,554 tests; production delivery remains pending                                                           | [`ALERT_READINESS_BASELINE.md`](ALERT_READINESS_BASELINE.md)                                                                               | Repository review       |
| LS-EV-20260731-06 | 2026-07-31 | LS-04      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Prepared fail-closed exact-release reconstruction evidence for backup, schema, dataset, health/build/assets, and controlled-match outcomes; full verify passed with 1,555 tests; staging rehearsal remains pending                                                   | [`DEPLOYMENT_RECOVERY_BASELINE.md`](DEPLOYMENT_RECOVERY_BASELINE.md)                                                                       | Repository review       |
| LS-EV-20260731-07 | 2026-07-31 | LS-05      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Added 11 independently verified journey markers and release/migration/dataset identity cross-checks; full verify passed with 1,556 tests; production-like authenticated staging receipt remains pending                                                              | [`AUTHENTICATED_MULTIPLAYER_BASELINE.md`](AUTHENTICATED_MULTIPLAYER_BASELINE.md)                                                           | Repository review       |
| LS-EV-20260731-08 | 2026-07-31 | LS-10      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Added a production-refusing trust gate for four public policies, Profile entry, export, synthetic-account deletion, session revocation, and tombstone login; full verify passed with 1,560 tests; staging and mailbox receipts remain pending                        | [`TRUST_SURFACE_BASELINE.md`](TRUST_SURFACE_BASELINE.md)                                                                                   | Repository review       |
| LS-EV-20260731-09 | 2026-07-31 | LS-07      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Extracted battle action availability, eight public-card routes, and the knowledge-search client domain with compatibility coverage; full verify passed with 203 test files, 1,576 tests, coverage gates, and the production/PWA build                                | [`MAINTAINABILITY_BASELINE.md`](MAINTAINABILITY_BASELINE.md)                                                                               | Repository review       |
| LS-EV-20260731-10 | 2026-07-31 | LS-08      | Production `fb37aed`; local `704c1aa` plus task changes / `0.2.5` | Compared the live topology against selective consolidation and recorded a time-bounded defer with quantitative triggers; durable resource, latency, incident, infrastructure-cost, and maintainer-time review evidence remains pending                               | [`ADR 0001`](adr/0001-defer-live-runtime-consolidation.md)                                                                                 | Operator review pending |
| LS-EV-20260731-11 | 2026-07-31 | LS-09      | Local `704c1aa` plus task-scoped changes / `0.2.5`                | Added a release-bound gate for six aggregate journeys, five de-identified observations, task coverage, attributable issue frequency, and reproducible impact/frequency ranking; full verify passed with 204 test files and 1,581 tests; live receipts remain pending | [`PLAYER_PRODUCT_EVIDENCE_BASELINE.md`](PLAYER_PRODUCT_EVIDENCE_BASELINE.md)                                                               | Product review pending  |

### Risk Register

| Risk ID    | Workstream    | Risk                                                                                                               | Impact                                                                                          | Mitigation                                                                                                                                | Owner                | Review / expiry               | Status |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------- | ------ |
| LS-RISK-01 | LS-06         | AI decision test depended on host timing and could fail under suite load                                           | CI results were not fully trustworthy                                                           | Injected a deterministic clock, retained explicit budget-exhaustion coverage, passed 20/20 targeted coverage runs, and passed full verify | Game / QA            | Closed 2026-07-31             | Closed |
| LS-RISK-02 | LS-02         | Restore runner is locally proven, but no current production-derived rehearsal is evidenced                         | User data recovery time and completeness are unknown                                            | Run the expanded seven-fixture encrypted restore rehearsal in isolation and record production-derived RPO/RTO                             | Operator / Backend   | 2026-08-06                    | Open   |
| LS-RISK-03 | LS-08         | Multiple realtime/runtime boundaries may increase operating and change cost                                        | Slower diagnosis and higher solo-maintenance load                                               | ADR 0001 retains the topology temporarily and requires a dated resource, incident, change-cost, and maintainer-time review packet         | Tech Lead / Operator | 2026-08-29                    | Open   |
| LS-RISK-04 | LS-11         | Agent output can hallucinate rulings, leak data, enable unfair live-match assistance, or perform unintended writes | Player trust, competitive integrity, privacy, and account data may be harmed                    | Keep tools least-privileged; make deterministic validators authoritative; require citations, eval gates, confirmations, and a kill switch | Product / AI         | Before external agent rollout | Open   |
| LS-RISK-05 | LS-00 / LS-10 | The production retention timer skips because the required immutable release manifest is absent                     | Retention policy is not being enforced and expired user data may remain longer than declared    | Install a verified release manifest, run retention once under its dedicated role, verify metrics, and retain a dated receipt              | Operator / Backend   | 2026-08-01                    | Open   |
| LS-RISK-06 | LS-01         | Production exposes in-process metrics but has no observed durable collector                                        | Seven-day reliability, latency, CCU, reconnect, and resource history cannot currently be proven | Deploy and verify a persistent collector separately from the beta app rollout, then record the measurement start receipt                  | Operator / Backend   | 2026-08-01                    | Open   |
| LS-RISK-07 | LS-03         | Alert rules are locally valid but have no current production destination receipt                                   | A player-impacting outage may not reach or be acknowledged by the operator                      | Deploy Alertmanager with a secret-managed destination and exercise one critical firing/resolved path with an incident timeline            | Operator             | 2026-08-01                    | Open   |
| LS-RISK-08 | LS-04         | Current server4 tooling can reconstruct the exact release but cannot select or prove an arbitrary previous release | A bad release may require fix-forward while users remain affected                               | Rehearse exact-release recovery now; add immutable release selection and previous-runtime schema compatibility before claiming rollback   | Operator / Backend   | 2026-08-13                    | Open   |
| LS-RISK-09 | LS-05         | Authenticated journey enforcement is locally validated but has no current production-like staging receipt          | Proxy, cookie, WebSocket, persistence, or cross-service failures could remain invisible         | Run the exact-release staging journey, retain hashed artifacts, and pass the combined release evidence gate                               | Backend / QA         | 2026-08-06                    | Open   |
| LS-RISK-10 | LS-10         | Policy and deletion controls are locally validated but staging reachability and mailbox handling are unproven      | Players or rightsholders may be unable to exercise rights or reach an accountable operator      | Run the synthetic deletion journey, send a controlled mailbox request, retain redacted receipts, and obtain Product/Operator review       | Product / Operator   | 2026-08-06                    | Open   |
| LS-RISK-11 | LS-09         | Instrumentation exists, but production funnel receipts and representative player observations are absent           | The next feature cycle could optimize repository assumptions instead of real player problems    | Open one release-bound seven-day window, collect at least five de-identified observations, and pass the player/product evidence gate      | Product / Frontend   | 2026-08-29                    | Open   |

### Decision Log

| Decision ID | Date       | Decision                                                                                                                                     | Reason                                                                                                                                             | Revisit trigger                                                                          |
| ----------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| LS-DEC-001  | 2026-07-30 | Treat the service as live and make this plan the current operational source of truth                                                         | Operator confirmed a small real user base; pre-launch wording no longer describes actual state                                                     | Service is intentionally taken offline or ownership changes                              |
| LS-DEC-002  | 2026-07-30 | Keep the current service topology during the initial stabilization cycle                                                                     | Removing a live runtime without incident/cost evidence creates more immediate risk than it removes                                                 | LS-08 ADR has sufficient evidence and an approved migration plan                         |
| LS-DEC-003  | 2026-07-30 | Track the player-facing agent as a post-stabilization capability and initially place it behind the existing API/ChatService boundaries       | The feature needs strong data, fairness, and tool authority controls but does not yet justify another production runtime                           | Measured workload or isolation requirements demonstrate that a separate service is safer |
| LS-DEC-004  | 2026-07-31 | Treat the current server4 drill as exact-release reconstruction, not arbitrary rollback                                                      | The Beta deployer has no immutable previous-release selector and the database uses forward-only migrations                                         | Immutable releases and previous-runtime schema compatibility are both proven             |
| LS-DEC-005  | 2026-07-31 | Close the initial LS-07 increment after three tested ownership extractions; defer further board and CSS movement until those surfaces change | The first stabilization outcome is met, while extraction driven only by file size would add live-service regression risk                           | A measured defect or change-cost hotspot requires another maintainability slice          |
| LS-DEC-006  | 2026-07-31 | Keep the Game/API/Platform topology during stabilization and defer runtime consolidation to an evidence-triggered review                     | Current inventory and code boundaries show migration risk, while durable resource, latency, incident, cost, and maintainer-time evidence is absent | ADR 0001 deadline or any listed early-review trigger fires                               |

## 9. Weekly Review Template

Append one row per review. Do not rewrite earlier records when the assessment changes.

| Review date | Release/build                                                                    | Traffic window                                                       | Completed evidence                                                                                                                                                                                                                                | Incidents / SLO changes                                                                                                                                                                                | Decisions                                                                                                 | Next three actions                                                                                 | Reviewer                |
| ----------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-07-30  | Production identity pending                                                      | Quantitative baseline pending                                        | Plan established; local typechecks passed; unit suite exposed LS-RISK-01; player-facing agent added as LS-11                                                                                                                                      | None recorded in this review                                                                                                                                                                           | LS-DEC-001, LS-DEC-002, LS-DEC-003                                                                        | Complete LS-00; fix LS-06; schedule LS-02/LS-03 exercises                                          | Repository review       |
| 2026-07-31  | Production `fb37aed78983818d59388c182aa7fcb1f26b9ee9`; local `704c1aa` / `0.2.5` | Day-0 audit complete; seven-day window blocked on durable collection | `LS-EV-20260731-01` through `LS-EV-20260731-11`: inventory, CI determinism, monitoring preparation, restore/alert/recovery controls, authenticated journey, trust surface, maintainability boundaries, topology ADR, and player-evidence contract | Retention skipped; mutable tags; no durable collector, production restore/alert receipt, recovery/player/trust staging rehearsal, mailbox receipt, LS-08 cost packet, product queries, or observations | LS-DEC-004 exact-release recovery; LS-DEC-005 close initial LS-07; LS-DEC-006 defer runtime consolidation | Roll out LS-01 monitoring; execute LS-02/LS-03 exercises; collect LS-09 analytics and observations | Operator review pending |

## 10. Relationship To Existing Documents

- [`PLAN.md`](PLAN.md) remains the product and architecture phase summary.
- [`release-readiness-remediation-plan.md`](release-readiness-remediation-plan.md) is retained as pre-launch remediation history and a source of unresolved acceptance criteria.
- [`P0_P5_IMPLEMENTATION.md`](P0_P5_IMPLEMENTATION.md) remains a production-maturity implementation audit, not the current operating-status declaration.
- [`SLO.md`](SLO.md) defines target service levels; LS-01 verifies whether they match reality.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`runbooks/`](runbooks/) define procedures; this plan records whether those procedures have current evidence.
- Executable `release:gate` profiles remain useful evidence producers. Their `blocked` state means evidence is absent for that profile, not that the already-running service is offline.

## 11. Change Rules

- Update the tracker, evidence register, risk register, and weekly review in the same change that claims progress.
- Tie operational claims to an immutable release identity and dated evidence.
- Preserve historical failures and superseded decisions; append corrections instead of erasing them.
- Record accepted risks with an owner and review/expiry date.
- Run `npm run verify` before committing or pushing, as required by repository policy. If unrelated user-owned files block it, run the precise checks for the documentation change and record the limitation.
