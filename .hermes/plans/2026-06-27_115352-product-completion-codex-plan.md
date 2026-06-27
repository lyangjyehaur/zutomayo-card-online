# ZUTOMAYO CARD Product Completion Codex Plan

> **For Hermes:** Use `codex-workflow` to execute this plan in isolated git worktrees, one phase at a time. Use Codex for implementation, then verify in the main repo before reporting done.

**Goal:** Finish the five post-rule-engine product areas: online room UX, structured replay/logs, admin rule inspector, battle UI polish, and account/deck/ranking integration verification.

**Architecture:** Keep the rule engine stable. Treat the current rules/effects implementation as baseline; do not rewrite parser/executor unless a regression test proves a product flow requires it. Build UX and observability around existing `GameState`, `actionLog`, `pendingChoice`, boardgame.io rooms, and the Express/SQLite API.

**Tech Stack:** Vite + React + TypeScript + React Router + boardgame.io + Socket.IO + Express/SQLite API. Styling is existing CSS, no new UI library unless explicitly approved.

---

## Preflight / Working Tree Rules

Before starting Codex implementation:

1. Resolve the current dirty tree first.
   - Current rule/effect review changes include:
     - `src/game/GameLogic.ts`
     - `src/game/effects/executor.ts`
     - `scripts/game-smoke.ts`
     - `PLAN.md`
     - `rules.md`
     - `CARD_EFFECT_AUDIT_FINAL.md`
   - Do not start a Codex worktree from stale `HEAD` if these changes are still uncommitted, or the new worktree will miss the rule fixes.

2. For each phase, use a separate worktree:

```bash
git worktree add -b feat/<phase-slug> /tmp/zc-<phase-slug> HEAD
cd /tmp/zc-<phase-slug>
npm install
codex exec -m gpt-5.5 --sandbox workspace-write - < /tmp/codex-prompt-<phase-slug>.md
```

3. After Codex finishes, always run in the worktree first:

```bash
npm run typecheck
npm run smoke
npm run rule:audit
npm run build
```

4. If UI changed, also run browser verification in the main repo after copying changes back.

5. Copy back both tracked and untracked files:

```bash
cd /tmp/zc-<phase-slug> && {
  git diff --name-only HEAD
  git ls-files --others --exclude-standard
} | sort -u | while read f; do
  mkdir -p "$(dirname /Users/danersaka/Projects/zutomayo-card-online/$f)"
  cp "$f" "/Users/danersaka/Projects/zutomayo-card-online/$f"
done
```

6. Verify again in main repo:

```bash
cd /Users/danersaka/Projects/zutomayo-card-online
npm run typecheck
npm run smoke
npm run rule:audit
npm run build
```

7. For phases with online/API changes, also run:

```bash
npm run smoke:online
cd api && npm install
node ../scripts/api-smoke.ts
```

If `scripts/api-smoke.ts` does not run from `api/`, use the project’s existing documented API smoke command instead.

---

## Phase 1 — Online Room UX and Match Lifecycle

**Goal:** Make online play feel like a complete product: clear room states, sharing, reconnect, opponent leave/timeout, game-over actions, and rematch/back-to-lobby flow.

**Primary files:**
- `src/pages/LobbyPage.tsx`
- `src/pages/OnlineGamePage.tsx`
- `src/components/OnlineGame.tsx`
- `src/components/Board.tsx`
- `src/onlineSession.ts`
- `src/i18n/{zh-TW,zh-HK,zh-CN,ja,en,ko}.ts`
- CSS files used by lobby/online/game screens, likely `src/App.css` or component CSS
- Tests/smoke: `scripts/online-smoke.ts`, `scripts/game-smoke.ts` if needed

### Task 1.1: Inventory existing online states

**Objective:** Make Codex inspect current room/session flow before modifying UI.

**Instructions for Codex:**
- Read `src/pages/LobbyPage.tsx`, `src/pages/OnlineGamePage.tsx`, `src/components/OnlineGame.tsx`, `src/onlineSession.ts`, and `scripts/online-smoke.ts`.
- Write a short internal note in the Codex final output listing existing states and missing states.
- Do not modify code in this task unless required by later tasks.

**Acceptance:** Codex can identify current statuses: reconnecting, retrying, waiting, ready, roomNotFound, roomFull, connectionFailed, disconnected/rejoined.

### Task 1.2: Improve room creation / sharing UX

**Objective:** The host can create a room, copy/share link, see waiting status, and understand what happens next.

