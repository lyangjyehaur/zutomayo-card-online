# ZUTOMAYO CARD Online

A React + TypeScript implementation of the two-player ZUTOMAYO CARD flow. boardgame.io provides local/online synchronization and match lifecycle; the rules use an explicit simultaneous state machine in `GameState` rather than boardgame.io's alternating-turn model.

## Run

```bash
npm install
npm run dev       # frontend development
npm run server    # boardgame.io + built static frontend on PORT (default 3000)
npm run smoke     # deterministic rules smoke tests
npm run smoke:online # online two-client smoke
npm run build
```

For the production server, run `npm run build` before `npm run server`, or use `docker compose up --build`.

## Implemented rules

- Two 20-card decks, 100 HP, janken for night side, five-card hands, one mulligan.
- Simultaneous initial face-down card setup and simultaneous per-turn confirmation.
- Winner sets one card; loser sets two; a draw means one each.
- Twelve-position Chronos, type-aware zone replacement, A-before-B conflict precedence, Power Cost attack checks, battle damage, and exact overdraw loss.
- Chronos-side effect priority and a partial parsed-effect engine with real HP, draw, Chronos, attack, and damage-reduction mutations.
- Server-validated choice flows cover hand-to-deck-bottom draw, focused card moves, Clock choices, and own Abyss-to-deck-bottom payments that lose if unpaid.
- Local two-player, basic AI, and boardgame.io online rooms.
- Online `playerView` hides opponent hands, decks, face-down set cards, and unpaired janken choices from clients.
- Match history is stored only in the current browser.

## Known limitations

Card text is not fully implemented. Previous-turn Character element conditions, player-selected normal effect order, turn start/end/damage-received/zone-entry timing events, damage-received reduction, Chronos transition events, basic hand-selection, Clock-position/Clock-advance choices, focused card-move choice flows, own Abyss-to-deck-bottom payment choices, and several deterministic target/Area Enchant effects are automated. Some Area Enchant self-move clauses are split into timing effects, including day/night-loss, damage-threshold, and opponent-Abyss-entry clauses, but optional effects, broad replacement effects, deck-ordering choices, selected-count follow-ups, and parsed-but-partial card text still need work. Online rooms can use browser-saved custom decks by sending validated deck ID payloads when the room is created. There are no deployed accounts, server deck storage, cross-device deck sync, server leaderboard, or cross-device match history.

Card data remains in `cards.json`; its shape is defined by the existing loader and schema. See [rules.md](rules.md) for the rules represented by the engine, [PLAN.md](PLAN.md) for the roadmap, and [RULE_GAP_AUDIT.md](RULE_GAP_AUDIT.md) for the detailed rule-gap audit.
