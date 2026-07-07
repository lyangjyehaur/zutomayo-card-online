# ZUTOMAYO CARD Online — Online Card Battle Game

**Languages:** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md)

> A digital online battle platform for ZUTOMAYO CARD, the official TCG from ZUTOMAYO.
> Supports local two-player play, AI practice, and real-time online matches with the official rules implemented.

---

## Game Overview

ZUTOMAYO CARD is a two-player trading card game (TCG) themed around the Japanese band ZUTOMAYO, also known as "Zutto Mayonaka de Iinoni."

**Core mechanics:**

- Each player uses a 20-card deck and starts at 100 HP
- **Chronos day/night system** — a circular clock determines whether the current state is NIGHT or DAY, affecting character attack values
- **Three card types** — Character, Enchant, and Area Enchant
- **Five elements** — Dark, Fire, Electric, Wind, and Chaos
- **Rock-paper-scissors opening** — determines the night-side player
- **Comeback mechanic** — the losing player may play 2 cards on the next turn

---

## Features

### Game Modes

- **Local battle** — two players on the same screen
- **AI practice** — easy, normal, and hard difficulties; hard mode uses lookahead simulation
- **Online battle** — real-time boardgame.io WebSocket synchronization, matchmaking queue, and reconnection support

### Card System

- Complete data for 422 cards across 4 packs
- All 267 effect text lines parsed with 100% coverage
- Effect rules engine supports 30+ action types and 15+ condition types
- 250 effect cards translated into 6 languages with LLM-generated translations

### UI/UX

- **Fullscreen without scrolling** — 100vh / 100vw game interface
- **Responsive design** — adapts to desktop, tablet, and mobile
- **Design System v1** — semantic tokens plus shared layout, primitive, and game UI components
- **Six languages** — Traditional Chinese (Taiwan), Cantonese (Hong Kong), Simplified Chinese, Japanese, English, and Korean
- **Interactive tutorial** — beginner onboarding with step-by-step rule learning
- **Deck editor** — filter, sort, and build decks from 422 cards; supports server sync and local custom decks
- **Match history** — local history records
- **Leaderboard** — ELO rating system
- **Profile page** — account profile, OAuth identity linking, password updates, and Logto Account Center integration
- **Feedback board** — anonymous or signed-in posts, votes, comments, tags, statuses, duplicate marking, and image attachments
- **PWA and version prompts** — install prompt, update prompt, version compatibility checks, and reconnect prompts

### Admin Console

- Card data browser with filtering, search, and detail views
- Card data and effect translation editing with game-server hot reload
- i18n translation management plus About / community link settings
- User list and ELO reset
- Feedback moderation for status, tags, deletion, and duplicate marking
- Admin token login (`/api/admin/login`, password provided by the `ADMIN_PASSWORD` environment variable)

### Accounts and Operations

- Cookie sessions with legacy Bearer token compatibility
- Local email/password, Logto, Google, GitHub, and Discord OAuth, enabled by environment variables
- Optional Cloudflare Turnstile verification hook
- Online presence heartbeat
- Sentry / GlitchTip error tracking, Pino structured logs, and Prometheus `/metrics`
- `/health` checks and automatic stale match cleanup

---

## Technical Architecture

```text
┌─────────────────────────────────────────────┐
│            Frontend (Vite + React)          │
│  React 19 · TypeScript · React Router 7     │
│  Tailwind CSS 4 · daisyUI 5 · Lucide        │
│  boardgame.io Client · PWA · Sentry         │
└──────────────────┬──────────────────────────┘
                   │ HTTP / WebSocket
┌──────────────────┴──────────────────────────┐
│            Game Server (port 3000)          │
│  boardgame.io Server · Koa · Socket.IO      │
│  Redis Adapter (Pub/Sub) · /api/* proxy     │
│  Health / Metrics / Rate Limit              │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴────────────────────────────┐
│             API Server (port 3001)            │
│  Node HTTP · PostgreSQL · Redis · HMAC tokens │
│  Accounts / OAuth / Decks / Matches / Feedback / Admin │
└───────────────────────────────────────────────┘
```

### Tech Stack

