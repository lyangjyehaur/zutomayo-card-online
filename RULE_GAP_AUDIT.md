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
- Battle damage, HP loss, HP-zero game end, and exact overdraw loss with no partial draw.
- Online `playerView` redacts hidden hands, decks, face-down cards, and unpaired janken choices.
- Server-side room setup accepts validated deck ID payloads for browser custom decks.
- Deterministic effect slices:
  - previous-turn Character element condition;
  - opponent deck top-to-Abyss movement;
  - opponent Area Enchant return to deck top/bottom;
  - persistent Area Enchant `boostAttack` while the Area Enchant remains in Set Zone C.

## Remaining rules gaps

### 1. Remaining timing windows and Area Enchant expiry

Rule gap: several effects still depend on zone-entry, Chronos transition, or card-specific expiry timing.

Current implementation: the normal effect-processing pass has pending-effect infrastructure and player-selected order. The timing event framework now resolves turn-start, turn-end, and damage-received effects from public field cards. The engine still does not emit every rule event needed for full card coverage.

Still-missing timing windows include:

- card enters Abyss;
- card enters Power Charger;
- Area Enchant enters field;
- Character replacement;
- Chronos becoming day/night or no longer satisfying a condition.

Needed work:

- Emit events from zone movement, Character replacement, Chronos advancement, and Area Enchant entry.
- Implement Area Enchant expiry/self-movement as event-driven effects, not a broad cleanup rule.
- Resolve immediate triggers without leaking hidden information.
- Add smoke tests for each timing window before adding card-specific behavior.

### 2. Area Enchant expiry and self-movement

Rule gap: many Area Enchant cards specify when they leave Set Zone C and whether they go to Abyss or Power Charger.

Current implementation: Area Enchant cards persist, and static `boostAttack` effects can apply across turns. Expiry/self-move timing is not yet automated.

Examples not fully implemented:

- `夜じゃなくなったらパワーチャージャーに置く`
- `昼じゃなくなったらパワーチャージャーに置く`
- `ターンの終了時に...アビスに置く`
- `30ダメージ以上を受けたなら、すぐにアビスに置く`
- `相手のアビスにカードが置かれたとき、すぐにこのカードをアビスに置く`

Needed work:

- Implement Area Enchant expiry as event-driven effects, not as a broad cleanup rule.
- Route the card to the correct owner zone according to the specific text.
- Cover at least one Power Charger expiry and one Abyss expiry smoke test first.

### 3. Interactive choices and targets

Rule gap: many cards require the player to choose cards, positions, counts, or order.

Current implementation: deterministic no-choice effects are automated, and normal-phase ordering can pause for player selection. Optional effects, targets, counts, and other card-specific choices are still skipped or use a documented fallback.

Missing choice categories include:

- choose a card from hand, Abyss, Power Charger, or battle zone;
- choose a Clock advance amount such as 0-5;
- choose top/bottom deck placement or reorder viewed deck cards;
- choose whether to use optional effects;
- choose how many cards to reveal/discard/recover;
- choose replacement targets.

Needed work:

- Add a `pendingChoice` model with choice type, legal options, owner, and resolver payload.
- Ensure hidden zones are only revealed to eligible players.
- Add UI for choice selection and boardgame.io moves to submit choices.
- Add smoke tests for resolver validation and invalid choices.

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
- parsed lines: 227;
- unparsed lines: 40.

Important caveat: parsed does not always mean fully correct execution. Some parsed effects only cover the first deterministic part of a longer effect, or intentionally skip a timing/choice clause.

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

1. Extend timing events to zone movement, Character replacement, Chronos transitions, and Area Enchant entry/expiry.
2. Implement Area Enchant expiry/self-move timing using that framework.
3. Add generic `pendingChoice` infrastructure for interactive effects and targets, building on the normal-phase pending resolver.
4. Audit parsed-but-partial effects and the 40 unparsed lines card-by-card.
5. Confirm Chronos board exactness from official materials and lock it with tests.
6. Add reconnect/resume and account-backed match ownership if the product direction needs it.
