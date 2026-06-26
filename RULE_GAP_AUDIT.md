# Rules gap audit

This document tracks the remaining gap between the current implementation and the rule notes in `rules.md` plus the Obsidian rule documents.

## Current alignment

The core phase model is implemented as an explicit simultaneous state machine with a pending normal-effect window when needed:

`janken → mulligan → initialSet → turnSet → effectOrder → turnSet/gameOver`

Implemented and covered by smoke tests:

- 20-card constructed decks and same-card copy validation.
- 100 HP, janken-selected night side, five-card opening hands, one mulligan.
- Simultaneous initial face-down battle-zone setup and simultaneous reveal.
- Initial non-Character cards leave immediately to Power Charger or Abyss while still contributing Clock.
- Winner sets one card, loser sets two cards, draw means one card each.
- Simultaneous Set Zone A/B reveal.
- Chronos advances from the total Clock of cards played this turn.
- Character and Area Enchant replacement, including A-before-B precedence and B-only destination cases.
- Enchant cards remain until effect resolution; Area Enchant cards persist in Set Zone C.
- Per-effect Power Cost checks and Power Cost attack checks.
- Player-selected normal effect-processing order: after reveal/place/Chronos advancement, eligible effects are queued by Chronos-side priority player first, each player chooses their own effect order, and the existing post-effect battle/finish pipeline resumes after the queue empties.
- Timing events for turn start, turn end, and damage received; timing effects resolve from public field cards without inspecting hidden hands/decks.
- Damage-received reduction is applied before battle damage, and damage-causing effects now end the game immediately when HP reaches 0.
- Turn-start transient modifiers are preserved into the turn they affect.
- Chronos transition, zone-entry, and Character replacement events are recorded; Chronos transition can drive simple Area Enchant self-move effects.
- Server-validated pending choice flows exist for hand-to-deck-bottom-then-draw, focused card-move choices, Clock position choices, and optional 0-5 Clock advance choices.
- Area Enchant self-move parser now emits secondary timing effects for several turn-end and day/night-loss clauses.
- Battle damage, HP loss, HP-zero game end, and exact overdraw loss with no partial draw.
- Online `playerView` redacts hidden hands, decks, face-down cards, and unpaired janken choices.
- Server-side room setup accepts validated deck ID payloads for browser custom decks.
- Deterministic effect slices:
  - previous-turn Character element condition;
  - opponent deck top-to-Abyss movement;
  - opponent Area Enchant return to deck top/bottom;
  - own hand-to-Abyss choice movement;
  - opponent Abyss-to-deck-bottom choice movement;
  - opponent Power Charger-to-deck-bottom choice movement filtered by `sendToPower`;
  - fixed Clock advance and fixed Clock set-to-midnight/noon effects;
  - Clock position and 0-5 advance choice effects;
  - persistent Area Enchant `boostAttack` while the Area Enchant remains in Set Zone C.

## Remaining rules gaps

### 1. Remaining timing windows and Area Enchant expiry

Rule gap: several effects still depend on zone-entry, Chronos transition, or card-specific expiry timing.

Current implementation: the normal effect-processing pass has pending-effect infrastructure and player-selected order. The timing event framework now resolves turn-start, turn-end, damage-received, and Chronos-changed effects from public field cards. The engine records field zone-entry and Character replacement events, but does not yet resolve every card effect off every zone movement.

Still-missing timing windows include:

- card enters Abyss;
- card enters Power Charger;
- non-Chronos zone-entry triggered effects;
- replacement effects triggered by Character replacement.

Needed work:

- Emit events from Abyss and Power Charger movement.
- Resolve card-specific zone-entry/replacement effects from the recorded event stream.
- Expand Area Enchant expiry/self-movement coverage beyond the currently parsed clauses.
- Resolve immediate triggers without leaking hidden information.
- Add smoke tests for each timing window before adding card-specific behavior.

### 2. Area Enchant expiry and self-movement

Rule gap: many Area Enchant cards specify when they leave Set Zone C and whether they go to Abyss or Power Charger.

Current implementation: Area Enchant cards persist, static `boostAttack` effects can apply across turns, and several self-move clauses now become secondary timing effects. Full expiry/self-move timing is still not complete.

Examples not fully implemented:

- `30ダメージ以上を受けたなら、すぐにアビスに置く`
- `相手のアビスにカードが置かれたとき、すぐにこのカードをアビスに置く`

Needed work:

- Implement Area Enchant expiry as event-driven effects, not as a broad cleanup rule.
- Route the card to the correct owner zone according to the specific text.
- Cover at least one Power Charger expiry and one Abyss expiry smoke test first.