| Area                  | Technology                                    | Version   |
| --------------------- | --------------------------------------------- | --------- |
| UI framework          | React                                         | 19        |
| Routing               | React Router                                  | 7         |
| CSS framework         | Tailwind CSS + daisyUI 5 + Lucide React icons | 4 / 5     |
| Multiplayer framework | boardgame.io                                  | 0.50.2    |
| Build tool            | Vite                                          | 7         |
| Language              | TypeScript (strict mode)                      | 5.8       |
| Testing               | vitest (with `@vitest/coverage-v8`)           | 4         |
| Property testing      | fast-check                                    | 4         |
| Code style            | ESLint (typescript-eslint)                    | 9         |
| Formatting            | Prettier                                      | 3         |
| TypeScript runtime    | tsx                                           | 4         |
| PWA                   | vite-plugin-pwa                               | 1         |
| Analytics             | Umami + web-vitals                            | -         |
| Error tracking        | Sentry / GlitchTip                            | 10        |
| Structured logging    | Pino                                          | 10        |
| Metrics               | prom-client                                   | 15        |
| Validation            | zod                                           | 4         |
| Backend               | Node HTTP + PostgreSQL + Redis (pg / ioredis) | Node >=20 |

### Core Game Engine

```text
Rock-paper-scissors → Mulligan → Initial setup → Play cards → Resolve effects → Battle → End turn
```

- **Deterministic state machine** — driven by `GameState.step`, independent from boardgame.io's turn system
- **Effect rules engine** — maps Japanese effect text to structured game actions, covers all 267 effect lines (100%), and has been validated through multiple rounds of independent review
- **playerView** — hides the opponent's hand, deck, and face-down cards during online matches
- **Version compatibility checks** — room creation, joining, and resume flows compare app / build / rules versions to prevent mixed-version matches
- **Horizontal scaling support** — boardgame.io state uses a PostgreSQL adapter, while Socket.IO and boardgame.io Pub/Sub use Redis

### Data Storage

| Data                   | Storage                             | Notes                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------- |
| Card data              | PostgreSQL (`api/server.cjs`)       | Dynamic card data shared by the API and game server     |
| Card images            | Cloudflare R2 (`r2.dan.tw`)         | CDN for 422 card images                                 |
| User accounts          | PostgreSQL (`api/server.cjs`)       | Registration, login, ELO, session, and OAuth identities |
| Decks                  | PostgreSQL + localStorage           | Server sync + local backup + local custom decks         |
| Match records          | PostgreSQL + localStorage           | ELO changes + history + cleaned action logs             |
| Online match state     | PostgreSQL + Redis                  | boardgame.io state, metadata, and cross-node sync       |
| Matchmaking / presence | Redis                               | Matchmaking queue, rate limit, and online count         |
| Feedback data          | PostgreSQL + local upload directory | Posts, votes, comments, tags, and image attachments     |
| Dynamic config         | PostgreSQL (`game_config`)          | About page, preset decks, and manageable settings       |
| Online sessions        | localStorage                        | Reconnection data for online matches                    |
| Language preference    | localStorage                        | Stored in the browser                                   |

---

## Local Development

### Requirements

- Node.js `>=20` (see `package.json` `engines`; CI and Docker use Node 22)
- npm 10+

### Install and Run

```bash
# Install dependencies
npm install

# Frontend development (Vite dev server)
npm run dev
# → http://localhost:3000

# API server
cd api && npm install && npm start
# → http://localhost:3001

# Game server (with boardgame.io)
npm run build
npm run server
# → http://localhost:3000 (game + API proxy)
```

### Development Commands

