# Remaining gaps after latest development pass

Last checked: 2026-06-26

Verification baseline:

- Git branch is clean and synchronized with `origin/master` at the time this document was written.
- `npm run rule:audit` reports:
  - total cards: 422
  - effect cards: 250
  - effect lines: 267
  - parsed lines: 267
  - runtime parsed effects: 288
  - unparsed lines: 0
  - parsed-but-partial heuristic: 0
  - false draw positives: 0

Important caveat: `rule:audit` confirms parser/executor coverage, not perfect semantic equivalence to every physical-card edge case. Continue using smoke regressions for card-specific behavior changes.

## 1. Non-card / product gaps

Most non-card core work is now done:

- Chronos official mapping: done.
- Online reconnect/resume: done.
- API server with SQLite persistence: done.
- API endpoints for accounts, decks, matches, and leaderboard: exist.
- Leaderboard route/page: exists.
- Server deck save/load helpers: exist.
- Hard AI lookahead / persistence hardening: done in `PLAN.md`.

Current Section 1 status:

### 1.1 Account frontend integration

Status: DONE

- `src/pages/LobbyPage.tsx` includes `AuthSection` with login, register, logout, and profile display.
- API routes exist in `api/server.cjs`.
- Guest mode remains available because auth is optional and local deck fallback is preserved.

### 1.2 Account-aware deck sync closure

Status: DONE

- `DeckEditorPage` saves to server via `createDeck()` when `isLoggedIn()` is true.
- `App` loads server decks via `getDecks()`.
- Lobby deck selection separates local and server deck groups.
- Local storage fallback remains available for guests.

### 1.3 Match result submission and ELO closure

Status: DONE

- `src/components/Board.tsx` calls `submitMatch()` once on game over when an authenticated account is available.
- API server has match/leaderboard support.
- Leaderboard page exists.
- Submitted action logs are sanitized server-side before storage.
- ELO change feedback is shown on the game-over screen.

### 1.4 Authenticated match ownership

Status: DONE for reconnect credentials; account-bound ownership is not currently product scope.

- boardgame.io player credentials are preserved for reconnect/resume.
- `playerCredentials` are stored in the online session and reused by online pages/components.
- Guest rooms remain possible.

### 1.5 Online lifecycle polish ✅ DONE

Status: PARTIAL

- Reconnect/resume is implemented.
- Full-room and missing-room errors are mapped to user-facing messages.
- Waiting-for-opponent and reconnect affordances exist, but can still be polished.

Remaining:

- Invite/share link flow needs final product polish.
- ✅ Stale-room cleanup (30min TTL, 5min interval)is not implemented.
- ✅ Browser close confirmation (beforeunload)remains incomplete.

### 1.6 Documentation consistency

Status: DONE for the current Section 1 pass.

- `PLAN.md` no longer has a conflicting Hard AI table row.
- This Section 1 now reflects the implemented account UI, deck sync, match submission, reconnect credentials, and remaining online lifecycle gaps.

## 2. Card-effect gaps

Card-effect parser/executor coverage is currently complete by `npm run rule:audit`.

### 2.1 Completely unparsed effect lines ✅ DONE (0 remaining)

No effect lines currently return `null` from the live parser audit.

### 2.2 High-value implementation slices ✅ DONE

The previously listed high-value slices are implemented and covered by smoke/audit checks. Future card work should be treated as semantic refinement only, with one card-specific regression per behavior change.

### 2.3 Parsed-but-partial audit queue ✅ DONE (0 remaining)

`npm run rule:audit` currently flags 0 parsed-but-partial lines.

## 3. Standard verification

After each slice:

```bash
npm run smoke
npm run build
npm run smoke:online
npm run rule:audit
git diff --check
```

For hidden-information changes, also inspect or test `playerView` redaction.

For API/persistence changes, add targeted API smoke tests and verify SQLite migration behavior on an existing database.
