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
- Timing events for turn start, turn end, damage received, and zone entry; timing effects resolve from public field cards without inspecting hidden hands/decks.
- Damage-received reduction is applied before battle damage, and damage-causing effects now end the game immediately when HP reaches 0.
- Turn-start transient modifiers are preserved into the turn they affect.
- Chronos transition, zone-entry, and Character replacement events are recorded; Chronos transition can drive simple Area Enchant self-move effects.
- Server-validated pending choice flows exist for hand-to-deck-bottom-then-draw, optional hand payment then draw for fixed-1 `4th_53` / `4th_54` / `4th_58` and selected-count `4th_61` / `4th_62` / `4th_63`, focused card-move choices, own Abyss-to-deck-bottom payment choices with failure branches, Clock position choices, and optional 0-5 Clock advance choices.
- `4th_6` can swap one opponent Power Charger Character with the opponent Battle Zone Character, records the swapped-in Character for same-turn named-card conditions, and suppresses the swapped-in card's own collected effects for the turn.
- Area Enchant self-move parser now emits secondary timing effects for several turn-end, day/night-loss, damage-threshold, and opponent-Abyss-entry clauses.
- Battle damage, HP loss, HP-zero game end, and exact overdraw loss with no partial draw.
- Online `playerView` redacts hidden hands, decks, face-down cards, and unpaired janken choices.
- Server-side room setup accepts validated deck ID payloads for browser custom decks.
- Deterministic effect slices:
  - previous-turn Character element condition;
  - optional fixed-1 hand payment then draw for `4th_53` / `4th_54` / `4th_58`;
  - optional selected-count hand payment then draw for `4th_61` / `4th_62` / `4th_63`;
  - opponent deck top-to-Abyss movement;
  - opponent Area Enchant return to deck top/bottom;
  - own hand-to-Abyss choice movement;
  - own Abyss-to-deck-bottom payment choices, including fixed counts, 1+ variable count, face-down selected packet movement, and loss when the payment cannot be made;
  - opponent Abyss-to-deck-bottom choice movement;
  - opponent Power Charger-to-deck-bottom choice movement filtered by `sendToPower`;
  - `4th_6` opponent Power Charger Character-to-Battle Zone swap with swapped-in effect suppression;
  - fixed Clock advance and fixed Clock set-to-midnight/noon effects;
  - Clock position and 0-5 advance choice effects;
  - persistent Area Enchant `boostAttack` while the Area Enchant remains in Set Zone C.

## Remaining rules gaps

### 1. Remaining timing windows and Area Enchant expiry

Rule gap: several effects still depend on zone-entry, Chronos transition, or card-specific expiry timing.

Current implementation: the normal effect-processing pass has pending-effect infrastructure and player-selected order. The timing event framework now resolves turn-start, turn-end, damage-received, and Chronos-changed effects from public field cards. The engine records field zone-entry and Character replacement events, but does not yet resolve every card effect off every zone movement.

Still-missing timing windows include:

- exhaustive card enters Abyss / Power Charger handling for all movement paths;
- broader non-Chronos zone-entry triggered effects;
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

Examples now covered in the focused slice:

- `30ダメージ以上を受けたなら、すぐにアビスに置く`
- `相手のアビスにカードが置かれたとき、すぐにこのカードをアビスに置く`

Examples still not fully implemented:

- movement paths that do not yet emit zone-entry resolution immediately;
- `相手のフィールドにエリアエンチャントがあるならパワーチャージャーに置く`.

Needed work:

- Implement Area Enchant expiry as event-driven effects, not as a broad cleanup rule.
- Route the card to the correct owner zone according to the specific text.
- Continue adding smoke tests as each expiry condition is promoted from parsed-but-partial to executed.

### 3. Interactive choices and targets

Rule gap: many cards require the player to choose cards, positions, counts, or order.

Current implementation: deterministic no-choice effects are automated, normal-phase ordering can pause for player selection, hand-to-deck-bottom-then-draw choices use a server-validated `pendingChoice`, optional hand payment then draw is supported for fixed-1 `4th_53` / `4th_54` / `4th_58` and selected-count `4th_61` / `4th_62` / `4th_63`, a small card-move choice slice supports own hand to own Abyss, opponent Abyss to opponent deck bottom, and opponent Power Charger to opponent deck bottom with `sendToPower` filtering, own Abyss payment choices can return fixed or 1+ selected cards to deck bottom with the required loss branch, the `4th_27` follow-up mills the selected payment count from the opponent deck, `4th_6` can swap an opponent Power Charger Character into the opponent Battle Zone while suppressing that swapped-in card's collected effects, and Clock choices can choose a position or 0-5 advance amount. Broader optional effects, many targets, many remaining variable counts, broader selected-count follow-ups, and other card-specific choices are still skipped or use a documented fallback.

Missing choice categories include:

- choose cards from unsupported zones such as battle zone or viewed deck cards;
- choose top/bottom deck placement or reorder viewed deck cards;
- choose whether to use optional effects beyond the implemented `4th_53` / `4th_54` / `4th_58` and `4th_61` / `4th_62` / `4th_63` hand-payment slices;
- choose how many cards to reveal/discard/recover beyond the current own-Abyss 1+ payment slice;
- apply broader follow-up effects that depend on a selected count;
- choose replacement targets beyond the focused `4th_6` opponent Character swap.

Needed work:

- Expand `pendingChoice` beyond the current card-move/Abyss-payment/Clock/`4th_6` slices to broader battle-zone targets, optional effects, more variable counts, selected-count follow-ups, and deck ordering.
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
- parsed lines: 267;
- runtime parsed effects: 288;
- unparsed lines: 0;
- parsed-but-partial heuristic: 0;
- false `drawCards` positives: 0.

Important caveat: parsed does not always mean perfect physical-card semantic equivalence. `rule:audit` now checks the runtime `parseAllEffects()` AST, including combined dangling lines, expiry effects, and secondary effects, but card-specific behavior still needs smoke regressions when refined.

Current high-risk semantic categories:

- Effects that depend on prior clauses from the same card must preserve intra-card order while still allowing different cards to be ordered by the active player.
- Zone visibility and hidden-information effects need explicit reveal permissions rather than relying on generic face-up state.
- Parser/executor coverage should remain tied to runtime `parseAllEffects()`, not only per-line `parseEffect()` diagnostics.

Needed work:

- Keep `npm run rule:audit` at 0 unparsed / 0 parsed-but-partial.
- Add card IDs and smoke assertions for every semantic refinement.
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

1. Expand `pendingChoice` to remaining target, broader optional-effect, variable-count, selected-count follow-up, and deck-ordering choices.
2. Resolve card-specific effects from Abyss/Power Charger zone-entry and Character replacement events.
3. Expand Area Enchant expiry/self-move timing for damage-threshold and opponent-zone movement clauses.
4. Keep `npm run rule:audit` in the verification loop to prevent parser/executor regressions.
5. Confirm Chronos board exactness from official materials and lock it with tests.
6. Add reconnect/resume and account-backed match ownership if the product direction needs it.