| Command                                 | Description                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Start the Vite dev server                                                                    |
| `npm run build`                         | Run TypeScript checks (`typecheck` + `typecheck:scripts`) and then the Vite production build |
| `npm run typecheck`                     | Check app code with `tsc --noEmit`                                                           |
| `npm run typecheck:scripts`             | Check scripts with `tsc --noEmit -p tsconfig.scripts.json`                                   |
| `npm run lint`                          | Run ESLint                                                                                   |
| `npm run lint:fix`                      | Automatically fix ESLint issues                                                              |
| `npm run format`                        | Format and write files with Prettier                                                         |
| `npm run format:check`                  | Check Prettier formatting for CI                                                             |
| `npm test`                              | Run vitest unit tests once                                                                   |
| `npm run test:watch`                    | Run vitest in watch mode                                                                     |
| `npm run test:coverage`                 | Run vitest unit tests with coverage                                                          |
| `npm run smoke`                         | Game logic smoke test                                                                        |
| `npm run smoke:api`                     | Account / deck / match / leaderboard API loop                                                |
| `npm run smoke:online`                  | Online battle smoke test                                                                     |
| `npm run smoke:online-consistency`      | Online battle consistency smoke test                                                         |
| `npm run smoke:responsive`              | Run all responsive UI smoke tests                                                            |
| `npm run smoke:ui-responsive`           | Responsive smoke test for lobby / base UI                                                    |
| `npm run smoke:admin-responsive`        | Responsive smoke test for the admin console                                                  |
| `npm run smoke:battle-responsive`       | Responsive smoke test for battle screens                                                     |
| `npm run smoke:online-lobby-responsive` | Responsive smoke test for the online lobby                                                   |
| `npm run smoke:tools-responsive`        | Responsive smoke test for tool pages                                                         |
| `npm run rule:audit`                    | Audit effect parsing coverage                                                                |
| `npm run seed:cards`                    | Import card data from `SEED_CARDS_URL` / `SEED_CARD_API_URL` into PostgreSQL                 |
| `npm run migrate:sqlite-to-pg`          | Migrate old SQLite data to PostgreSQL (`users` / `decks` / `matches`, safe to rerun)         |
| `npm run server`                        | Start the boardgame.io game server                                                           |
| `npm run preview`                       | Preview the Vite production build                                                            |

### Tests

```bash
npm run smoke            # Game logic tests
npm run smoke:api        # Account / deck / match / leaderboard API loop
npm run smoke:online     # Online battle tests
npm run smoke:responsive # Responsive UI smoke tests
npm run rule:audit       # Effect parsing coverage audit
```

> `smoke:api` and `smoke:online` require PostgreSQL + Redis containers. Start them first:
>
> ```bash
> docker compose up -d postgres redis
> ```
>
> `smoke` (game logic) and `rule:audit` (effect parsing audit) are pure game-logic tests and do not require PG / Redis.

### Build

```bash
npm run build          # TypeScript checks + Vite production build
```

---

## Docker Deployment

```bash
# Build and start the four services
docker compose up -d --build

# Check status
docker compose ps
docker compose logs -f
```

Service ports:

- `3000` — game frontend + boardgame.io multiplayer
- `3001` — API server (accounts / decks / match records)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for details.

---

## Project Structure

