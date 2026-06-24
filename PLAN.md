# Implementation status and next work

## Current architecture

The rules engine is an explicit `GameState.step` machine:

`janken → mulligan → initialSet → turnSet → gameOver`

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

## Remaining work

1. Expand the parser/executor card-by-card, especially choices, targets, replacement effects, prior-turn conditions, and timing-specific triggers.
2. Connect deck selection to boardgame.io setup data and validate constructed decks server-side.
3. Add reconnect/resume UX and authenticated match ownership if accounts are reintroduced.
4. Add integration coverage against a real boardgame.io client/server in addition to the deterministic smoke suite.