**Changes required:**
- In `LobbyPage.tsx` and `OnlineGamePage.tsx`, unify duplicate room-info/share-link UI into a reusable component if practical, e.g. `src/components/OnlineRoomInfo.tsx`.
- Add explicit helper text:
  - Host waiting for opponent
  - Opponent joined / game starting
  - Copy success feedback
  - Link can be reopened for reconnect
- Add i18n keys for all 6 languages. Keep wording concise; Chinese can be direct, English simple.

**Verification:**
- `npm run typecheck`
- Browser: create online room from lobby; verify room code, share link, copy feedback, waiting message.

### Task 1.3: Add robust error panels for room lifecycle

**Objective:** Room not found/full/network failure should show distinct actions, not generic failure.

**Changes required:**
- In `OnlineGamePage.tsx`, for `roomNotFound`, `roomFull`, `connectionFailed`, render a panel with:
  - Title
  - Explanation
  - Primary action: back to lobby
  - Secondary action: retry / create new room when appropriate
- Do not silently clear session except where current validation proves credentials are invalid or room is gone.

**Verification:**
- Extend `scripts/online-smoke.ts` if it already mocks these cases; otherwise add focused smoke around helpers/status mapping.
- Manual browser route to invalid `/play/online/not-a-real-room` should show room-not-found panel.

### Task 1.4: Opponent disconnect / leave / timeout feedback

**Objective:** Player should know whether the opponent is temporarily reconnecting or has abandoned.

**Changes required:**
- Investigate boardgame.io availability of `ctx.activePlayers`, match metadata, or connection status exposed to client.
- If reliable server-side leave/abandon is not easy, implement minimal client-visible lifecycle:
  - Keep current reconnect/disconnected banner.
  - Add leave confirmation modal for online games.
  - On explicit leave, call existing `/leave`, clear local session, return lobby.
  - If opponent missing cannot be reliably detected, document this as pending in `PLAN.md` rather than faking detection.

**Acceptance:** No misleading “opponent left” if the code cannot actually know. Prefer honest reconnecting/waiting text.

### Task 1.5: Game-over online actions

**Objective:** End of online match should have clear next actions.

**Changes required:**
- In `Board.tsx` `GameOverScreen`, replace `window.location.reload()` for online games with:
  - Back to lobby
  - Copy/share rematch instruction or Create new room (if available via prop)
- Avoid unsafe reload loops.
- Keep local/AI play-again behavior working.

**Verification:**
- `npm run smoke:online`
- Browser: complete or force a game-over path and verify actions.

### Phase 1 Codex prompt skeleton

```markdown
# Phase 1: Online Room UX and Match Lifecycle

Implement Phase 1 from .hermes/plans/2026-06-27_115352-product-completion-codex-plan.md.

Constraints:
- Do not modify rule parser/executor unless a failing smoke proves it is necessary.
- Preserve current online session validation behavior.
- Add all new UI strings to all 6 i18n files.
- Must pass: npm run typecheck && npm run smoke && npm run smoke:online && npm run build.
- Keep UI full-screen/no-scroll where current game UI expects it.
```

---

## Phase 2 — Structured Action Log, Replay, and Match Trace

**Goal:** Make each match explainable and replayable enough for debugging/disputes, without relying on human-readable `G.log` alone.

**Primary files:**
- `src/game/types.ts`
- `src/game/GameLogic.ts`
- `src/game/matchHistory.ts`
- `src/pages/MatchHistoryPage.tsx`
- `src/components/MatchHistory.tsx`
- `src/components/Board.tsx`
- `src/api/client.ts`
- `api/server.cjs`
- `docs/API.md`
- `scripts/game-smoke.ts`
- `scripts/api-smoke.ts`

### Task 2.1: Define structured trace schema

**Objective:** Upgrade `ActionLogEntry` into a useful trace format while staying backward-compatible.

**Recommended schema additions:**
- `id` or deterministic sequence number
- `turn`
- `step`
- `player`
- `action`
- `payload`
- `timestamp`
- Optional `result`:
  - `ok: boolean`
  - `message?: string`
- Optional public context snapshot:
  - `chronosPosition`
  - `hp: [number, number]`
  - `pendingEffectCardDefId?`
  - `pendingChoiceType?`

**Do not include hidden data:**
- Opponent hand contents
- Deck order
- Face-down card IDs before reveal

### Task 2.2: Record effect resolution and choices explicitly

**Objective:** Trace should show what effect/choice happened, not just player clicked index.