```text
zutomayo-card-online/
├── src/
│   ├── game/                  # Game engine
│   │   ├── GameLogic.ts       # Core rules (turns, battle, damage)
│   │   ├── Game.ts            # boardgame.io Game definition
│   │   ├── types.ts           # Type definitions
│   │   ├── ai.ts              # AI opponent logic (easy / normal / hard)
│   │   ├── useAIMoves.ts      # React hook: automatic AI card play
│   │   ├── chronos.ts         # Chronos day/night system
│   │   ├── matchHistory.ts    # Match history
│   │   ├── cards/             # Card data loading and deck construction
│   │   │   ├── loader.ts      # Card data loading (local + API)
│   │   │   ├── deckBuilder.ts # Deck construction validation
│   │   │   ├── presetDecks.ts # Preset decks
│   │   │   ├── customDeck.ts  # Local custom decks (localStorage)
│   │   │   └── i18n.ts        # Card translation utilities
│   │   ├── effects/           # Effect engine
│   │   │   ├── parser.ts      # Japanese effect text → structured data
│   │   │   ├── executor.ts    # Structured data → game state changes
│   │   │   ├── types.ts       # Effect type definitions
│   │   │   └── choices.ts     # Player choice flow
│   │   └── __tests__/         # Game engine tests
│   │       ├── chronos.test.ts
│   │       └── invariants.test.ts
│   ├── components/            # React and feature components
│   │   ├── Board.tsx          # Main game screen (~78K)
│   │   ├── AIGame.tsx         # AI battle UI logic
│   │   ├── OnlineGame.tsx     # Online battle UI logic
│   │   ├── OnlineRoomInfo.tsx # Online room information panel
│   │   ├── OnlinePresenceBadge.tsx # Online presence display
│   │   ├── DeckEditor.tsx     # Deck editor
│   │   ├── DeckBuilderWorkspace.tsx # Deck builder workspace
│   │   ├── CardBrowser.tsx    # Card browser
│   │   ├── GameTutorialOverlay.tsx # Interactive tutorial overlay
│   │   ├── NetworkStatusNotifier.tsx # Network status prompt
│   │   ├── PwaInstallPrompt.tsx # PWA install prompt
│   │   ├── PwaStatusPrompt.tsx # PWA update prompt
│   │   ├── ErrorBoundary.tsx  # Frontend error boundary
│   │   ├── LanguageSwitcher.tsx # Language switcher
│   │   ├── MatchHistory.tsx   # Match history
│   │   └── lobby/             # Lobby subcomponents
│   │       ├── AuthSection.tsx      # Login / registration section
│   │       ├── DeckSelector.tsx     # Deck selector
│   │       ├── DifficultyButtons.tsx # Difficulty buttons (AI mode)
│   │       ├── RoomPanel.tsx        # Online room / matchmaking panel
│   │       └── shared.ts            # Shared types
│   ├── ui/                    # Design System v1
│   │   ├── primitives/        # Button / Panel / Sheet / Dialog / Toolbar, etc.
│   │   ├── layout/            # AppHeader / PageShell / PageHeader
│   │   ├── game/              # Battle UI components and responsive viewport helpers
│   │   ├── feedback/          # Shared feedback page state UI
│   │   ├── forms/             # Form components
│   │   └── tokens/            # colors / spacing / typography / z-index / motion
│   ├── pages/                 # Page routes
│   │   ├── LobbyPage.tsx      # Home lobby
│   │   ├── AILobbyPage.tsx    # AI mode menu
│   │   ├── AIGamePage.tsx     # AI battle page
│   │   ├── OnlineLobbyPage.tsx # Online mode menu
│   │   ├── OnlineGamePage.tsx # Online battle page
│   │   ├── TutorialGamePage.tsx # Tutorial battle page
│   │   ├── DeckEditorPage.tsx # Deck editor route
│   │   ├── MatchHistoryPage.tsx # Match history
│   │   ├── LeaderboardPage.tsx # Leaderboard
│   │   ├── FeedbackPage.tsx   # Feedback board
│   │   ├── ProfilePage.tsx    # Profile / OAuth identities
│   │   ├── BattleVisualQaPage.tsx # Battle visual QA
│   │   ├── AdminPage.tsx      # Admin console
│   │   └── I18nManager.tsx    # i18n translation management
│   ├── i18n/                  # Internationalization
│   │   ├── index.ts           # i18n core (t() / translate())
│   │   ├── zh-TW.ts           # Traditional Chinese (Taiwan)
│   │   ├── zh-HK.ts           # Cantonese (Hong Kong)
│   │   ├── zh-CN.ts           # Simplified Chinese
│   │   ├── ja.ts              # Japanese
│   │   ├── en.ts              # English
│   │   └── ko.ts              # Korean
│   ├── api/                   # API client
│   │   ├── client.ts          # fetch wrapper (auth / decks / matches / matchmaking / admin)
│   │   └── feedbackClient.ts  # Feedback API client
│   ├── server/                # Game server extensions
│   │   ├── db/
│   │   │   └── postgres-adapter.ts # PostgreSQL adapter
│   │   ├── observability/     # Pino logs and Prometheus metrics
│   │   ├── rateLimit.ts       # Redis rate limit
│   │   └── transport/
│   │       └── redis-pubsub.ts     # Redis Pub/Sub transport layer
│   ├── analytics.ts           # Umami page view / identify
│   ├── sentry.ts              # Frontend Sentry / GlitchTip setup
│   ├── webVitals.ts           # Web Vitals reporting
│   ├── version.ts             # app / build / rules version compatibility
│   ├── clientVersion.ts       # Frontend version-check API
│   ├── anonymousIdentity.ts   # Anonymous player identity
│   ├── onlineSession.ts       # Online session management (localStorage persistence)
│   ├── onlineRoomStatus.ts    # Online room status polling
│   ├── onlineStateGuard.ts    # Online state guard
│   ├── server.ts              # boardgame.io game server entry point
│   ├── App.tsx                # App entry (routing + NavBar + tutorial + reconnection)
│   └── main.tsx               # React DOM mount point
├── api/                       # API server
│   ├── server.cjs             # Node HTTP + PostgreSQL + Redis + OAuth + feedback
│   ├── *Service.cjs           # Account, deck, match, matchmaking, card, feedback services
│   ├── schemas.cjs            # zod request schemas
│   ├── validate.cjs           # Request validation
│   ├── observability.cjs      # API logs / metrics / request tracing
│   ├── package.json
│   └── Dockerfile
├── scripts/                   # Test and utility scripts
│   ├── game-smoke.ts          # Game logic smoke test (~148K)
│   ├── api-smoke.ts           # API integration smoke test
│   ├── online-smoke.ts        # Online battle smoke test
│   ├── rule-audit.ts          # Effect parsing coverage audit
│   ├── effect-smoke.ts        # Effect engine unit test
│   ├── seed-cards-pg.ts       # Import card data into PostgreSQL
│   ├── migrate-sqlite-to-pg.ts # SQLite → PostgreSQL migration
│   ├── migrate-users-to-logto.cjs # Local users → Logto migration
│   ├── *responsive-smoke.mjs  # Responsive UI smoke tests
│   ├── pg-backup.sh           # PostgreSQL backup
│   ├── deploy-server4.sh      # server4 deployment helper
│   └── semantic-audit-dump.ts # Semantic audit data export
├── data/                      # Translation and OCR review data
├── qa.json                    # 74 official Q&A entries
├── rules.md                   # Complete game rules
├── Dockerfile                 # Game server image
├── docker-compose.yml         # Four-service deployment (PG + Redis + game + api)
└── docs/
    ├── API.md                 # REST API documentation
    ├── DEPLOYMENT.md          # Deployment guide
    └── uiux/                  # UI/UX design-system and refactor docs
```

