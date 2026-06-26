# Non-card-effect gaps for follow-up agents

This document intentionally excludes card text parser/executor work. Do not use it as a card-effect backlog. Card effects are tracked separately in `RULE_GAP_AUDIT.md` and `npm run rule:audit`.

## Current verified baseline

As of 2026-06-26:

- Core simultaneous state machine: `janken → mulligan → initialSet → turnSet → effectOrder → turnSet/gameOver`.
- Local two-player, AI (Easy/Normal/Hard), and boardgame.io online rooms work.
- `playerView` hides opponent hands, decks, face-down set cards, and unpaired janken choices.
- Online rooms receive validated browser-saved custom deck payloads through boardgame.io `setupData`.
- 422 cards loaded, 250 with effect text (97% parser coverage).
- 6 UI languages: zh-TW, zh-HK, zh-CN, ja, en, ko.
- Docker Compose deploys two services: `game` (port 3000) and `api` (port 3001).
- API server (Express + SQLite) provides accounts, deck CRUD, match results, and leaderboard.
- Chronos mapping verified against official rules (12 positions, midnight=0, noon=6).
- Online reconnect/resume UX implemented.
- Leaderboard page integrated.
- Admin panel with card data viewer and i18n management.

## Architecture

```
Frontend (Vite + React + TypeScript + React Router)
├── /             → Lobby
├── /play/local   → Local 2-player
├── /play/ai      → AI practice
├── /play/online  → Online multiplayer
├── /deck-builder → Deck editor
├── /history      → Match history
├── /leaderboard  → Leaderboard
└── /admin        → Admin panel (password protected)

Game server (boardgame.io, port 3000)
├── /games/*      → boardgame.io API
├── /api/*        → Proxy to API server
└── Static files  → dist/, admin/, data/

API server (Express + SQLite, port 3001)
├── /api/register, /api/login, /api/profile
├── /api/decks (CRUD)
├── /api/matches
└── /api/leaderboard
```

## Scope definition

Non-card-effect work means:

- base game rules and official rule-model verification;
- online room lifecycle and reconnect/resume behavior;
- account/match/deck persistence outside individual browser localStorage;
- replay/action-log/dispute tooling;
- documentation and tests for the above.

Out of scope for this document:

- parsing or executing `cards.json.effect` text;
- adding new card-specific pending choices;
- Area Enchant expiry or timing windows when the purpose is to execute a card effect;
- continuous/replacement modifiers that only exist because of specific card effects.

---

## Priority 1 — Confirm exact Chronos board mapping ✅ DONE

**Status**: Completed 2026-06-26.

`CHRONOS_MAPPING` constant in `src/game/types.ts`:
- 12 positions, midnight=0, noon=6
- Night: [0,1,2,3,10,11], Day: [4,5,6,7,8,9]
- Clockwise direction, wraps at position 12

Verified against official Start Guide at zutomayocard.net/start-guide/.

Code paths: `src/game/types.ts`, `src/game/chronos.ts`, `src/game/GameLogic.ts`, `src/components/Chronos.tsx`

---

## Priority 2 — Reconnect / resume UX for online rooms ✅ DONE

**Status**: Completed 2026-06-26.

`src/onlineSession.ts` stores matchID, playerID, playerCredentials in localStorage.
`src/pages/OnlineGamePage.tsx` checks for stored session on mount and offers rejoin.
`src/server.ts` has `/games/:name/:id/resume` endpoint for credential verification.

UI states: reconnecting, disconnected retrying, room gone, seat taken, resumed successfully.

---

## Priority 3 — Server-side deck storage and cross-device deck sync ⚠️ API DONE, FRONTEND PENDING

**Status**: API endpoints exist (`/api/decks` CRUD). Frontend deck editor still uses localStorage. Not wired together.

**What exists**:
- `api/server.cjs`: POST/GET/DELETE `/api/decks` with validation (20 cards, max 2 copies)
- `src/api/client.ts`: `getDecks()`, `createDeck()`, `deleteDeck()` functions
- Deck validation logic in `src/game/cards/deckBuilder.ts`

**What's missing**:
- Deck editor UI does not call API when logged in
- No login check before deck save/load
- No migration flow for existing localStorage decks
- Online room setup does not use server-stored deck IDs

**Required work**:
1. In deck editor, check if logged in → save to server via `createDeck()`
2. Load decks from server when logged in, localStorage as fallback
3. Show server-saved decks in deck selector
4. Validate deck card IDs server-side on every save
5. Add import flow for existing localStorage decks

---

## Priority 4 — Authenticated match ownership ⚠️ API DONE, FRONTEND PENDING

**Status**: API endpoints exist. No login/register UI in the frontend.

**What exists**:
- `api/server.cjs`: POST `/api/register`, POST `/api/login`, GET `/api/profile`
- JWT token creation and verification
- `src/api/client.ts`: `register()`, `login()`, `logout()`, `isLoggedIn()`, `getProfile()`

**What's missing**:
- No login/register form in the lobby
- No user badge (nickname + ELO) display
- No logout button
- Token lifecycle not integrated into app state
- Match results not submitted to server on game over

**Required work**:
1. Add login/register section in lobby (inline form or modal)
2. Show user badge when logged in, "Guest" when not
3. Add logout button
4. On game over, if logged in → submit to `/api/matches`
5. Display ELO changes after match
6. Keep localStorage history as fallback for guests

---

## Priority 5 — Server leaderboard and cross-device match history ✅ DONE

**Status**: Completed 2026-06-26.

- `LeaderboardPage.tsx` fetches from `/api/leaderboard`
- Route `/leaderboard` registered
- Lobby nav has "🏆 排行" button
- API server stores match results with ELO calculation

**Remaining**: Match submission on game over is not yet wired (depends on P4 frontend).

---

## Priority 6 — Action log / replay for disputes and debugging ❌ NOT STARTED

**Problem**: The current `G.log` is not a full authoritative replay. Online disputes need server-side action traces.

**Required work**:
1. Define recorded fields: move name, acting player, sanitized payload, turn/step before/after, game-over result
2. Do NOT record hidden information (opponent hand, deck order)
3. Store action trace server-side per match
4. Provide developer export for debugging
5. Add smoke test that replays a short deterministic match

**Code paths**: `src/game/GameLogic.ts`, boardgame.io move definitions, `src/server.ts`

---

## Priority 7 — Product polish around online room lifecycle ⚠️ PARTIAL

**Done**:
- Reconnect/resume UX (P2)
- Clear error for room gone / seat taken

**Not done**:
- Room invite/share link clarity
- Waiting-for-opponent state UI
- Stale-room cleanup policy
- Browser-tab close/abandon handling
- Reconnect timer and retry affordance
- Full room error handling

---

## Suggested order for remaining work

1. **P4 frontend** — Login/register UI in lobby. Unblocks P3 and P5 integration.
2. **P3 frontend** — Wire deck editor to API when logged in.
3. **P5 completion** — Submit match results on game over (depends on P4).
4. **P6** — Action log/replay. Can be done independently.
5. **P7** — Online room UX polish. Can be done independently.

## Standard verification commands

```bash
npm run smoke
npm run build
npm run smoke:online
```

If a change touches hidden information, also inspect `playerView` redaction. If a change touches persistence or server APIs, add a targeted smoke/integration test.
