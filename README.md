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
- Local two-player, basic AI, and boardgame.io online rooms.
- Online `playerView` hides opponent hands, decks, face-down set cards, and unpaired janken choices from clients.
- Match history is stored only in the current browser.

## Known limitations

Card text is not fully implemented. Effects needing a target/position choice, previous-card history, optional extra setting, or detailed timing windows may be skipped or use a documented deterministic fallback. Online rooms can use browser-saved custom decks by sending validated deck ID payloads when the room is created. There are no deployed accounts, server deck storage, cross-device deck sync, server leaderboard, or cross-device match history.

Card data remains in `cards.json`; its shape is defined by the existing loader and schema. See [rules.md](rules.md) for the rules represented by the engine and [PLAN.md](PLAN.md) for remaining work.
