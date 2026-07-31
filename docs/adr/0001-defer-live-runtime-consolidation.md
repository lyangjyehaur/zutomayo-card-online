# ADR 0001: Defer Live Runtime Consolidation

Status: Accepted with operational evidence pending  
Date: 2026-07-31  
Decision owner: Tech Lead / Operator  
Workstream: `LS-08`  
Evidence ID: `LS-EV-20260731-10`  
Review deadline: 2026-08-29, or earlier when a review trigger fires

## Context

The live service has three long-running application runtimes:

- Game runs boardgame.io, authoritative match state, hidden-information projection, Socket.IO synchronization, and PostgreSQL match persistence.
- API owns accounts, product data, ChatService, moderation, search, match-result verification, and administration.
- Platform runs Colyseus lobby, quick match, custom rooms, invites, match-shell lifecycle, and content-free presence signals.

All three share PostgreSQL and Redis. The current component count creates deployment and diagnosis overhead, but component count alone does not establish that consolidation would reduce total risk or maintainer effort.

This ADR covers runtime topology only. It does not authorize changes to game rules, player data ownership, ChatService authority, authentication, or the planned player-facing Agent.

## Evidence Available

| Dimension                | Current observation                                                                                                                                                         | Confidence / limitation                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Live shape               | One healthy Game, API, and Platform replica was observed, each with an immutable running-image digest                                                                       | High for the 2026-07-31 inventory; Compose still used mutable tags                              |
| Product use              | 22 accounts, 16 decks, 69 match-participant records, 83 room-participant records, and zero canonical completed matches were observed                                        | High for the point-in-time aggregate; not a DAU or success-rate measure                         |
| Availability and latency | Game, API, and Platform expose metrics and readiness checks                                                                                                                 | No durable collector was observed, so seven-day availability and latency are unknown            |
| Resource cost            | Collector configuration includes container, PostgreSQL, and Redis exporters                                                                                                 | CPU, memory, database connections, Redis memory, network use, and monetary cost are unknown     |
| Incident cost            | No reviewed production incident timeline attributes harm to a Game/API/Platform boundary                                                                                    | Absence of a retained incident is not proof that the boundary is harmless                       |
| Change concentration     | In the 90-day repository window, `api/server.cjs` had 105 file touches and `src/components/OnlineGame.tsx` had 42; selected API/server/platform paths appear in 273 commits | Repository history demonstrates active cross-runtime work, but does not record maintainer hours |
| Boundary enforcement     | Platform tests prohibit authoritative card state and durable chat text in Colyseus; API verifies submitted results against boardgame state                                  | Strong repository evidence; production-like journey evidence remains pending in `LS-05`         |
| Deployment recovery      | Exact-release reconstruction controls exist for Game, API, and Platform                                                                                                     | Staging recovery and arbitrary previous-release rollback remain unproven                        |

The evidence establishes a real maintenance question but does not quantify the benefit of a migration. Low current usage reduces immediate scaling pressure, while real users and unproven rollback increase the consequence of a topology rewrite.

## Decision Drivers

1. Preserve one authoritative owner for game state and hidden information.
2. Preserve PostgreSQL-backed ChatService evidence and moderation controls.
3. Reduce player-impacting deployment and handoff failures before optimizing process count.
4. Avoid a migration whose benefit cannot yet be measured.
5. Keep a credible path to consolidation if operating evidence shows the current split is the dominant cost.
6. Do not make the Agent a reason to introduce or remove a runtime before its own post-stabilization review.

## Options Considered

### Option 1: Keep The Current Topology As The Long-Term Default

Keep boardgame.io, Colyseus, API, PostgreSQL, and Redis in their current runtime roles.

Benefits:

- Preserves mature framework behavior and existing authority tests.
- Keeps match state, platform lifecycle, and durable product/chat data independently scoped.
- Avoids player session, room, invite, reconnect, and deployment migration work.

Costs and risks:

- Three application health surfaces, image lifecycles, log streams, and connection paths remain.
- Cross-runtime identity, participant evidence, match handoff, and recovery continue to require coordination.
- A solo maintainer may pay a disproportionate operational cost even at low traffic.

Assessment: viable, but there is not enough cost evidence to select it permanently.

### Option 2: Consolidate Selected Platform Lifecycle Functions

Move lobby, matchmaking, custom-room, invite, or match-shell functions into the existing API and Game Socket.IO boundary, then retire some or all of the Colyseus runtime.

Benefits:

- Could reduce one deployed process, image, health surface, and browser connection.
- Could eliminate selected participant-evidence and match-handoff calls across the Platform boundary.
- Could concentrate authentication, rate limiting, and observability in fewer entry points.

Costs and risks:

