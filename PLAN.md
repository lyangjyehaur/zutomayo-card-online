# Implementation status and next work

## Current architecture

The rules engine is an explicit `GameState.step` machine:

`janken → mulligan → initialSet → turnSet → effectOrder → turnSet/gameOver`

Both players are active in boardgame.io at once. `ready` gates simultaneous reveal and the complete deterministic resolution pipeline. boardgame.io remains responsible for synchronized moves, match storage, socket transport, and `endIf`.

## Complete in this refactor

- Initial battle-zone setup after mulligan.
- Simultaneous set confirmation without `minMoves`/`maxMoves` turn rules.
- Chronos advancement from every played card, including initial non-Characters.
- Character and Area Enchant placement from either A or B, with A precedence only on actual destination conflicts.
- Enchant lifetime through effect resolution; Area Enchants persist in Set Zone C.
- Per-effect Power Cost checks and per-turn attack/damage modifiers.
- Exact overdraw loss with no partial draw.
- Hook-safe setup UI and AI moves for every state step.
- Private `playerView` filtering for online hidden information.
- One deployable boardgame.io/static server path.
- boardgame.io `setupData` deck selection with server-side constructed-deck validation.
- Previous-turn Character element condition support.
- Real boardgame.io client/server smoke coverage.
- Deterministic opponent deck-to-Abyss and Area Enchant-to-deck target effects.
- Deterministic persistent Area Enchant attack boosts while the Area Enchant remains in Set Zone C.
- Player-selected normal effect order using a server-validated pending-effect queue, with AI auto-resolution for AI-controlled pending effects.
- Timing event infrastructure for turn start, turn end, and damage-received effects.

## Remaining work

The detailed implementation gap list lives in [RULE_GAP_AUDIT.md](RULE_GAP_AUDIT.md). Keep this file as the short roadmap and status summary.

1. Extend timing event windows for zone-entry events, Chronos transitions, and full Area Enchant expiry/self-move effects.
2. Add interactive choice infrastructure for target selection, optional effects, counts, Clock choices, and deck ordering, building on the pending resolver where useful.
3. Expand replacement/continuous modifiers such as Power Cost changes, always-day/night attacks, Clock overrides, and dynamic attack formulas.
4. Audit parser/executor coverage card-by-card: the latest snapshot is 267 effect lines, 227 parsed lines, and 40 unparsed lines; parsed-but-partial lines still need separate review.
5. Confirm the exact Chronos board position mapping from official materials and lock it with tests.
6. Add reconnect/resume UX and authenticated match ownership if accounts are reintroduced.