**Changes required:**
- In `GameLogic.ts`, add trace entries for:
  - `resolvePendingEffect`: cardDefId, rawText/effect summary, source, result message
  - `submitPendingChoice`: choice type, selected option IDs only if public-safe; otherwise selected count/type
  - game-over reason
- Keep sanitization in `api/server.cjs` aligned with new fields.

**Regression:**
- Extend `scripts/game-smoke.ts` to assert trace entries exist after resolving pending effect and submitting a choice.

### Task 2.3: Match history detail viewer

**Objective:** User can open a past match and see turn-by-turn trace.

**Changes required:**
- Add detail modal/page in `MatchHistoryPage.tsx` or `MatchHistory.tsx`.
- Show:
  - winner/draw
  - duration/turns
  - final HP / Chronos
  - action trace grouped by turn
  - download JSON button using existing `downloadMatchActionLog`
- Keep old localStorage records readable.

### Task 2.4: API match log roundtrip

**Objective:** Server-stored matches retain sanitized trace.

**Changes required:**
- Update `api/server.cjs` sanitizer to accept new safe fields.
- Update `docs/API.md` for match log shape.
- Extend `scripts/api-smoke.ts` to submit a match with actionLog and fetch `/matches/:id/log`.

### Task 2.5: Optional replay stub, not full deterministic replay yet

**Objective:** Avoid overbuilding.

**Decision:** For this phase, build “trace viewer” not full state replay. Full deterministic replay can be Phase 2B after trace quality is proven.

**Acceptance:** User can understand what happened turn by turn; no promise of step-through replay unless implemented and tested.

### Phase 2 Codex prompt skeleton

```markdown
# Phase 2: Structured Action Log and Match Trace

Implement Phase 2 from .hermes/plans/2026-06-27_115352-product-completion-codex-plan.md.

Constraints:
- Preserve hidden information. Do not log opponent hand/deck contents before they are public.
- Keep old match records readable.
- Do not attempt full deterministic replay in this phase.
- Must update API sanitizer and docs if actionLog shape changes.
- Must pass: npm run typecheck && npm run smoke && npm run build; run API smoke if API touched.
```

---

## Phase 3 — Admin Rule/Effect Inspector

**Goal:** Turn admin from card browser into a rule-engine inspection tool: original effect text, parsed AST, runtime action categories, filters, and audit status.

**Primary files:**
- `src/pages/AdminPage.tsx`
- `src/components/AdminPanel.css`
- `src/game/effects/parser.ts`
- `src/game/effects/index.ts`
- `src/game/cards/loader.ts`
- `scripts/rule-audit.ts` for reference only
- i18n files if admin becomes localized; currently admin text is mostly hardcoded Chinese

### Task 3.1: Parse effect in admin modal

**Objective:** Selected card modal shows parser output for effect cards.

**Changes required:**
- Import parser helpers safely in `AdminPage.tsx`.
- For `selectedCard.effect`, show:
  - Original Japanese effect
  - Parsed effects count
  - Trigger(s)
  - Conditions summary
  - Action type(s)
  - Pretty JSON toggle for full AST
- For no-effect cards, show “無效果”.

**Acceptance:** No crash on cards with blank effect; no huge always-open JSON block.

### Task 3.2: Add engine filters

**Objective:** Admin can find cards by engine behavior.

**Filters:**
- trigger: onUse, onTurnEnd, onDamageReceived, onChronosChanged, onZoneEntered, onBattle
- action type text search
- condition type text search
- pendingChoice only
- Area Enchant expiry only

**Implementation guidance:**
- Precompute parsed metadata in `useMemo` for all cards.
- Avoid reparsing on every keystroke if expensive.

### Task 3.3: Add audit summary dashboard

**Objective:** Admin top panel shows coverage numbers in-app.

**Display:**
- total cards
- effect cards
- parsed lines
- unparsed lines count
- parsed-but-partial count
- runtime parsed effects count

**Implementation options:**
- Preferred: add a lightweight shared utility used by `scripts/rule-audit.ts` and admin.
- Avoid duplicating complex parser audit logic if it is easy to extract.

### Task 3.4: Improve modal readability

**Objective:** Make AST useful, not ugly.

**UI:**
- Two-column layout: card image/stats left, effect inspector right
- Badges for trigger/action/condition
- Collapsible JSON details
- Copy AST JSON button

**Verification:**
- Browser admin `/admin`, open cards:
  - 3rd_8
  - 4th_89
  - 4th_33
  - no-effect Character
- Confirm AST summaries match card effects.

### Phase 3 Codex prompt skeleton

