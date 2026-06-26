# Non-card-effect gaps for follow-up agents

This document intentionally excludes card text parser/executor work. Do not use it as a card-effect backlog. Card effects are tracked separately in `RULE_GAP_AUDIT.md` and `npm run rule:audit`.

Current verified baseline:

- Core simultaneous state machine exists: `janken → mulligan → initialSet → turnSet → effectOrder → turnSet/gameOver`.
- Local two-player, AI, and boardgame.io online rooms work.
- `playerView` already hides opponent hands, decks, face-down set cards, and unpaired janken choices.
- Online rooms can receive validated browser-saved custom deck payloads through boardgame.io `setupData`.
- Match history is browser-local only.
- The working tree may contain uncommitted card-effect work. Avoid mixing unrelated non-card changes into that diff unless explicitly asked.

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

## Priority 1 — Confirm exact Chronos board mapping

Problem:

The implementation uses a 12-position Chronos model and current day/night calculation. The Obsidian notes still say the official guide/PDF should be checked for exact Chronos board structure and day/night coverage. If the official board has different boundaries, core combat and effect priority can be wrong even when card effects are ignored.

Relevant sources:

- `/Users/danersaka/Documents/Obsidian Vault/Zutomayo Card/Zutomayo Card 遊戲規則.md`
- `/Users/danersaka/Documents/Obsidian Vault/Zutomayo Card/ZUTOMAYO CARD 規則整理與線上對戰可行性.md`
- Official Start Guide: `https://zutomayocard.net/start-guide/`
- Official Rule Guide PDF listed in the Obsidian notes.

Likely code paths:

- `src/game/GameLogic.ts`
- `src/components/Chronos.tsx`
- `src/game/types.ts`
- smoke tests in `scripts/game-smoke.ts`

Required work:

1. Extract the exact official Chronos positions, including:
   - total number of discrete positions;
   - midnight/noon positions;
   - which positions are night vs day;
   - direction of movement;
   - behavior when advancing past the end of the track.
2. Encode this mapping as data instead of scattering assumptions.
3. Update `getChronosTime` / display logic only if the official mapping differs.
4. Add deterministic tests for every Chronos position.
5. Keep existing `midnightRange` behavior tested against the new mapping.

Acceptance checks:

- `npm run smoke`
- `npm run build`
- Existing online smoke still passes: `npm run smoke:online`
- Tests prove every position maps to the expected official day/night side.
- Documentation states the official source used and the confirmed mapping.

Do not:

- change card-effect logic while doing this;
- guess the board from current implementation;
- rely only on visual appearance without recording the source.

## Priority 2 — Reconnect / resume UX for online rooms

Problem:

Online boardgame.io rooms work, but the product still lacks a robust reconnect/resume UX. If a browser reloads, loses connection, or the tab sleeps, the player experience can become unclear even if the server still has the match.

Relevant code paths:

- `src/App.tsx`
- `src/server.ts`
- boardgame.io client setup code
- any lobby / room creation UI
- `scripts/online-smoke.ts`

Required work:

1. Identify how match ID, player ID, and player credentials are currently stored and restored.
2. Preserve enough local session data to rejoin the same room after refresh.
3. Add a clear UI state for:
   - reconnecting;
   - disconnected but retrying;
   - reconnect failed / room no longer exists;
   - rejoined successfully.
4. Prevent users from accidentally joining as the wrong seat after refresh.
5. Add an online smoke or integration test for refresh/rejoin if feasible.

Acceptance checks:

- Create online room, make progress, refresh one client, resume same seat.
- Refresh does not expose opponent hidden information.
- Losing credentials or invalid credentials produces a clear user-facing error.
- `npm run smoke`
- `npm run build`
- `npm run smoke:online`

Do not:

- reintroduce full accounts unless separately requested;
- store secrets beyond boardgame.io player credentials needed for the room;
- bypass `playerView` filtering.

## Priority 3 — Server-side deck storage and cross-device deck sync

Problem:

Deck editor/deck selection currently depends on browser-local state. Online rooms can receive custom deck payloads, but there is no server-backed deck library. This means custom decks do not sync across devices and cannot be reliably reused from another browser.

Relevant code paths:

- deck editor components under `src/components/`
- deck validation / setupData code under `src/game/`
- `src/server.ts`
- local storage helpers, if any

Required work:

1. Decide persistence shape for saved decks:
   - anonymous local server storage;
   - account-bound storage if accounts return later;
   - import/export-only fallback.
2. Add server API for deck CRUD only if the project direction wants server persistence.
3. Reuse existing constructed-deck validation on every server write and every match setup.
4. Keep browser localStorage decks working as offline/local fallback.
5. Add migration/import flow if existing local decks should be uploaded.

Acceptance checks:

- A deck saved in browser A can be loaded from browser B when using the same persistence identity.
- Invalid decks are rejected server-side.
- Online room setup can use a server-stored deck ID without trusting the client blindly.
- `npm run smoke`
- `npm run build`
- `npm run smoke:online`

