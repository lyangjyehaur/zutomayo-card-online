# Maintainability Baseline

Status: Complete for the initial stabilization cycle; follow-up hot spots remain  
Workstream: `LS-07`  
Evidence ID: `LS-EV-20260731-09`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: `704c1aa5f2b030011b681316421a74677b447f44` / `0.2.5`

This document records the measured hot spots and ownership changes made during stabilization. It does not authorize a framework rewrite, service merger, or broad CSS migration.

## Measured Hot Spots

The baseline combines file size with the number of commits touching each file during the 90 days ending 2026-07-31. A large file is not automatically defective; the combination identifies modules where unrelated responsibilities increase review and regression cost.

| Module                     | Baseline lines              | 90-day touches | Planned boundary                                                  |
| -------------------------- | --------------------------- | -------------- | ----------------------------------------------------------------- |
| `api/server.cjs`           | 6,531                       | 105            | Route groups and middleware, retaining current service contracts  |
| `src/components/Board.tsx` | 3,252                       | 117            | State derivation, action availability, overlays, and presentation |
| `src/api/client.ts`        | 2,569                       | 53             | Product domains sharing one auth/CSRF/refresh/error transport     |
| `src/App.css`              | Existing large shared sheet | 112            | Move touched page/component styles without a broad rewrite        |

Generated locale catalogs and purpose-built smoke scripts were excluded from the first extraction decision even when they were large, because line count alone did not demonstrate mixed runtime ownership.

## Slice 1: Battle Action Availability

The first slice moved battle interaction derivation from `Board.tsx` into `src/components/board/actionAvailability.ts`.

| Responsibility                 | Before                                               | After                                                                               |
| ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Minimum and required set count | Derived inline in `BattleBoard`                      | Delegates to authoritative `GameLogic` through the board helper                     |
| Play and confirm availability  | Mixed with React state, effects, handlers, and JSX   | Pure derivation in `deriveBattleActionAvailability`                                 |
| Per-card block classification  | Localized strings selected inside one inline closure | Stable reason codes from `battleCardBlockReason`; localization stays in `Board.tsx` |
| Playable hand-card list        | Filtered inline in `BattleBoard`                     | Returned by the action-availability boundary                                        |
| Authoritative game rules       | `src/game/GameLogic.ts`                              | Unchanged                                                                           |

`Board.tsx` decreased from 3,252 to 3,234 lines. The new ownership boundary is 77 lines and has a 144-line characterization suite. The value is the reduced reason-for-change surface, not the net line reduction.

## Slice 2: Public Card Routes

The second slice moved eight read-only card, catalog, game-config, and preset-deck routes from `api/server.cjs` into `api/publicCardRoutes.cjs`.

| Responsibility                            | Before                                   | After                                                                       |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Public card route matching                | Mixed into the 6,531-line server handler | Isolated in `handlePublicCardRoute`                                         |
| Query and path parameter forwarding       | Repeated inline beside unrelated routes  | Characterized by the public-card route suite                                |
| Service success/error HTTP mapping        | Repeated inline branches                 | Owned by the route group; service result contracts remain unchanged         |
| Public response cache policy              | Individual inline `no-store` assignments | Preserved per route in the route group                                      |
| CORS, rate limit, CSRF, and observability | Shared outer request handler             | Unchanged in `api/server.cjs` and still executed before the extracted group |
| Card data queries and validation          | `api/cardDataService.cjs`                | Unchanged                                                                   |

`api/server.cjs` decreased from 6,531 to 6,474 lines. The new route boundary is 84 lines with a 111-line direct suite. Existing `server.routes` integration coverage continues to exercise the group through the real outer handler.

## Slice 3: Knowledge Search Client

The third slice moved the player-facing knowledge-search contract and the related admin zero-result query from `src/api/client.ts` into `src/api/knowledgeClient.ts`.

| Responsibility                                   | Before                                                       | After                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Search parameter and response contracts          | Mixed with auth, profile, social, deck, match, and admin API | Owned by the knowledge-search product module                                               |
| Suggestion, full-search, and ID-only query shape | Built inside the shared 2,569-line client                    | Characterized through `createKnowledgeClient`                                              |
| Admin zero-result query                          | Coupled directly to shared admin helpers                     | Receives the admin-header provider as an explicit dependency                               |
| Authentication, CSRF, refresh, and API errors    | Shared `request` path in `src/api/client.ts`                 | Unchanged; injected into the domain module and verified through the compatibility facade   |
| Existing application imports                     | Consumers import from `src/api/client.ts`                    | Unchanged through a compatibility re-export; direct domain imports are available gradually |

`src/api/client.ts` decreased from 2,569 to 2,412 lines. The extracted boundary is 180 lines with a 137-line characterization suite. The factory has no fetch, storage, authentication, retry, or error-reporting ownership; those behaviors remain centralized in the existing transport.

## Characterization Coverage

The focused tests preserve these existing behaviors:

1. The previous battle loser may set one or two cards and may confirm after the minimum.
2. Spectators, ready players, and disabled tutorial interaction fail closed.
3. Tutorial allowlists and the area-enchant lock filter playable cards in the existing order.
4. Both occupied ordinary set slots block turn-set cards but not initial-set cards.
5. Tutorial-required cards must all be present before confirmation.
6. Knowledge suggestion, ID-only, and full-search filters retain their existing URL encoding and omission rules.
7. Abort signals pass through to the shared request transport.
8. The admin zero-result query obtains authorization headers from the shared admin-session boundary.
9. The compatibility facade still refreshes an expired account session and retries the original search request.

## Verification

| Check                                    | Result                                |
| ---------------------------------------- | ------------------------------------- |
| Action-availability characterization     | 5/5 tests passed                      |
| Adjacent board helper and hand tests     | 10/10 tests passed                    |
| Public-card route and server integration | 132/132 tests passed                  |
| Knowledge-search client characterization | 3/3 tests passed                      |
| App TypeScript check                     | Passed                                |
| Script TypeScript check                  | Passed                                |
| Focused ESLint                           | Passed                                |
| Full repository verification             | Passed with 1,576 tests and PWA build |

## Completion Decision

The initial LS-07 stabilization increment is complete because three independent hot spots now have smaller ownership boundaries with behavior-preserving tests: battle action availability, public card routes, and knowledge search. This meets the stabilization outcome without changing the live topology or forcing unrelated UI churn.

Board overlays and presentation remain follow-up candidates and should be extracted only with characterization coverage when those behaviors are changed. No stylesheet was touched in these slices, so the conditional `App.css` rule did not require a migration. Future large-file work must be justified by change cost or defects rather than line count alone.