```markdown
# Phase 3: Admin Rule/Effect Inspector

Implement Phase 3 from .hermes/plans/2026-06-27_115352-product-completion-codex-plan.md.

Constraints:
- Do not modify parser semantics unless tests prove a bug.
- Admin password gate must stay intact.
- Keep admin UI embedded in the main app; no external route/window.
- Must pass: npm run typecheck && npm run smoke && npm run rule:audit && npm run build.
- Browser verify /admin card modal and filters.
```

---

## Phase 4 — Battle UI/UX Final Polish

**Goal:** Make the actual match screen feel understandable at every step: phase, required action, pending choices, effect resolution, damage, and results.

**Primary files:**
- `src/components/Board.tsx`
- `src/components/Card.tsx`
- `src/components/Chronos.tsx`
- CSS used by game board
- `src/i18n/{zh-TW,zh-HK,zh-CN,ja,en,ko}.ts`
- `src/game/types.ts` only if UI needs safe metadata additions

### Task 4.1: Phase instruction bar

**Objective:** At any step, the current player knows exactly what to do.

**States to cover:**
- janken
- mulligan
- initialSet
- turnSet
- effectOrder
- pendingChoice
- battle/result/gameOver
- waiting for opponent

**UI:**
- One persistent phase bar near top of board.
- Short title + 1-line instruction.
- Show required set count and currently set count where relevant.

### Task 4.2: Pending effect order UI cleanup

**Objective:** Effect order selection should be card/effect-oriented, not index-oriented.

**Changes required:**
- Show card name, source zone, raw effect text/action summary.
- Disable invalid same-card out-of-order options visually, matching current logic.
- If waiting for opponent, show who is choosing and why.

### Task 4.3: Pending choice UI cleanup

**Objective:** Card choices should be obvious and safe.

**Changes required:**
- Show min/max selection count.
- Show selected count.
- Disable submit until valid.
- Explain destination/effect: e.g. “選 2 張手牌放到牌庫底，然後抽 2 張”.
- Hidden-info: when choosing from opponent hand reveal mechanics, only show what player is allowed to see.

### Task 4.4: Battle feedback animation/highlight

**Objective:** After battle/effects, players can see what changed.

**Minimal implementation:**
- Highlight HP changed this turn.
- Show last damage amount / heal amount from log or derived state if available.
- Highlight Chronos movement after advance.
- Highlight cards newly moved to Power Charger/Abyss if easy from trace; otherwise do not fake it.

### Task 4.5: Responsive no-scroll pass

**Objective:** Keep the user’s UI preference: full-screen, responsive, no accidental overflow.

**Checks:**
- Desktop 1440x900
- Laptop 1280x800
- Mobile portrait 390x844
- Mobile landscape if practical

**Verification:**
- Browser screenshots before/after.
- No horizontal scroll.
- Main game controls remain reachable.

### Phase 4 Codex prompt skeleton

```markdown
# Phase 4: Battle UI/UX Final Polish

Implement Phase 4 from .hermes/plans/2026-06-27_115352-product-completion-codex-plan.md.

Constraints:
- Full-screen/no-scroll game UI is mandatory.
- Do not introduce fake state. If UI cannot reliably know an event, omit the claim.
- Add all visible strings to all 6 i18n files.
- Must pass: npm run typecheck && npm run smoke && npm run build.
- Browser verify local game and online game at desktop + mobile viewport.
```

---

## Phase 5 — Account / Deck Sync / Match Reporting / Leaderboard Integration Verification

**Goal:** Prove the full account-backed product loop works end-to-end, and fix any broken integration points.

**Primary files:**
- `src/pages/LobbyPage.tsx`
- `src/pages/DeckEditorPage.tsx`
- `src/components/DeckEditor.tsx`
- `src/pages/LeaderboardPage.tsx`
- `src/components/Board.tsx`
- `src/api/client.ts`
- `api/server.cjs`
- `scripts/api-smoke.ts`
- `scripts/online-smoke.ts`
- `docs/API.md`
- `README.md`
- `PLAN.md`

### Task 5.1: API smoke expansion

**Objective:** API smoke covers the exact product loop.

**Flow:**
1. Register user A and user B.
2. Login/profile for both.
3. Create deck for A.
4. List decks and verify deck card IDs roundtrip.
5. Submit match result A beats B with actionLog.
6. Fetch leaderboard and verify ELO/wins/match_count.
7. Fetch match log and verify sanitized actionLog.
8. Delete deck and verify deletion.

**Acceptance:** One command proves backend data loop.