---

## Effect Engine

### Coverage

```text
Total cards: 422
Effect cards: 250
Effect lines: 267
Parsed: 267 lines (100%)
Unparsed: 0
Partially parsed: 0
```

### Architecture

```text
Japanese effect text → parseEffect() → { trigger, conditions[], action }
                                      ↓
                                executeEffect() → game state changes
```

### Supported Effect Types (Sorted by Count)

| Type                    | Description                                    | Count  |
| ----------------------- | ---------------------------------------------- | ------ |
| boostAttack             | Increase attack                                | 150    |
| requestChoice           | Player choices (abyss / hand / ordering, etc.) | 30     |
| heal                    | HP recovery                                    | 13     |
| damageReduce            | Damage reduction                               | 7      |
| moveSelfAreaEnchant     | Automatically move Area Enchant                | 5      |
| clockSet                | Set the clock                                  | 4      |
| returnAreaEnchantToDeck | Return Area Enchant to deck                    | 4      |
| useFromAbyss            | Use a card from the abyss                      | 3      |
| reduceAttack            | Reduce attack                                  | 3      |
| swapAttack              | Swap day/night attack values                   | 2      |
| drawCards               | Draw cards                                     | 2      |
| millDeckToAbyss         | Mill cards from deck to abyss                  | 2      |
| directDamage            | Direct damage                                  | 2      |
| clockAdvance            | Advance the clock                              | 2      |
| Other (17 types)        | Special effects                                | 1 each |

### Supported Condition Types

| Condition                         | Description                        |
| --------------------------------- | ---------------------------------- |
| chronos                           | Day/night check (night / day)      |
| opponentElement / selfElement     | Element check                      |
| hpLessOrEqual / hpComparison      | HP condition                       |
| opponentPowerCost / selfPowerCost | Energy cost condition              |
| zoneCountComparison               | Compare card counts in zones       |
| previousCharElement               | Previous turn character element    |
| namedCardInBattleZone             | Named card is in the battle zone   |
| specificElements                  | Specific element set               |
| drawOccurredThisEffect            | A draw occurred during this effect |
| battleLost                        | Battle was lost                    |

---

## Routes

| Path                    | Page               | Description                          |
| ----------------------- | ------------------ | ------------------------------------ |
| `/`                     | LobbyPage          | Home lobby with mode switching       |
| `/online`               | OnlineLobbyPage    | Online battle menu                   |
| `/ai`                   | AILobbyPage        | AI practice menu                     |
| `/play/ai`              | AIGamePage         | AI battle                            |
| `/play/online/:matchID` | OnlineGamePage     | Online battle                        |
| `/tutorial`             | TutorialGamePage   | Tutorial battle                      |
| `/deck-builder`         | DeckEditorPage     | Deck editor                          |
| `/history`              | MatchHistoryPage   | Match history                        |
| `/leaderboard`          | LeaderboardPage    | Leaderboard                          |
| `/feedback`             | FeedbackPage       | Feedback board                       |
| `/profile`              | ProfilePage        | Profile / OAuth identity management  |
| `/admin`                | AdminPage          | Admin console (requires admin token) |
| `/admin/i18n`           | I18nManager        | i18n translation management          |
| `/qa/battle`            | BattleVisualQaPage | Battle visual QA                     |

