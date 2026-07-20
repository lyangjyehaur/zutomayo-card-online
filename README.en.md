# ZUTOMAYO CARD Online — Online Card Battle Game

**Languages:** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md)

Current version: **0.2.2**

> An unofficial digital battle platform for ZUTOMAYO CARD, the official TCG from ZUTOMAYO.
> Supports local two-player games, AI practice, an interactive tutorial, and real-time online play.

## Project Status

Version 0.2.0 expands the project from a standalone battle app into a multiplayer platform. `boardgame.io` remains authoritative for card state, Colyseus owns lobby, matchmaking, room, invite, and spectator presence flows, and ChatService owns durable chat, unread state, translation, reports, and moderation.

Version 0.2.2 adds the shared-deck lobby plus PostgreSQL-backed official Japanese Q&A and errata, localized pages, admin review, and source synchronization workflows.

### Game and Battle

- Local two-player and easy, normal, or hard AI; hard AI uses lookahead simulation.
- Complete data for 422 cards across 4 packs, with all 267 effect lines parsed.
- Rock-paper-scissors, mulligan, initial setup, effect ordering, player choices, battle, and Chronos day/night flow.
- Authoritative phase timers and timeout recovery prevent disconnected or unresponsive players from blocking a match forever.
- Battle animations, a responsive battlefield, mobile touch controls, and a redesigned tutorial overlay.
- The result screen can retry ELO and match submission; server writes are idempotent, while local history is deduplicated and retains its post-match chat source.

### Multiplayer Platform

- Colyseus quick match, custom rooms, friend invitations, spectators, and lobby friend presence.
- Stable match handoff and reconnect recovery; online sessions retain platform identity, seat tokens, and boardgame.io credentials.
- Production uses Redis driver/presence, while local development can use memory mode.
- Colyseus stores platform-shell state only and never owns hands, decks, effects, or other authoritative game data.

### Social and Chat

- Friend management, friend presence, and battle invitations.
- Global lobby, friend direct, custom-room, in-match, and post-match chat.
- Cross-conversation unread summaries, read cursors, message translation, reports, and evidence snapshots that survive message deletion.
- Admins can inspect full conversation evidence, resolve reports, and apply durable mutes across conversation types.
- ChatService and PostgreSQL are the source of truth; Colyseus emits content-free synchronization signals only.

### Other Product Features

- Six UI languages: Traditional Chinese, Cantonese, Simplified Chinese, Japanese, English, and Korean.
- Deck editor, shared-deck lobby, leaderboard, cross-device match history, profile, OAuth identities, and feedback board.
- Official Japanese Q&A and errata, localized reading pages, admin review, and source synchronization.
- PWA install/update prompts plus app, build, and rules compatibility checks.
- Admin tooling for cards, translations, users, ELO, chat evidence, sanctions, and feedback.
- Playwright core E2E, k6 API/WebSocket/auth/matchmaking load tests, and staging/production CD pipelines.

## Architecture

```text
Browser / PWA
  ├─ HTTP + Socket.IO ──> game :3000
  │                        authoritative boardgame.io match, frontend, /api proxy
  ├─ HTTP ──────────────> api :3001
  │                        accounts, decks, matches, friends, ChatService, admin
  └─ WebSocket ─────────> platform :3002
                           Colyseus lobby, matchmaking, rooms, invites, spectators

game / api / platform
  ├─ PostgreSQL: durable product data, match state, participants, chat evidence
  └─ Redis: Pub/Sub, Colyseus presence/driver, rate limits, ephemeral coordination
```

### Authority Boundaries

| Domain                 | Source of truth              | Responsibility                                                       |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Card match             | `boardgame.io` + `GameLogic` | Hidden information, legal moves, timers, effects, result, action log |
| Multiplayer platform   | Colyseus                     | Lobby, room lifecycle, matchmaking, invites, presence, spectators    |
| Chat                   | ChatService + PostgreSQL     | History, ACLs, unread state, translation, reports, moderation, mutes |
| Product data           | PostgreSQL                   | Accounts, decks, matches, friends, configuration, feedback           |
| Ephemeral coordination | Redis                        | Cross-node sync, room discovery, rate limits, compatibility queues   |

### Main Technologies

| Layer      | Technology                                                           |
| ---------- | -------------------------------------------------------------------- |
| Web        | React 19, React Router 7, TypeScript 5.8, Vite 7, Tailwind CSS 4     |
| Match      | boardgame.io 0.50 and a deterministic `GameState.step` state machine |
| Platform   | Colyseus, `colyseus.js`, Redis presence/driver                       |
| Backend    | Node.js, Koa / Node HTTP, PostgreSQL, Redis, Zod                     |
| Quality    | Vitest, fast-check, Playwright, k6, ESLint, Prettier, Husky          |
| Operations | Docker Compose, GitHub Actions CI/CD, Pino, Prometheus, Sentry       |

## Local Development

### Requirements

- Node.js `>=20`; CI and Docker use Node 22.
- npm 10+.
- Full online flows require PostgreSQL and Redis. Colyseus can start independently in memory mode.

### Install and Start

```bash
npm ci
cp .env.example .env

# Backend dependencies, schema, REST API, and Colyseus platform
docker compose up -d postgres redis migrate api platform

# Vite frontend with HMR, http://localhost:3000
npm run dev
```

To run the real boardgame.io server, start Compose's `game` service or run `npm run build && npm run server` from a shell where the `.env` values have been exported. `npm run platform` can start the platform independently in memory mode; to run the API independently, export its environment first and use `cd api && npm ci && npm start`.

### Common Commands