### Task 5.2: Frontend auth/deck sync manual flow support

**Objective:** Ensure UI exposes everything the API supports.

**Check/fix:**
- Register/login/logout visible and not buried.
- Deck editor can save server deck when logged in.
- Lobby can select synced server deck for online setupData.
- Guest mode still works.
- Clear feedback if API unavailable.

### Task 5.3: Match reporting correctness

**Objective:** Avoid wrong ELO / guest ID / duplicate submission.

**Check/fix:**
- `Board.tsx` currently submits using active account player and guest placeholder for other side. Verify this matches desired product behavior.
- Prevent duplicate submit on re-render/reconnect.
- If online both players are logged in but only local client knows one account, decide whether current model is sufficient. If not, add pending note rather than inventing account-bound seats.

**Important:** Do not claim account-bound seat enforcement unless actually implemented server-side.

### Task 5.4: Leaderboard UX pass

**Objective:** Leaderboard reflects match results and is understandable.

**Check/fix:**
- Loading/error/empty states.
- Current user highlight if logged in.
- Match count, wins, win rate, ELO display.
- Refresh after match submit or lobby return.

### Task 5.5: Documentation sync

**Objective:** README/API/PLAN match actual product behavior.

**Files:**
- `README.md`
- `docs/API.md`
- `PLAN.md`

**Update only after verification.** Do not document hoped-for behavior.

### Phase 5 Codex prompt skeleton

```markdown
# Phase 5: Account Deck Match Leaderboard Verification

Implement Phase 5 from .hermes/plans/2026-06-27_115352-product-completion-codex-plan.md.

Constraints:
- Verify actual API behavior with smoke tests before updating docs.
- Do not add account-bound online seats unless fully implemented and tested.
- Preserve guest mode.
- Must pass: npm run typecheck && npm run smoke && npm run smoke:online && npm run build; run API smoke.
```

---

## Recommended Execution Order

| Order | Phase | Why |
|---|---|---|
| 1 | Phase 5 API/product loop verification | It may reveal backend/frontend integration gaps that affect online UX and match history. |
| 2 | Phase 1 Online room UX | Highest player-facing risk once the data loop is verified. |
| 3 | Phase 2 Structured trace | Enables debugging and makes later UI/history work safer. |
| 4 | Phase 4 Battle UI polish | Uses trace/phase data from Phase 2 if available. |
| 5 | Phase 3 Admin rule inspector | Useful for maintenance, but less urgent than player-facing UX. |

Alternative if the goal is immediate demo polish: Phase 1 → Phase 4 → Phase 5 → Phase 2 → Phase 3.

My default recommendation: **Phase 5 first, then Phase 1**, because the remembered project state says account/deck/match integration was historically the primary next step, and verifying it prevents polishing a flow that still has data gaps.

---

## Global Acceptance Criteria

A phase is not done until all applicable checks pass:

```bash
npm run typecheck
npm run smoke
npm run rule:audit
npm run build
```

Plus:

```bash
npm run smoke:online
```

for online/lifecycle changes, and API smoke for account/deck/match changes.

UI phases require browser verification, not only code review.

---

## Risks and Guardrails

1. **Do not destabilize rule engine.**
   - Any change to `src/game/GameLogic.ts`, `src/game/effects/*`, or `src/game/types.ts` requires a regression in `scripts/game-smoke.ts`.

2. **Hidden information must stay hidden.**
   - Trace/replay/admin UI must not expose opponent hand/deck order in live online player views.

3. **Do not fake lifecycle state.**
   - If boardgame.io does not expose opponent disconnected/abandoned reliably, UI should say reconnecting/waiting, not “opponent left”.

4. **No partial UX.**
   - Each new status needs all 6 languages and a visible UI path.

5. **Docs follow verified behavior.**
   - Update docs only after smoke/browser/API verification.

6. **Codex can over-edit.**
   - Reject any Codex diff that rewrites unrelated rule/parser logic or adds large dependencies without explicit approval.

---

## Final Deliverable Checklist

After all phases:

- [ ] Online room lifecycle is clear and verified in browser.
- [ ] Match trace/action log is structured, sanitized, downloadable, and visible in history.
- [ ] Admin can inspect parsed effect AST and filter by engine behavior.
- [ ] Battle UI gives clear instructions for every phase and pending choice.
- [ ] Account → deck sync → match submit → leaderboard loop is proven by API smoke and browser flow.
- [ ] `README.md`, `PLAN.md`, `docs/API.md`, and audit docs match actual behavior.
- [ ] All verification commands pass.
