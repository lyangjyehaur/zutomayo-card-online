# Implementation Plan

Current status for the ZUTOMAYO CARD Online implementation. This file tracks product and architecture progress; current rules/effect status is detailed in [RULE_ENGINE_AUDIT.md](RULE_ENGINE_AUDIT.md) and [CARD_EFFECT_AUDIT_FINAL.md](CARD_EFFECT_AUDIT_FINAL.md).

## Phase Status / 階段狀態

| Phase | Area                          | Status    | Notes                                                                                                                                                                                                                 |
| ----- | ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Rules and data baseline       | Done      | Official rules/Q&A captured in [rules.md](rules.md) and [qa.json](qa.json). Card data is loaded from [cards.json](cards.json).                                                                                        |
| 1     | Deterministic game state      | Done      | Explicit `GameState.step` flow: `janken -> mulligan -> initialSet -> turnSet -> effectOrder -> turnSet/gameOver`.                                                                                                     |
| 2     | Card/deck model               | Done      | 422 cards, deck construction validation, four preset decks, card image URLs on R2.                                                                                                                                    |
| 3     | Setup flow                    | Done      | Janken, night-side assignment, mulligan, initial face-down setup, simultaneous reveal.                                                                                                                                |
| 4     | Core turn/combat rules        | Done      | Chronos movement, day/night priority, A/B placement precedence, battle-zone replacement, Power Cost checks, battle damage, exact overdraw loss.                                                                       |
| 5     | Effect system foundation      | Done      | Parser/executor pipeline, effect-order queue, pending choices, timing events, and several deterministic/prompted card-effect flows. Not all card text is complete.                                                    |
| 6     | Local product UI              | Done      | Local battle, deck editor, tutorial, match history, language switcher, card/admin views.                                                                                                                              |
| 7     | Online multiplayer            | Done      | boardgame.io rooms, WebSocket sync, hidden-info `playerView`, setupData deck selection, reconnect/resume UX.                                                                                                          |
| 8     | Account system                | Done      | Logto provides sign-in/sign-out. `/api/logto/profile` syncs Logto identity to local game profile, decks, match history, and leaderboard data.                                                                         |
| 9     | Match history and leaderboard | Done      | Browser-local match history, `/api/matches`, `/api/leaderboard`, authenticated match submission, ELO feedback, and leaderboard/profile UI are integrated.                                                             |
| 10    | AI practice                   | Done      | Easy/Normal/Hard levels are available. Hard uses `hardLookahead()` to simulate card combinations and evaluate damage differential.                                                                                    |
| 11    | Backend and deployment        | Done      | Docker Compose runs `game` on `3000` and `api` on `3001`; API persists to PostgreSQL and Redis.                                                                                                                       |
| 12    | Error reporting               | Done      | GlitchTip/Sentry-compatible SDKs capture browser, API, and game-server errors with release/environment context and safe online breadcrumbs.                                                                           |
| 13    | API framework                 | Done      | API routing now runs on Hono with Zod request body/query helpers while preserving the existing PostgreSQL, Redis, Logto, and admin behavior.                                                                          |
| 14    | Admin CRUD framework          | Done      | Refine core wraps the existing admin UI with a resource/data-provider layer backed by the Admin API; Directus is not adopted for the current back-office-only CRUD scope. See [MATURE_SYSTEMS.md](MATURE_SYSTEMS.md). |
| 15    | Online presence/matchmaking   | Evaluated | Keep boardgame.io + Redis for now; re-evaluate Colyseus before Nakama if realtime lobby, room lifecycle, or matchmaking requirements outgrow the current stack. See [MATURE_SYSTEMS.md](MATURE_SYSTEMS.md).           |

## Current Baseline / 目前基準

- Frontend: Vite + React + TypeScript + React Router.
- Game server: [src/server.ts](src/server.ts), boardgame.io, port `3000`.
- API server: [api/server.cjs](api/server.cjs), Hono + Zod + PostgreSQL + Redis, port `3001`.
- Admin CRUD: Refine core + existing Admin API, keeping API-owned validation, auth, and audit logging.
- Observability: GlitchTip/Sentry-compatible browser + Node SDKs, configured by DSN environment variables.
- Mature systems decisions: [docs/MATURE_SYSTEMS.md](MATURE_SYSTEMS.md) tracks adopted, deferred, and re-evaluation gates.
- Deployment target: Docker Compose on Debian 12 host `149.104.6.238`.
- Card audit from `npm run rule:audit`: 422 total cards, 250 effect cards, 267 effect lines, 267 parsed lines, 288 runtime parsed effects, 0 unparsed lines, 0 parsed-but-partial lines.

## Current State and Remaining Work / 目前狀態與待辦

Current implementation state:

1. Account frontend integration: ✅ DONE — Logto sign-in/sign-out/profile UI is wired, and guest mode remains available.
2. Server-backed deck sync: ✅ DONE — deck editor saves to authenticated deck CRUD while preserving browser-local fallback for guests.
3. Match result integration: ✅ DONE — completed authenticated matches submit to `/api/matches` with sanitized action logs.
4. Leaderboard/profile UI: ✅ DONE — `/api/leaderboard` and user ELO/profile stats are exposed in the React app.
5. Online seat resume: ✅ DONE via boardgame.io `playerCredentials`; account-bound online seat enforcement is future product scope.
6. Action log/replay: add an authoritative sanitized move trace for debugging and disputes; do not rely on human-readable `G.log` alone.
7. Online lifecycle polish: PARTIAL — reconnect, full-room/missing-room errors, and waiting states exist; invite/share-link polish, stale-room cleanup, and abandon handling remain.
8. Hard AI lookahead: ✅ DONE — hardLookahead() simulates all card combinations, calculates damage differential, considers Chronos and Power Cost.
9. Card-effect completion: ✅ DONE by current parser/executor audit — 267/267 effect lines parse, runtime AST coverage is checked, parsed-but-partial is 0, and semantic regressions are covered in `scripts/game-smoke.ts`.
10. Persistence hardening: ✅ DONE — api-smoke.ts tests, Logto token verification, backup/restore docs in DEPLOYMENT.md.

## Verification / 驗證

Use these after game, online, or backend changes:

```bash
npm run smoke
npm run smoke:api
npm run build
npm run smoke:online
npm run rule:audit
```

For API changes, run `npm run smoke:api`; it exercises Logto auth, profile, deck CRUD, match reporting, sanitized match-log retrieval, leaderboard/profile stats, and guest placeholder match reporting against an isolated PostgreSQL DB.