Do not:

- trust client-only validation;
- make card-effect changes;
- add a database dependency without confirming the persistence direction.

## Priority 4 — Authenticated match ownership, if accounts return

Problem:

The current project intentionally does not have deployed accounts. If accounts are reintroduced, matches and decks need ownership semantics so users can resume or manage their own resources across devices.

Relevant code paths:

- `src/server.ts`
- lobby / room creation UI
- any future auth module
- deck persistence from Priority 3

Required work:

1. Decide whether accounts are actually in scope. Do not implement auth speculatively.
2. If in scope, define minimal ownership model:
   - user owns saved decks;
   - user can list own active/recent matches;
   - user can resume only seats they own;
   - spectators, if any, get redacted state.
3. Store match ownership metadata outside transient browser state.
4. Ensure boardgame.io `playerCredentials` are not discarded.

Acceptance checks:

- User A cannot resume User B's player seat.
- User can list and resume own active match.
- Hidden information remains filtered for all non-owning viewers.
- `npm run smoke`
- `npm run build`
- `npm run smoke:online`

Do not:

- add login/account UI unless explicitly requested;
- weaken room credentials;
- conflate this with card-effect automation.

## Priority 5 — Server leaderboard and cross-device match history

Problem:

Match history is stored only in the current browser. There is no server-side match archive, leaderboard, or cross-device history.

Relevant code paths:

- `src/game/matchHistory.ts`
- `src/components/MatchHistory.tsx`
- `src/server.ts`
- boardgame.io end-of-game flow

Required work:

1. Decide whether server history is desired for anonymous rooms or account-owned rooms only.
2. Define a small match result record:
   - match ID;
   - players / display names if available;
   - winner;
   - reason;
   - turn count;
   - timestamps;
   - deck IDs if available, not full hidden deck contents unless needed.
3. Write result server-side at game end.
4. Add API/UI for recent results and optional leaderboard.
5. Keep current browser-local history as fallback if server history is not configured.

Acceptance checks:

- Completing an online match writes one server-side result record.
- Refreshing or using another browser can read server history when configured.
- Local-only mode still works.
- `npm run smoke`
- `npm run build`
- `npm run smoke:online`

Do not:

- expose hidden card order or private hands in public match history;
- build rankings before deciding identity/account model.

## Priority 6 — Action log / replay for disputes and debugging

Problem:

The current UI/game log is not a full authoritative replay. For online play, disputes and debugging need a server-side action trace or replay artifact.

Relevant code paths:

- `src/game/GameLogic.ts`
- boardgame.io move definitions
- `src/server.ts`
- `scripts/online-smoke.ts`

Required work:

1. Define what must be recorded:
   - move name;
   - acting player;
   - sanitized payload;
   - turn/step before and after;
   - deterministic random/shuffle context if needed;
   - game-over result.
2. Avoid recording hidden information in any public-facing log.
3. Provide developer export for a match replay/debug package.
4. Add a test or smoke helper that can replay a short deterministic match, if feasible.

Acceptance checks:

- A completed online smoke match produces a usable server-side or exported action trace.
- Trace is enough to diagnose move order and state transitions.
- Trace does not leak opponent hidden hand/deck information to the wrong client.
- `npm run smoke`
- `npm run build`
- `npm run smoke:online`

Do not:

- rely on human-readable `G.log` alone as authoritative replay;
- include raw hidden state in client-visible logs.

## Priority 7 — Product polish around online room lifecycle

Problem:

The core online path works, but the product lacks robust lifecycle UX around real play sessions.

Potential work:

- room invite/share link clarity;
- seat selection and seat lock feedback;
- clear errors for full room / missing match / invalid credentials;
- explicit waiting-for-opponent state;
- stale-room cleanup policy;
- browser-tab close / abandon handling;
- reconnect timer and retry affordance.

Acceptance checks:

- User can create room, share link, join from second browser, play, refresh, and understand every state.
- Full/invalid/expired rooms produce clear messages.
- Existing local play and AI play are unaffected.
- `npm run smoke`
- `npm run build`
- `npm run smoke:online`

## Suggested order for another agent

1. Chronos exactness verification first. It is the only remaining non-card core-rule uncertainty.
2. Reconnect/resume UX next. It improves real online usability without requiring accounts.
3. Server deck storage only after deciding persistence scope.
4. Match ownership/accounts only if explicitly requested.
5. Server match history/leaderboard after identity and storage decisions.
6. Action log/replay can be done independently for debugging, but must avoid hidden-info leaks.

## Standard verification commands

Run these after any non-card change:

```bash
npm run smoke
npm run build
npm run smoke:online
```

If a change touches hidden information, also manually inspect or add tests for `playerView` redaction. If a change touches persistence or server APIs, add a targeted smoke/integration test rather than relying only on the build.