| Command                                        | Purpose                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run verify`                               | Formatting, policies, config, lint, typechecks, coverage, and production build |
| `npm test` / `npm run test:watch`              | Run Vitest once / in watch mode                                                |
| `npm run typecheck`                            | Check application and server TypeScript                                        |
| `npm run typecheck:scripts`                    | Check scripts TypeScript                                                       |
| `npm run lint`                                 | Run ESLint                                                                     |
| `npm run format:check:tracked`                 | Check Prettier formatting for Git-tracked files only                           |
| `npm run build`                                | Typecheck and create the production frontend bundle                            |
| `npm run server`                               | Start the game / boardgame.io server                                           |
| `npm run platform`                             | Start the Colyseus platform service                                            |
| `npm run db:migrate`                           | Apply PostgreSQL migrations                                                    |
| `npm run import:official-rulings-translations` | Import untracked official-rulings translations into PostgreSQL                 |
| `npm run sync:official-rulings`                | Read-only comparison of the official Q&A and errata sources                    |
| `npm run translate:official-rulings`           | Generate missing derived official-rulings translations                         |
| `npm run smoke`                                | Core game-flow smoke test                                                      |
| `npm run smoke:api`                            | REST API integration smoke test                                                |
| `npm run smoke:online`                         | boardgame.io online-match smoke test                                           |
| `npm run smoke:platform-deployment`            | Verify platform health and a real lobby WebSocket join/leave                   |
| `npm run smoke:responsive`                     | All responsive browser smoke tests                                             |
| `npm run rule:audit`                           | Card-effect parser coverage audit                                              |
| `npm run e2e` / `npm run e2e:ui`               | Full Playwright E2E / interactive UI                                           |
| `npm run load:api` / `load:ws`                 | k6 API / WebSocket load tests (k6 installed separately)                        |

## Docker Deployment

```bash
cp .env.example .env
# At minimum, set PG_PASSWORD, REDIS_PASSWORD, and a JWT_SECRET with >= 32 characters
docker compose up -d --build
docker compose ps
```

Compose contains six units: `postgres`, `redis`, one-shot `migrate`, `game`, `api`, and `platform`.

The repository also provides `docker-compose.e2e.yml`, `docker-compose.load-test.yml`, and an isolated-port/database `docker-compose.staging.yml`. Production-hardening CD is currently isolated on `codex/deferred-production-hardening`; staging and production SSH deployment is explicitly triggered with `workflow_dispatch` using verified artifacts.

| Port   | Service  | Purpose                                           |
| ------ | -------- | ------------------------------------------------- |
| `3000` | game     | Web/PWA, boardgame.io, Socket.IO, `/api/*` proxy  |
| `3001` | api      | REST API, ChatService, accounts, and admin        |
| `3002` | platform | Colyseus WebSocket rooms, `/health`, and `/ready` |

See the [deployment guide](docs/DEPLOYMENT.md) for production, external PostgreSQL/Redis, backup, migration, and horizontal-scaling details. Official Q&A/errata synchronization, import, and translation are documented in the [official rulings database guide](docs/official-rulings.md).

## Repository Map

```text
src/game/             authoritative rules, AI, effects, card loading, battle tests
src/components/       battle, tutorial, lobby, and shared React features
src/ui/               design tokens, primitives, layout, and battlefield UI
src/pages/            route-level pages
src/platform/         Colyseus runtime, rooms, identity, persistence adapters
src/chat/             direct-chat keys, match-chat ACLs, unread navigation
src/server/           PostgreSQL, Redis, rate-limit, and observability extensions
api/                  REST API and account, friend, chat, match, admin services
migrations/           node-pg-migrate schema history
scripts/              smoke, migration, deployment, and audit tools
e2e/                  Playwright auth, deck, tutorial, and smoke scenarios
load-tests/           k6 API, WebSocket, auth, and matchmaking load tests
docs/                 architecture, API, deployment, multiplayer, and UI/UX docs
```

Primary pages include `/online`, `/ai`, `/tutorial`, `/deck-builder`, `/deck-shares`, `/history`, `/leaderboard`, `/feedback`, `/profile`, `/rules/qa`, `/rules/errata`, and `/admin`.

## Security and Operations

- Cookie sessions with legacy Bearer compatibility, atomic Redis `GETDEL` refresh rotation, and double-submit CSRF protection.
- OAuth encryption keys are separate from the JWT secret; Colyseus validates the same account session.
- Match seat tokens, durable chat participant evidence, and server-side ACLs prevent client role spoofing.
- Production Redis passwords, a trusted-proxy allowlist, participant-only match logs, and transaction locks prevent rate-limit bypass, IDOR, and concurrent ELO overwrite.
- Platform `/health` checks PostgreSQL/Redis dependencies; `/ready`, protected `/metrics`, structured logs, request IDs, and Sentry metadata cover operations.
- Git hooks: pre-commit runs staged format/lint; pre-push runs typechecks and tests.

## Documentation

- [Full architecture](docs/ARCHITECTURE.md)
- [REST API](docs/API.md)
- [Card-text i18n maintenance guide (Traditional Chinese)](docs/card-text-i18n.md)
- [Official rulings database guide](docs/official-rulings.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Multiplayer platform architecture](docs/MULTIPLAYER_PLATFORM_ARCHITECTURE.md)
- [Multiplayer alignment audit](docs/MULTIPLAYER_PLATFORM_ALIGNMENT_AUDIT.md)
- [Contributing guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Load testing](load-tests/README.md)
- [Game rules](rules.md) / [Official Q&A](https://battle.zutomayocard.online/rules/qa) / [Official errata](https://battle.zutomayocard.online/rules/errata)

## License

This project is for personal learning and technical research only. Card art, trademarks, and related copyrights belong to ZUTOMAYO / Sony Music Entertainment and their respective rights holders.