- Requires reimplementing Colyseus room discovery, presence, reconnection, lifecycle, and Redis behavior.
- Risks mixing lobby lifecycle with authoritative boardgame transport or durable API ownership.
- Requires migration compatibility for active rooms and sessions, plus new load, reconnect, security, rollback, and production-like journey proof.
- Process-count savings may not reduce PostgreSQL, Redis, reverse-proxy, monitoring, or maintainer costs.

Assessment: potentially useful, but no measured incident, latency, resource, or maintainer-time evidence currently shows that its benefits exceed migration risk.

### Option 3: Defer Structural Change And Improve Boundaries

Keep the deployed runtimes during stabilization, reduce module-level hot spots, finish operational measurement, and reopen the topology decision only against explicit triggers.

Benefits:

- Preserves live behavior while reliability, recovery, and player-journey evidence is still incomplete.
- Allows LS-07 module boundaries and observability to reduce change cost without a protocol migration.
- Produces the missing facts needed to size a future consolidation.

Costs and risks:

- The current deployment and diagnosis overhead remains during the evidence window.
- Deferral can become permanent unless review inputs, owner, and deadline are explicit.

Assessment: best fit for the current evidence.

## Decision

Select Option 3. Keep the current boardgame.io, Colyseus, API, PostgreSQL, and Redis topology through the initial stabilization cycle. Do not merge or retire a live runtime solely to reduce component count.

The decision is a time-bounded defer, not a permanent endorsement. LS-08 remains `Evidence pending` until the operator reviews a completed measurement packet. A future migration requires its own ADR, compatibility plan, production-like journey, load/reconnect/security evidence, and rollback proof.

## Required Measurement Packet

The review must include:

1. At least fourteen retained days of per-runtime CPU, memory, restarts, network, PostgreSQL connections, Redis use, and request/connection latency.
2. The completed LS-01 seven-day player and reliability window, including queue, match start/completion, and reconnect outcomes.
3. Every player-impacting incident or failed deployment in the window, classified by runtime and cross-runtime handoff involvement.
4. Maintainer time spent deploying, diagnosing, and coordinating Game/API/Platform changes, recorded in coarse task-level hours without personal activity tracking.
5. Five consecutive shipped product changes classified by which runtimes and contracts each change required.
6. Current infrastructure cost or, when shared hosting prevents monetary attribution, the measured resource share and capacity headroom.

## Early Review Triggers

Reopen the decision before the deadline if any trigger occurs:

- Two player-impacting incidents in 30 days share the same Platform-to-Game or Platform-to-API handoff cause.
- More than 20% of failed deployments or critical journey failures in the evidence window are attributable to cross-runtime version or handoff mismatch.
- Platform lifecycle contributes more than two operator hours per month for two consecutive months solely through separate deployment or diagnosis overhead.
- Three of five consecutive product changes require coordinated Game, API, and Platform releases for one player-visible behavior.
- A measured consolidation prototype removes at least 30% of application-runtime CPU or memory while meeting current SLO, security, reconnect, and rollback gates.
- A framework security, maintenance, or compatibility issue makes the current Colyseus or boardgame.io boundary unsafe to retain.

These thresholds trigger review, not automatic migration.

## Consequences

- Game remains the only authoritative match engine.
- Platform remains lifecycle and presence infrastructure; it must not own hidden card state or durable chat content.
- API remains the owner of authentication, product data, ChatService, moderation, search, and verified result persistence.
- New stabilization work should improve observability and module ownership without duplicating these authorities.
- Agent planning remains deferred under `LS-11` and must reuse existing authority boundaries unless later evidence justifies isolation.

## Validation And Follow-Up

- Owner: Operator enables and verifies durable collection under `LS-01`.
- Owner: Tech Lead records the task-level change and incident classifications.
- Review: Tech Lead and Operator evaluate the measurement packet by 2026-08-29.
- Closure: Update this ADR, the LS-08 tracker, evidence register, and risk register together. If the packet still does not justify migration, record a new review date and the evidence supporting continued deferral.

## References

- [`../LIVE_SERVICE_STABILIZATION_PLAN.md`](../LIVE_SERVICE_STABILIZATION_PLAN.md)
- [`../PRODUCTION_INVENTORY.md`](../PRODUCTION_INVENTORY.md)
- [`../TRAFFIC_RELIABILITY_BASELINE.md`](../TRAFFIC_RELIABILITY_BASELINE.md)
- [`../MAINTAINABILITY_BASELINE.md`](../MAINTAINABILITY_BASELINE.md)
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`../MULTIPLAYER_PLATFORM_ARCHITECTURE.md`](../MULTIPLAYER_PLATFORM_ARCHITECTURE.md)