---

## API Endpoints

### System and Public Data

| Method | Path                      | Auth | Description                       |
| ------ | ------------------------- | ---- | --------------------------------- |
| GET    | `/api/app-version`        | None | App / build / rules version       |
| GET    | `/api/version`            | None | App / build / rules version       |
| GET    | `/api/cards`              | None | Card list                         |
| GET    | `/api/cards/i18n`         | None | All card effect translations      |
| GET    | `/api/cards/:id/i18n`     | None | Single-card effect translations   |
| GET    | `/api/config`             | None | Dynamic config such as About page |
| GET    | `/api/preset-decks`       | None | Preset decks                      |
| GET    | `/api/leaderboard`        | None | Leaderboard                       |
| GET    | `/api/presence`           | None | Current online count              |
| POST   | `/api/presence/heartbeat` | None | Update online presence heartbeat  |

### Accounts, OAuth, and Profile

| Method | Path                                         | Auth         | Description                        |
| ------ | -------------------------------------------- | ------------ | ---------------------------------- |
| POST   | `/api/register`                              | None         | Register an account                |
| POST   | `/api/login`                                 | None         | Log in                             |
| POST   | `/api/logout`                                | Cookie / JWT | Log out and clear session          |
| GET    | `/api/oauth/providers`                       | None         | OAuth / Logto config and providers |
| GET    | `/api/oauth/:provider/start`                 | None         | Start OAuth login or identity link |
| GET    | `/api/oauth/:provider/callback`              | None         | OAuth callback                     |
| POST   | `/api/oauth/session`                         | None         | Exchange OAuth session             |
| GET    | `/api/profile`                               | Cookie / JWT | Get user profile                   |
| PUT    | `/api/profile`                               | Cookie / JWT | Update nickname                    |
| PUT    | `/api/profile/password`                      | Cookie / JWT | Update local password              |
| GET    | `/api/profile/identities`                    | Cookie / JWT | List linked OAuth identities       |
| DELETE | `/api/profile/identities/:provider`          | Cookie / JWT | Unlink an OAuth identity           |
| GET    | `/api/account-center`                        | Cookie / JWT | Read Logto Account Center data     |
| POST   | `/api/account-center/verifications/password` | Cookie / JWT | Create Logto password verification |
| POST   | `/api/account-center/password`               | Cookie / JWT | Update password through Logto      |

### Decks, Matches, and Matchmaking

| Method | Path                      | Auth | Description                                                 |
| ------ | ------------------------- | ---- | ----------------------------------------------------------- |
| GET    | `/api/decks`              | JWT  | List decks                                                  |
| POST   | `/api/decks`              | JWT  | Create a deck                                               |
| PUT    | `/api/decks/:id`          | JWT  | Update a deck                                               |
| DELETE | `/api/decks/:id`          | JWT  | Delete a deck                                               |
| POST   | `/api/matches`            | JWT  | Report match result (authenticated user must be the winner) |
| GET    | `/api/matches`            | JWT  | Get match history for the authenticated user                |
| GET    | `/api/matches/:id/log`    | None | Get cleaned action log                                      |
| POST   | `/api/matchmaking/queue`  | JWT  | Join matchmaking queue                                      |
| GET    | `/api/matchmaking/status` | JWT  | Check matchmaking status                                    |
| DELETE | `/api/matchmaking/queue`  | JWT  | Leave queue                                                 |
| PUT    | `/api/matchmaking/match`  | JWT  | Host reports boardgame.io matchID                           |

### Admin Console

