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
| 8 | Account system | API done; frontend pending | `/api/register`, `/api/login`, and `/api/profile` exist. Login/profile UI and account-aware app state are not wired into React routes yet. |
| 9 | Match history and leaderboard | API done; frontend pending | Browser-local match history exists. `/api/matches` and `/api/leaderboard` exist, but match submission, profile history, and leaderboard UI integration are pending. |
| 10 | AI practice | Basic done; hard lookahead pending | Easy/Normal/Hard levels are available. Hard currently uses heuristics and known-board checks, not deeper simulation/lookahead. |
| 11 | Backend and deployment | Done | Docker Compose runs `game` on `3000` and `api` on `3001`; API persists to SQLite. |

## Current Baseline / 目前基準

- Frontend: Vite + React + TypeScript + React Router.
- Game server: [src/server.ts](/private/tmp/zc-docs/src/server.ts), boardgame.io, port `3000`.
- API server: [api/server.cjs](/private/tmp/zc-docs/api/server.cjs), Node HTTP + SQLite via `better-sqlite3`, port `3001`.
- Deployment target: Docker Compose on Debian 12 host `149.104.6.238`.
- Card audit from `npm run rule:audit`: 422 total cards, 250 effect cards, 267 effect lines, 238 parsed lines, 29 unparsed lines, 49 parsed-but-partial lines.

## Remaining Work / 待辦

From [NON_CARD_GAPS.md](NON_CARD_GAPS.md), adjusted for the current implementation state:

1. Account frontend integration: add register/login/logout/profile UI, token lifecycle handling, and account-aware navigation.
2. Server-backed deck sync: connect the deck editor to authenticated deck CRUD while preserving browser-local decks as an offline fallback.
3. Match result integration: submit completed online matches to `/api/matches` without leaking hidden state or trusting unauthenticated client claims.
4. Leaderboard/profile UI: expose `/api/leaderboard` and user ELO/profile stats in the React app.
5. Authenticated match ownership: associate boardgame.io seats/matches with users if account-based resume and ownership become product requirements.
6. Action log/replay: add an authoritative sanitized move trace for debugging and disputes; do not rely on human-readable `G.log` alone.
7. Online lifecycle polish: improve invite/share links, full-room errors, waiting-for-opponent states, stale-room cleanup, and abandon handling.
8. Hard AI lookahead: add deterministic simulation/evaluation for Hard mode beyond the current heuristic picker.
9. Card-effect completion: finish unparsed and parsed-but-partial effects, especially replacement/continuous modifiers, deck ordering, broader timing windows, and complex selected-count follow-ups.
10. Persistence hardening: add API tests, validate deck card IDs server-side, define token/signing semantics, and document backup/restore for SQLite data.

## Verification / 驗證

Use these after game, online, or backend changes:

```bash
npm run smoke
npm run build
npm run smoke:online
npm run rule:audit
```

For API changes, also test the affected endpoint against `api/server.cjs` and verify the SQLite schema migration path on an existing database.
