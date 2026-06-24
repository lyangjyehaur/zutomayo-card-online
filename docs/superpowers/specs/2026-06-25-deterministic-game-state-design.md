# Deterministic Game State Design

## Goal

Replace boardgame.io's alternating-turn rules with a deterministic two-player state machine stored entirely in `GameState`, while retaining boardgame.io for move transport, synchronization, lobbies, and game termination.

## State and transitions

`GameState.step` is one of `janken`, `mulligan`, `initialSet`, `turnSet`, or `gameOver`. Each setup/set step accepts moves from either player and uses `ready: [boolean, boolean]` to advance only after both players confirm. Janken ties reset choices. Mulligan completion advances to initial setup. Initial setup and every later turn resolve through one synchronous pipeline.

The pipeline reveals all cards, advances the 12-position Chronos using every card set that turn, places cards by type, resolves affordable effects in Chronos priority order, resolves battle with transient modifiers, sends temporary cards away, and performs exact draws. An attempted draw larger than the remaining deck ends the game before any partial draw.

Set Zone A has precedence only when two cards compete for the same destination. A B-only Character or Area Enchant is still placed. Initial non-Characters leave immediately after reveal but remain in the turn's immutable played-card list for Chronos and eligible use-effect processing.

## Effects

Each card's power cost is checked immediately before each parsed effect. Supported common actions mutate HP, Chronos, hands, and per-turn combat state. Attack boost/reduction, attack-side swapping, and damage reduction are transient and reset before and after each pipeline. Unsupported parser actions remain documented limitations rather than simulated outcomes.

## UI and AI

Setup screens are child components so the parent board never calls hooks conditionally. The main board renders the required set count and ready status from state. AI drives the same public moves for janken, mulligan, initial setup, and normal turns.

## Deployment

The deployable server is the boardgame.io server with static frontend serving. Account and leaderboard UI/API claims are removed because the separate HTTP server cannot preserve boardgame.io online synchronization. Local match history remains browser-local.

## Verification

A lightweight TypeScript smoke script covers step transitions, initial non-Character handling, B-only placement, combat modifiers/power costs, and exact draw loss. The production build and dependency-path grep are final gates.
