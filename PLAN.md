# Implementation Plan

Current status for the ZUTOMAYO CARD Online implementation. This file tracks product and architecture progress; card-effect parser/executor gaps remain detailed in [RULE_GAP_AUDIT.md](RULE_GAP_AUDIT.md).

## Phase Status / 階段狀態

| Phase | Area | Status | Notes |
| --- | --- | --- | --- |
| 0 | Rules and data baseline | Done | Official rules/Q&A captured in [rules.md](rules.md) and [qa.json](qa.json). Card data is loaded from [cards.json](cards.json). |
| 1 | Deterministic game state | Done | Explicit `GameState.step` flow: `janken -> mulligan -> initialSet -> turnSet -> effectOrder -> turnSet/gameOver`. |
| 2 | Card/deck model | Done | 422 cards, deck construction validation, four preset decks, card image URLs on R2. |
| 3 | Setup flow | Done | Janken, night-side assignment, mulligan, initial face-down setup, simultaneous reveal. |
| 4 | Core turn/combat rules | Done | Chronos movement, day/night priority, A/B placement precedence, battle-zone replacement, Power Cost checks, battle damage, exact overdraw loss. |
| 5 | Effect system foundation | Done | Parser/executor pipeline, effect-order queue, pending choices, timing events, and several deterministic/prompted card-effect flows. Not all card text is complete. |
| 6 | Local product UI | Done | Local battle, deck editor, tutorial, match history, language switcher, card/admin views. |
| 7 | Online multiplayer | Done | boardgame.io rooms, WebSocket sync, hidden-info `playerView`, setupData deck selection, reconnect/resume UX. |
| 8 | Account system | Done | `/api/register`, `/api/login`, and `/api/profile` exist. Lobby `AuthSection` provides login, register, logout, and profile display while guest mode remains available. |
| 9 | Match history and leaderboard | Done | Browser-local match history, `/api/matches`, `/api/leaderboard`, authenticated match submission, ELO feedback, and leaderboard/profile UI are integrated. |
| 10 | AI practice | Done | Easy/Normal/Hard levels are available. Hard uses `hardLookahead()` to simulate card combinations and evaluate damage differential. |
| 11 | Backend and deployment | Done | Docker Compose runs `game` on `3000` and `api` on `3001`; API persists to SQLite. |

## Current Baseline / 目前基準

- Frontend: Vite + React + TypeScript + React Router.
- Game server: [src/server.ts](src/server.ts), boardgame.io, port `3000`.
- API server: [api/server.cjs](api/server.cjs), Node HTTP + SQLite via `better-sqlite3`, port `3001`.
- Deployment target: Docker Compose on Debian 12 host `149.104.6.238`.
- Card audit from `npm run rule:audit`: 422 total cards, 250 effect cards, 267 effect lines, 247 parsed lines, 20 unparsed lines, 49 parsed-but-partial lines.

## Current State and Remaining Work / 目前狀態與待辦

From [NON_CARD_GAPS.md](NON_CARD_GAPS.md), adjusted for the current implementation state:

1. Account frontend integration: ✅ DONE — lobby login/register/logout/profile UI is wired, and guest mode remains available.
2. Server-backed deck sync: ✅ DONE — deck editor saves to authenticated deck CRUD while preserving browser-local fallback for guests.
3. Match result integration: ✅ DONE — completed authenticated matches submit to `/api/matches` with sanitized action logs.
4. Leaderboard/profile UI: ✅ DONE — `/api/leaderboard` and user ELO/profile stats are exposed in the React app.
5. Authenticated match ownership: ✅ DONE for reconnect/resume via boardgame.io `playerCredentials`; account-bound seat enforcement remains optional future product scope.
6. Action log/replay: add an authoritative sanitized move trace for debugging and disputes; do not rely on human-readable `G.log` alone.
7. Online lifecycle polish: PARTIAL — reconnect, full-room/missing-room errors, and waiting states exist; invite/share-link polish, stale-room cleanup, and abandon handling remain.
8. Hard AI lookahead: ✅ DONE — hardLookahead() simulates all card combinations, calculates damage differential, considers Chronos and Power Cost.
9. Card-effect completion: finish unparsed and parsed-but-partial effects, especially replacement/continuous modifiers, deck ordering, broader timing windows, and complex selected-count follow-ups.
10. Persistence hardening: ✅ DONE — api-smoke.ts tests, HMAC token signing, backup/restore docs in DEPLOYMENT.md.

## Verification / 驗證

Use these after game, online, or backend changes:

```bash
npm run smoke
npm run build
npm run smoke:online
npm run rule:audit
```

For API changes, also test the affected endpoint against `api/server.cjs` and verify the SQLite schema migration path on an existing database.
