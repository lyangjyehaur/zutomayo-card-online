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

| Variable                    | Default                 | Notes                                                                                                                                                            |
| --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3000`                  | boardgame.io/static server port inside the container.                                                                                                            |
| `NODE_ENV`                  | `production` in Compose | Runtime mode.                                                                                                                                                    |
| `PG_HOST`                   | `postgres`              | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                                                  |
| `PG_PORT`                   | `5432`                  | PostgreSQL port.                                                                                                                                                 |
| `PG_USER`                   | `zutomayo`              | PostgreSQL user.                                                                                                                                                 |
| `PG_PASSWORD`               | `zutomayo_dev`          | PostgreSQL password.                                                                                                                                             |
| `PG_DATABASE`               | `zutomayo`              | PostgreSQL database name. boardgame.io match state is stored in the `bjg_matches` table.                                                                         |
| `REDIS_URL`                 | `redis://redis:6379`    | Redis connection URL for `RedisPubSub` and `@socket.io/redis-adapter`. Use `redis://localhost:6379` for local dev.                                               |
| `REDIS_DB`                  | `0`                     | Redis DB index (0-15) for key isolation when sharing a Redis instance with other services. See [Reusing Existing PG/Redis](#reusing-existing-postgresql--redis). |
| `ALLOWED_ORIGINS`           | empty                   | Comma-separated extra origins allowed by boardgame.io CORS.                                                                                                      |
| `GLITCHTIP_DSN`             | empty                   | GlitchTip DSN for server-side error reporting. `SENTRY_DSN` can be used instead.                                                                                 |
| `SENTRY_DSN`                | empty                   | Sentry-compatible DSN for server-side error reporting.                                                                                                           |
| `SENTRY_ENVIRONMENT`        | `production` in Compose | Environment name attached to server-side error events.                                                                                                           |
| `SENTRY_RELEASE`            | empty                   | Release/version attached to server-side error events, usually a commit SHA.                                                                                      |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`                     | Optional tracing sample rate. Keep `0` unless you intentionally want performance traces.                                                                         |

Frontend build-time variables (baked into the bundle at `vite build`):

| Variable                         | Default | Notes                                                                                                                                         |
| -------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`                   | `/api`  | API base used by [src/api/client.ts](../src/api/client.ts).                                                                                   |
| `VITE_LOGTO_ENDPOINT`            | empty   | Logto tenant endpoint, for example `https://example.logto.app`. Logto UI is enabled only when endpoint, app ID, and API resource are all set. |
| `VITE_LOGTO_APP_ID`              | empty   | Logto SPA application ID.                                                                                                                     |
| `VITE_LOGTO_API_RESOURCE`        | empty   | Logto API resource indicator/audience used when requesting access tokens for this API. Required to enable Logto sign-in.                      |
| `VITE_GLITCHTIP_DSN`             | empty   | GlitchTip DSN for browser error reporting. `VITE_SENTRY_DSN` can be used instead.                                                             |
| `VITE_SENTRY_DSN`                | empty   | Sentry-compatible DSN for browser error reporting.                                                                                            |
| `VITE_SENTRY_ENVIRONMENT`        | empty   | Environment name attached to browser error events.                                                                                            |
| `VITE_SENTRY_RELEASE`            | empty   | Release/version attached to browser error events, usually a commit SHA.                                                                       |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0`     | Optional browser tracing sample rate. Keep `0` unless you intentionally want performance traces.                                              |

> Admin authentication is no longer handled in the frontend. The `VITE_ADMIN_PASSWORD` build-time variable has been removed; admin login now goes through `POST /api/admin/login` backed by the `ADMIN_PASSWORD` environment variable on the `api` service.

### `api`

| Variable                    | Default                 | Notes                                                                                                                                                            |
| --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_PORT`                  | `3001`                  | API service port inside the container.                                                                                                                           |
| `PG_HOST`                   | `postgres`              | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                                                  |
| `PG_PORT`                   | `5432`                  | PostgreSQL port.                                                                                                                                                 |
| `PG_USER`                   | `zutomayo`              | PostgreSQL user.                                                                                                                                                 |
| `PG_PASSWORD`               | `zutomayo_dev`          | PostgreSQL password.                                                                                                                                             |
| `PG_DATABASE`               | `zutomayo`              | PostgreSQL database name. Source of truth for users, decks, matches, and leaderboard.                                                                            |
| `REDIS_URL`                 | `redis://redis:6379`    | Redis connection URL for the matchmaking queue and rate limit. Use `redis://localhost:6379` for local dev.                                                       |
| `REDIS_DB`                  | `0`                     | Redis DB index (0-15) for key isolation when sharing a Redis instance with other services. See [Reusing Existing PG/Redis](#reusing-existing-postgresql--redis). |
| `JWT_SECRET`                | random per process      | HMAC key for signed admin tokens. Set a stable secret in production or admin sessions become invalid when the API process restarts.                              |
| `ADMIN_PASSWORD`            | empty                   | Password checked by `POST /api/admin/login`. When empty, admin login returns `503` and admin endpoints are effectively disabled.                                 |
| `ALLOWED_ORIGINS`           | empty                   | Comma-separated CORS allowlist. When empty, the server falls back to localhost dev origins only.                                                                 |
| `LOGTO_ISSUER`              | empty                   | Logto OIDC issuer. Usually `VITE_LOGTO_ENDPOINT` plus `/oidc` is accepted automatically, so `https://example.logto.app` is valid.                                |
| `LOGTO_AUDIENCE`            | empty                   | Expected access-token audience. Set this to the same value as `VITE_LOGTO_API_RESOURCE`.                                                                         |
| `GLITCHTIP_DSN`             | empty                   | GlitchTip DSN for server-side error reporting. `SENTRY_DSN` can be used instead.                                                                                 |
| `SENTRY_DSN`                | empty                   | Sentry-compatible DSN for server-side error reporting.                                                                                                           |
| `SENTRY_ENVIRONMENT`        | `production` in Compose | Environment name attached to server-side error events.                                                                                                           |
| `SENTRY_RELEASE`            | empty                   | Release/version attached to server-side error events, usually a commit SHA.                                                                                      |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`                     | Optional tracing sample rate. Keep `0` unless you intentionally want performance traces.                                                                         |

## Logto Account Management

Logto can be used as the primary account system while this app keeps local gameplay data (ELO, decks, match history, leaderboard rows) in PostgreSQL. On first authenticated API call, the API verifies the Logto access token and creates or updates a local `users` row by Logto `sub`.

Logto Console setup:

1. Create a Single Page Application.
2. Add redirect URI `https://<app-host>/callback` and post sign-out redirect URI `https://<app-host>/`.
3. Create an API resource and copy its indicator/audience.
4. Put the values in your deployment `.env`:

```bash
VITE_LOGTO_ENDPOINT=https://<tenant>.logto.app
VITE_LOGTO_APP_ID=<spa-app-id>
VITE_LOGTO_API_RESOURCE=https://<your-api-resource>
LOGTO_ISSUER=https://<tenant>.logto.app
LOGTO_AUDIENCE=https://<your-api-resource>
```

`VITE_LOGTO_*` values are baked into the frontend bundle at `docker compose build` time. Rebuild the `game` image after changing them. `LOGTO_ISSUER` and `LOGTO_AUDIENCE` are runtime variables for the `api` service.

The app does not expose local email/password registration or login routes. User identity comes from Logto; PostgreSQL stores only game-local profile, deck, match, and leaderboard data linked by Logto `sub`.

## Error Reporting / GlitchTip

The app uses Sentry-compatible SDKs, so the same integration works with GlitchTip or Sentry. Set GlitchTip DSNs in deployment `.env`:

```bash
GLITCHTIP_DSN=https://<key>@glitchtip.example/<project-id>
VITE_GLITCHTIP_DSN=https://<browser-key>@glitchtip.example/<project-id>
SENTRY_ENVIRONMENT=production
VITE_SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<commit-sha>
VITE_SENTRY_RELEASE=<commit-sha>
```

`VITE_*` values are baked into the browser bundle at build time, so rebuild the `game` image after changing the frontend DSN, environment, release, or tracing sample rate.

The browser integration captures React errors and unhandled client errors. The API and game server capture server exceptions, startup/schema failures, cleanup failures, shutdown failures, Koa errors, and API proxy failures. User context is intentionally limited to local user ID and nickname; email is not sent. Session replay is not enabled to avoid leaking hidden card or deck information.

## Volumes / 資料卷

| Volume       | Mount                               | Purpose                                                                                                                                 |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pg-data`    | `postgres:/var/lib/postgresql/data` | PostgreSQL data directory. Source of truth for boardgame.io match state (`bjg_matches`) and API data (users/decks/matches/leaderboard). |
| `redis-data` | `redis:/data`                       | Redis AOF persistence directory. Holds matchmaking queue and rate-limit counters; loss is tolerable but causes a cold restart.          |

## PostgreSQL Backup / Restore

PostgreSQL stores all Logto-linked users, saved decks, submitted matches, leaderboard state, and boardgame.io match state in the `pg-data` Docker volume (the `postgres` data directory). Back up with `pg_dump`; no service downtime is required.

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

To scale up, increase the replica count for `game` and/or `api`. Both `postgres` and `redis` should remain single instances. Ensure `LOGTO_ISSUER`, `LOGTO_AUDIENCE`, `JWT_SECRET`, and `ALLOWED_ORIGINS` are identical across all API instances.

## Reusing Existing PostgreSQL / Redis

To reuse PostgreSQL and Redis instances already running on the server (instead of starting the dedicated `postgres` / `redis` containers), isolate data by **database** (PostgreSQL) and **DB index** (Redis).

### PostgreSQL — separate database

Create a dedicated database; the app uses generic table names (`users`, `decks`, `matches`, `bjg_matches`) that would collide with other services sharing the same database.

```bash
# On the server's existing PostgreSQL (as superuser)
psql -U postgres -h localhost
CREATE DATABASE zutomayo;
CREATE USER zutomayo WITH PASSWORD 'zutomayo_dev';
GRANT ALL PRIVILEGES ON DATABASE zutomayo TO zutomayo;
```

Then point the services at the existing instance — remove the `postgres` and `redis` services from `docker-compose.yml` (or override with an external compose file) and set:

```bash
PG_HOST=<existing-pg-host>
PG_PORT=5432
PG_USER=zutomayo
PG_PASSWORD=zutomayo_dev
PG_DATABASE=zutomayo   # the dedicated database created above
```

Schemas (`users`/`decks`/`matches`/`bjg_matches`) are created automatically on startup via `CREATE TABLE IF NOT EXISTS`.

### Redis — separate DB index

Redis databases (0-15) are logical namespaces — all keys in DB index N are invisible to clients using a different index. Use a dedicated index to avoid key collisions with other services (the app uses `ratelimit:*`, `mm:*`, `MATCH-*`, and Socket.IO adapter internal keys).

Pick an index not used by other services (e.g. `2`) and set the same value on both `game` and `api`:

```bash
REDIS_URL=redis://<existing-redis-host>:6379
REDIS_DB=2
```

The `REDIS_DB` option is applied to every ioredis connection (publish, subscribe, and `duplicate()`-d connections inherit it), so boardgame.io PubSub channels, Socket.IO adapter keys, matchmaking, and rate-limit counters all land in the same isolated DB index.

> **Why not key prefix?** boardgame.io's internal PubSub channel (`MATCH-{matchID}`) and `@socket.io/redis-adapter`'s internal keys cannot be prefixed from application code, so a key-prefix strategy cannot fully isolate this app from other services. A dedicated DB index is the only complete isolation mechanism that works without forking boardgame.io.

### Minimal external-override compose example

Create `docker-compose.override.yml` next to `docker-compose.yml` to skip the bundled `postgres`/`redis` and use external instances:

```yaml
services:
  postgres:
    profiles: ['never-start'] # prevent starting
  redis:
    profiles: ['never-start']
  game:
    depends_on: !reset [] # remove depends_on
    environment:
      - PG_HOST=10.0.0.5
      - REDIS_URL=redis://10.0.0.6:6379
      - REDIS_DB=2
  api:
    depends_on: !reset []
    environment:
      - PG_HOST=10.0.0.5
      - REDIS_URL=redis://10.0.0.6:6379
      - REDIS_DB=2
```

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
