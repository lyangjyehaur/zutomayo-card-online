# Deployment

Production deployment uses [docker-compose.yml](../docker-compose.yml) with four services:

- `postgres`: PostgreSQL 16 (`postgres:16-alpine`) database. Shared data layer for both boardgame.io match state (`bjg_matches` table) and API data (users/decks/matches). Healthcheck: `pg_isready`.
- `redis`: Redis 7 (`redis:7-alpine`, `appendonly yes`, `maxmemory-policy allkeys-lru`). Powers boardgame.io PubSub, Socket.IO redis-adapter, matchmaking queue, and rate-limit counters. Healthcheck: `redis-cli ping`.
- `game`: boardgame.io server, built React app, static card/admin assets, and `/api/*` proxy. Persists match state via `PostgresAdapter` and broadcasts cross-node via `RedisPubSub` + `@socket.io/redis-adapter`.
- `api`: REST API service with PostgreSQL + Redis persistence. Uses `pg.Pool` for users/decks/matches and Redis for the matchmaking queue (sorted set + Lua atomic pairing) and rate limit (`INCR` + `EXPIRE`).

Target host: `149.104.6.238` on Debian 12, 8 cores, 8 GB RAM.

## Runtime Requirements / 執行需求

- Node.js `>=20` (see `engines` in [package.json](../package.json)); the Docker images use Node 22.
- Docker with Compose v2.
- Persistent volumes for PostgreSQL and Redis data (see [Volumes](#volumes--資料卷)).

## Ports / 連接埠

| Port   | Service | Purpose                                                          |
| ------ | ------- | ---------------------------------------------------------------- |
| `3000` | `game`  | Browser app, boardgame.io HTTP routes, Socket.IO, `/api/*` proxy |
| `3001` | `api`   | Direct REST API access                                           |

Users should normally open `http://<host>:3000`.

## Compose Setup / Compose 設定

Start or rebuild all four services:

```bash
docker compose up -d --build
```

Watch logs:

```bash
docker compose logs -f game api
```

Stop services:

```bash
docker compose down
```

## Environment / 環境變數

Variables are passed through `docker-compose.yml` from the host environment (e.g. via a `.env` file or shell export). The Compose file reads `${VAR:-}` for secrets, so unset values become empty strings rather than failing.

### `game`

| Variable          | Default                 | Notes                                                                                                                           |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `3000`                  | boardgame.io/static server port inside the container.                                                                           |
| `NODE_ENV`        | `production` in Compose | Runtime mode.                                                                                                                   |
| `PG_HOST`         | `postgres`              | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                 |
| `PG_PORT`         | `5432`                  | PostgreSQL port.                                                                                                                |
| `PG_USER`         | `zutomayo`              | PostgreSQL user.                                                                                                                |
| `PG_PASSWORD`     | `zutomayo_dev`          | PostgreSQL password.                                                                                                            |
| `PG_DATABASE`     | `zutomayo`              | PostgreSQL database name. boardgame.io match state is stored in the `bjg_matches` table.                                        |
| `REDIS_URL`       | `redis://redis:6379`    | Redis connection URL for `RedisPubSub` and `@socket.io/redis-adapter`. Use `redis://localhost:6379` for local dev.              |
| `ALLOWED_ORIGINS` | empty                   | Comma-separated extra origins allowed by boardgame.io CORS.                                                                     |
| `JWT_SECRET`      | empty                   | Shared HMAC secret. The `game` service forwards it so the same key signs/verifies across services; set the same value as `api`. |

Frontend build-time variables (baked into the bundle at `vite build`):

| Variable       | Default | Notes                                                       |
| -------------- | ------- | ----------------------------------------------------------- |
| `VITE_API_URL` | `/api`  | API base used by [src/api/client.ts](../src/api/client.ts). |

> Admin authentication is no longer handled in the frontend. The `VITE_ADMIN_PASSWORD` build-time variable has been removed; admin login now goes through `POST /api/admin/login` backed by the `ADMIN_PASSWORD` environment variable on the `api` service.

### `api`

| Variable          | Default              | Notes                                                                                                                                |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `API_PORT`        | `3001`               | API service port inside the container.                                                                                               |
| `PG_HOST`         | `postgres`           | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                      |
| `PG_PORT`         | `5432`               | PostgreSQL port.                                                                                                                     |
| `PG_USER`         | `zutomayo`           | PostgreSQL user.                                                                                                                     |
| `PG_PASSWORD`     | `zutomayo_dev`       | PostgreSQL password.                                                                                                                 |
| `PG_DATABASE`     | `zutomayo`           | PostgreSQL database name. Source of truth for users, decks, matches, and leaderboard.                                                |
| `REDIS_URL`       | `redis://redis:6379` | Redis connection URL for the matchmaking queue and rate limit. Use `redis://localhost:6379` for local dev.                           |
| `JWT_SECRET`      | random per process   | HMAC key for signed user/admin tokens. Set a stable secret in production or all tokens become invalid when the API process restarts. |
| `ADMIN_PASSWORD`  | empty                | Password checked by `POST /api/admin/login`. When empty, admin login returns `503` and admin endpoints are effectively disabled.     |
| `ALLOWED_ORIGINS` | empty                | Comma-separated CORS allowlist. When empty, the server falls back to localhost dev origins only.                                     |

## Volumes / 資料卷

| Volume       | Mount                               | Purpose                                                                                                                                 |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pg-data`    | `postgres:/var/lib/postgresql/data` | PostgreSQL data directory. Source of truth for boardgame.io match state (`bjg_matches`) and API data (users/decks/matches/leaderboard). |
| `redis-data` | `redis:/data`                       | Redis AOF persistence directory. Holds matchmaking queue and rate-limit counters; loss is tolerable but causes a cold restart.          |

## PostgreSQL Backup / Restore

PostgreSQL stores all registered users, saved decks, submitted matches, leaderboard state, and boardgame.io match state in the `pg-data` Docker volume (the `postgres` data directory). Back up with `pg_dump`; no service downtime is required.

Create a consistent SQL backup while the service is running:

```bash
docker compose exec postgres pg_dump -U zutomayo zutomayo > backup.sql
```

Restore from a SQL backup file:

```bash
docker compose exec -T postgres psql -U zutomayo zutomayo < backup.sql
```

For a compressed custom-format backup (supports parallel and selective restore):

```bash
# backup
docker compose exec postgres pg_dump -U zutomayo -Fc zutomayo > backup.dump
# restore
docker compose exec -T postgres pg_restore -U zutomayo -d zutomayo -c < backup.dump
```

## 水平擴展 / Horizontal Scaling

The `game` and `api` services can be replicated (multiple instances) to scale horizontally. PostgreSQL serves as the shared data layer — both boardgame.io (via `PostgresAdapter`, writing the `bjg_matches` table) and the API (via `pg.Pool`, writing the users/decks/matches tables) use the same instance, isolated by table prefix (`bjg_` vs no prefix).

Redis serves four roles simultaneously:

- boardgame.io PubSub (custom `RedisPubSub` implementing `GenericPubSub`) for cross-node match-state broadcast.
- `@socket.io/redis-adapter` for Socket.IO horizontal scaling.
- Matchmaking queue shared across API instances: a Redis sorted set (`mm:queue`) plus a hash (`mm:{userId}`) plus a Lua script perform atomic pairing, so multiple instances never match the same user twice.
- Rate-limit counters shared across API instances: Redis `INCR` + `EXPIRE` for cross-instance counting.

To scale up, increase the replica count for `game` and/or `api`. Both `postgres` and `redis` should remain single instances. Ensure `JWT_SECRET` and `ALLOWED_ORIGINS` are identical across all instances of the same service.

## 資料遷移 / SQLite → PostgreSQL Migration

To migrate data from a previous SQLite deployment to PostgreSQL, use [scripts/migrate-sqlite-to-pg.ts](../scripts/migrate-sqlite-to-pg.ts). It migrates the `users`, `decks`, and `matches` tables using `ON CONFLICT DO NOTHING`, so it is safe to re-run.

```bash
npm i -D better-sqlite3  # migration-only dependency, not required in production
SQLITE_PATH=/data/zutomayo.db \
PG_HOST=localhost PG_USER=zutomayo PG_PASSWORD=zutomayo_dev \
PG_DATABASE=zutomayo npm run migrate:sqlite-to-pg
```

boardgame.io match state is not migrated — only API data (users/decks/matches) is. In-flight matches must be restarted after the cutover.

## Update / 更新

Typical deploy from the project directory:

```bash
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 game api
```

After deployment, verify:

```bash
curl http://localhost:3000/
curl http://localhost:3001/api/leaderboard
```

For application-level verification, run before building the image when possible:

```bash
npm run smoke
npm run smoke:api
npm run build
npm run smoke:online
```

## CI / 持續整合

GitHub Actions workflow: [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs on every push and pull request targeting `master`.

Runner: `ubuntu-latest`, Node 22, with `npm` caching.

Pipeline steps, in order:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 22, npm cache)
3. `npm ci` — install dependencies from the lockfile.
4. `npm run format:check` — Prettier formatting check.
5. `npm run lint` — ESLint.
6. `npm run typecheck` — `tsc --noEmit` for the app.
7. `npm test` — vitest unit tests.
8. `npm run build` — full production build (includes `typecheck:scripts` and `vite build`).

A failing step blocks the merge. The `smoke:*` scripts are intentionally not part of CI because they require a running API/boardgame.io server.

### Local pre-push checklist / 本機推送前檢查

To mirror CI locally before pushing:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```