| Method | Path                        | Auth  | Description                      |
| ------ | --------------------------- | ----- | -------------------------------- |
| POST   | `/api/admin/login`          | None  | Admin login, returns admin token |
| GET    | `/api/admin/users`          | Admin | Get user list                    |
| GET    | `/api/admin/matches`        | Admin | Get all matches                  |
| PUT    | `/api/admin/users/:id/elo`  | Admin | Reset user ELO                   |
| PUT    | `/api/admin/cards/:id`      | Admin | Update card data                 |
| PUT    | `/api/admin/cards/:id/i18n` | Admin | Update card effect translation   |
| PUT    | `/api/admin/config/:key`    | Admin | Update dynamic config            |
| POST   | `/api/admin/cards/reload`   | Admin | Reload game-server card data     |

### Feedback Board

| Method        | Path                                          | Auth            | Description                   |
| ------------- | --------------------------------------------- | --------------- | ----------------------------- |
| GET           | `/api/feedback/posts`                         | None            | List feedback posts           |
| POST          | `/api/feedback/posts`                         | Anonymous / JWT | Create feedback post          |
| GET           | `/api/feedback/posts/:id`                     | None            | Get post and comments         |
| PUT           | `/api/feedback/posts/:id`                     | Author          | Edit post                     |
| POST          | `/api/feedback/posts/:id/votes`               | Anonymous / JWT | Toggle post vote              |
| POST          | `/api/feedback/posts/:id/comments`            | Anonymous / JWT | Add comment                   |
| GET           | `/api/feedback/posts/:id/voters`              | None            | List voters                   |
| PUT           | `/api/feedback/comments/:id`                  | Author          | Edit comment                  |
| DELETE        | `/api/feedback/comments/:id`                  | Author / Admin  | Delete comment                |
| POST          | `/api/feedback/comments/:id/votes`            | Anonymous / JWT | Toggle comment like           |
| POST / DELETE | `/api/feedback/comments/:id/reactions/:emoji` | Anonymous / JWT | Toggle comment emoji reaction |
| GET           | `/api/feedback/stats`                         | None            | Feedback stats                |
| GET           | `/api/feedback/tags`                          | None            | List tags                     |
| GET           | `/api/feedback/similar`                       | None            | Search similar posts          |
| POST          | `/api/feedback/uploads`                       | Anonymous / JWT | Upload image attachment       |
| GET           | `/api/feedback/images/:bkey`                  | None            | Read image attachment         |
| PUT           | `/api/feedback/admin/posts/:id/status`        | Admin           | Update feedback status        |
| PUT           | `/api/feedback/admin/posts/:id/tag`           | Admin           | Update feedback tag           |
| DELETE        | `/api/feedback/admin/posts/:id`               | Admin           | Delete feedback post          |
| POST          | `/api/feedback/admin/posts/:id/duplicate`     | Admin           | Mark as duplicate             |
| POST          | `/api/feedback/admin/tags`                    | Admin           | Create tag                    |
| DELETE        | `/api/feedback/admin/tags/:id`                | Admin           | Delete tag                    |

### Game Server Endpoints

| Method | Path                              | Auth | Description                          |
| ------ | --------------------------------- | ---- | ------------------------------------ |
| GET    | `/health`                         | None | PG / Redis health check              |
| GET    | `/metrics`                        | None | Prometheus metrics                   |
| POST   | `/games/zutomayo-card/:id/join`   | None | Join a boardgame.io match            |
| POST   | `/games/zutomayo-card/:id/resume` | None | Validate credentials and resume seat |

Rate limits: `/api/login`, `/api/register`, and `/api/admin/login` are limited to 10/min; all others are 120/min.
Game-server `/games/*` routes also have a Redis rate limit, defaulting to 120/min.

See [docs/API.md](docs/API.md) for details.

---

## Internationalization

The app supports 6 languages. All UI strings and 250 effect cards have corresponding translations:

| Language                     | Code  |
| ---------------------------- | ----- |
| Traditional Chinese (Taiwan) | zh-TW |
| Cantonese (Hong Kong)        | zh-HK |
| Simplified Chinese           | zh-CN |
| Japanese                     | ja    |
| English                      | en    |
| Korean                       | ko    |

Translation management: `/admin` → i18n management page

---

## Related Documentation

- [Game rules](rules.md) — complete official rules
- [Official Q&A](qa.json) — 74 official Q&A entries
- [Development plan](docs/PLAN.md) — phase completion status
- [REST API](docs/API.md) — API endpoint documentation
- [Deployment guide](docs/DEPLOYMENT.md) — Docker deployment instructions

---

## License

This project is for personal learning purposes. Card copyrights belong to ZUTOMAYO / Sony Music Entertainment.
