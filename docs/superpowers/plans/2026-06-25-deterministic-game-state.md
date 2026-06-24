# Deterministic Game State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the official simultaneous ZUTOMAYO turn flow as an explicit deterministic state machine.

**Architecture:** boardgame.io exposes unrestricted synchronized moves, while `GameState.step` and `ready` validate and advance the rules. A single resolution pipeline owns Chronos, placement, effects, battle, cleanup, draws, and terminal state.

**Tech Stack:** React 19, TypeScript, boardgame.io, tsx.

---

### Task 1: State model and regression harness

**Files:** `src/game/types.ts`, `scripts/game-smoke.ts`, `package.json`

- [x] Define explicit steps, readiness, played cards, terminal result, and combat modifiers.
- [x] Add smoke assertions for required state transitions and known regressions.
- [x] Run `npm run smoke` and confirm it fails against the old implementation.

### Task 2: Deterministic rules pipeline

**Files:** `src/game/GameLogic.ts`, `src/game/effects/executor.ts`

- [x] Implement guarded setup/set operations and simultaneous readiness transitions.
- [x] Implement type-aware A/B placement with A precedence and initial-card behavior.
- [x] Implement effect affordability and stateful combat modifiers.
- [x] Implement battle, cleanup, exact draw loss, and terminal state.
- [x] Run `npm run smoke` until all assertions pass.

### Task 3: boardgame.io adapter

**Files:** `src/game/Game.ts`

- [x] Replace turn move limits with state-step validation.
- [x] Expose janken, mulligan, keep, set, undo, and confirm moves.
- [x] Return the stored winner from `endIf`.

### Task 4: React and AI clients

**Files:** `src/components/Board.tsx`, `src/game/ai.ts`, `src/game/useAIMoves.ts`, `src/App.tsx`

- [x] Split setup screens into hook-safe child components.
- [x] Render initial setup, normal setup, readiness, and terminal state.
- [x] Drive all explicit steps through AI moves.
- [x] Remove account/leaderboard UI that has no deployable API.

### Task 5: deployment and documentation

**Files:** `Dockerfile`, `src/server-boardgame.cjs`, `src/server.ts`, `README.md`, `PLAN.md`, `rules.md`, `.gitignore`

- [x] Keep one boardgame.io/static deployment path.
- [x] Document implemented behavior and effect limitations without API claims.
- [x] Ignore TypeScript build metadata.

### Task 6: final verification

- [x] Run `npm run smoke`.
- [x] Run `npm run build`.
- [x] Run `grep -R 'file:' package.json package-lock.json` and confirm there are no local tarball dependencies.
- [x] Review `git diff --check` and the final diff; do not commit.