### 3. Interactive choices and targets

Rule gap: many cards require the player to choose cards, positions, counts, or order.

Current implementation: deterministic no-choice effects are automated, normal-phase ordering can pause for player selection, hand-to-deck-bottom-then-draw choices use a server-validated `pendingChoice`, a small card-move choice slice supports own hand to own Abyss, opponent Abyss to opponent deck bottom, and opponent Power Charger to opponent deck bottom with `sendToPower` filtering, and Clock choices can choose a position or 0-5 advance amount. Optional effects, many targets, variable counts, and other card-specific choices are still skipped or use a documented fallback.

Missing choice categories include:

- choose cards from unsupported zones such as battle zone or viewed deck cards;
- choose top/bottom deck placement or reorder viewed deck cards;
- choose whether to use optional effects;
- choose how many cards to reveal/discard/recover;
- choose replacement targets.

Needed work:

- Expand `pendingChoice` beyond the current fixed card-move/Clock slices to battle-zone targets, optional effects, variable counts, and deck ordering.
- Add UI for each choice type.
- Add smoke tests for each resolver and invalid choices.

### 4. Replacement, prevention, and continuous modifiers

Rule gap: some cards change rules or static values instead of performing a one-shot action.

Current implementation: basic per-turn attack modifiers, damage reduction, no-effect, swap night/day attack, and persistent Area Enchant `boostAttack` exist. Broader replacement/prevention effects are incomplete.

Missing categories include:

- prevent opponent from setting Area Enchant;
- reduce a Character's Power Cost;
- force attack to always use day/night value;
- set all card Clock values to 1;
- dynamic attack based on Abyss, Power Charger, HP, or hand contents;
- reveal information and branch on the revealed card.

Needed work:

- Separate one-shot actions from continuous modifiers.
- Recompute continuous modifiers at the correct timing rather than baking them into a one-time mutation.
- Add a compatibility layer so current deterministic effects remain stable.

### 5. Parser and executor coverage

Current parser snapshot from the latest audit:

- total cards: 422;
- cards with effect text: 250;
- effect text lines: 267;
- parsed lines: 225;
- unparsed lines: 42;
- parsed-but-partial heuristic: 38;
- false `drawCards` positives: 0.

Important caveat: parsed does not always mean fully correct execution. Some parsed effects only cover the first deterministic part of a longer effect, or intentionally skip a timing/choice clause.

Current high-risk parsed-but-wrong categories:

- Timing suffixes such as `...ターンの終了時にアビスに置く` can make the whole card parse as `onTurnEnd`, so a main continuous effect may no longer run during the normal effect window.
- Broad `カードをX枚` false positives for selection/deck-return text have been tightened; `npm run rule:audit` reports current parsed/unparsed/partial samples.
- Area Enchant expiry clauses are parsed as the main action instead of a second self-move effect, so cards such as expiry-to-Abyss/Power Charger remain incomplete even when a parsed action exists.

Needed work:

- Track three states per card effect line:
  - parsed and executed;
  - parsed but partial;
  - unparsed.
- Add card IDs and smoke assertions as each line moves from partial/unparsed to implemented.
- Prefer small deterministic slices before broad regex expansion.

### 6. Chronos board exactness

Rule gap: the implementation uses a twelve-position Chronos model and the current day/night calculation.

Risk: the Obsidian notes still mark the exact Chronos board structure and day/night coverage as something to confirm from official diagrams/PDF. If the official board has different position boundaries, the current model must be adjusted.

Needed work:

- Extract the exact Chronos positions from the official guide.
- Encode the mapping as data with tests for every position.
- Keep `midnightRange` effects tested against that mapping.

### 7. Online product gaps

These are not core rule-engine mismatches, but they affect real online play:

- reconnect/resume UX;
- authenticated match ownership if accounts return;
- server-side deck storage and cross-device deck sync;
- server leaderboard and cross-device match history;
- action log/replay useful for resolving disputes.

## Suggested implementation order

1. Expand `pendingChoice` to target, optional-effect, variable-count, and deck-ordering choices.
2. Resolve card-specific effects from Abyss/Power Charger zone-entry and Character replacement events.
3. Expand Area Enchant expiry/self-move timing for damage-threshold and opponent-zone movement clauses.
4. Audit parsed-but-partial effects and the 42 unparsed lines card-by-card using `npm run rule:audit`.
5. Confirm Chronos board exactness from official materials and lock it with tests.
6. Add reconnect/resume and account-backed match ownership if the product direction needs it.
