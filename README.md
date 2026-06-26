# ZUTOMAYO CARD Online

Digital implementation of ZUTOMAYO CARD for local play, AI practice, and online two-player matches. The rules engine is deterministic and runs on boardgame.io, while user/deck/ranking persistence is handled by a separate SQLite-backed API service.

## Overview / 專案概覽

- Frontend: Vite, React, TypeScript, React Router.
- Game engine: boardgame.io with an explicit step-based `GameState` machine.
- Game server: boardgame.io server in [src/server.ts](src/server.ts) on port `3000`.
- API server: REST API in [api/server.cjs](api/server.cjs) with SQLite via `better-sqlite3` on port `3001`.
- Deployment: Docker Compose with `game` and `api` services.
- Production host target: `149.104.6.238` on Debian 12, 8 cores, 8 GB RAM.

Main game flow:

```text
janken -> mulligan -> initialSet -> turnSet -> effectOrder -> turnSet/gameOver
```

## Features / 功能

- 422 cards in [cards.json](cards.json), with images served from `https://r2.dan.tw/cards/...`.
- 250 cards with effect text. Current parser audit: 257 parsed lines out of 267 effect lines, with 55 parsed-but-partial lines still needing executor review.
- Six UI languages: `zh-TW`, `zh-HK`, `zh-CN`, `ja`, `en`, `ko`.
- Local two-player mode, online multiplayer rooms, and AI practice.
- Easy, Normal, and Hard AI levels; Hard uses a lookahead simulation over legal set combinations plus heuristic scoring.
- Deck editor over the full 422-card pool, stored in browser localStorage today.
- Four preset decks: Dark, Flame, Electric, Wind.
- Interactive tutorial and browser-local match history.
- Online reconnect/resume UX using stored boardgame.io match credentials.
- 60-second client-side turn timer during turn setup.
- Admin card data viewer and i18n management pages behind `VITE_ADMIN_PASSWORD`.
- REST API for register/login/profile, authenticated deck CRUD, match result submission, and ELO leaderboard.

## Tech Stack / 技術棧

- React 19 + React Router 7 + TypeScript + Vite 7.
- boardgame.io 0.50 for synchronized state, WebSocket transport, match lifecycle, and `playerView` hidden-information filtering.
- Node 22 containers.
- SQLite through `better-sqlite3`.
- Docker Compose for production-style deployment.

## Run Locally / 本機執行

Install root dependencies:

```bash
npm install
```

Run frontend-only development:

```bash
npm run dev
```

Vite serves on `http://localhost:3000` and proxies `/api` to `http://localhost:3001`. This is best for UI work. Online boardgame.io routes are served by `npm run server`, not Vite.

Run the API service:

```bash
cd api
npm install
npm start
```

Run the game server:

```bash
npm run build
API_URL=http://localhost:3001 npm run server
```

The game server serves the built frontend, boardgame.io endpoints, Socket.IO transport, card data assets, and `/api/*` proxy from `http://localhost:3000`.

Run with Docker Compose:

```bash
docker compose up --build
```

Then open `http://localhost:3000`. The API is also exposed directly at `http://localhost:3001/api`.

## Scripts / 指令

```bash
npm run dev           # Vite frontend dev server
npm run build         # typecheck + production frontend build
npm run server        # boardgame.io/static server from dist
npm run smoke         # deterministic game smoke tests
npm run smoke:online  # boardgame.io two-client smoke test
npm run rule:audit    # card effect parser coverage audit
```

## References / 參考

- [Rules](rules.md)
- [Official Q&A data](qa.json)
- [Implementation plan](PLAN.md)
- [REST API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Card effect gap audit](RULE_GAP_AUDIT.md)
