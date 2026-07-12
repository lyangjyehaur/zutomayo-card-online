# Deployment

Production deployment uses [docker-compose.yml](../docker-compose.yml) with six services:

- `postgres`: PostgreSQL 16 (`postgres:16-alpine`) database. Shared data layer for both boardgame.io match state (`bjg_matches` table) and API data (users/decks/matches). Healthcheck: `pg_isready`.
- `redis`: Redis 7 (`redis:7-alpine`, `appendonly yes`, `maxmemory-policy allkeys-lru`). Powers boardgame.io PubSub, Socket.IO redis-adapter, Colyseus room/presence backing, legacy matchmaking queue, and rate-limit counters. Healthcheck: `redis-cli ping`.
- `migrate`: One-shot schema migration service (uses the `builder` Docker stage). Runs `npm run db:migrate` via [node-pg-migrate](https://github.com/salsita/node-pg-migrate) before `api` starts. Exits `0` on success; `api` waits via `depends_on: service_completed_successfully`.
- `game`: boardgame.io server, built React app, static card/admin assets, and `/api/*` proxy. Persists match state via `PostgresAdapter` and broadcasts cross-node via `RedisPubSub` + `@socket.io/redis-adapter`.
- `api`: REST API service with PostgreSQL + Redis persistence. Uses `pg.Pool` for users/decks/matches/chat and Redis for the legacy matchmaking queue (sorted set + Lua atomic pairing) and rate limit (`INCR` + `EXPIRE`).
- `platform`: Colyseus platform service for lobby presence, quick matchmaking, custom-room lifecycle, invitations, spectator presence, and realtime room coordination. Uses Redis driver/presence in Compose and PostgreSQL-backed friend lookup.

Target host: `149.104.6.238` on Debian 12, 8 cores, 8 GB RAM.

## Runtime Requirements / 執行需求

- Node.js `>=20` (see `engines` in [package.json](../package.json)); the Docker images use Node 22.
- Docker with Compose v2.
- Persistent volumes for PostgreSQL and Redis data (see [Volumes](#volumes--資料卷)).

## Ports / 連接埠

| Port   | Service    | Purpose                                                          |
| ------ | ---------- | ---------------------------------------------------------------- |
| `3000` | `game`     | Browser app, boardgame.io HTTP routes, Socket.IO, `/api/*` proxy |
| `3001` | `api`      | Direct REST API access                                           |
| `3002` | `platform` | Colyseus websocket rooms and health checks                       |

Users should normally open `http://<host>:3000`.

PostgreSQL (`5432`) and Redis (`6379`) are intentionally not published to the host by the default Compose file. They
are reachable only on the Compose network by `game`, `api`, and `platform`.

## Compose Setup / Compose 設定

Start or rebuild all six services:

```bash
docker compose up -d --build
```

Watch logs:

```bash
docker compose logs -f game api platform
```

Stop services:

```bash
docker compose down
```

## Environment / 環境變數

Variables are passed through `docker-compose.yml` from the host environment (e.g. via a `.env` file or shell export).

**REQUIRED:** `PG_PASSWORD` and `JWT_SECRET` are mandatory. Compose exits early if either is missing. Set a non-empty `REDIS_PASSWORD` for every production deployment; an empty value is supported only for local/backward-compatible environments.

Create a `.env` file from the template:

```bash
cp .env.example .env
# Edit .env and set secure values for:
# - PG_PASSWORD
# - REDIS_PASSWORD (required in production)
# - JWT_SECRET (generate with: openssl rand -hex 32)
# - ADMIN_PASSWORD (optional, but recommended)
```

### `game`

| Variable             | Default                             | Notes                                                                                                                                                                             |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | `3000`                              | boardgame.io/static server port inside the container.                                                                                                                             |
| `NODE_ENV`           | `production` in Compose             | Runtime mode.                                                                                                                                                                     |
| `PG_HOST`            | `postgres`                          | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                                                                   |
| `PG_PORT`            | `5432`                              | PostgreSQL port.                                                                                                                                                                  |
| `PG_USER`            | `zutomayo`                          | PostgreSQL user.                                                                                                                                                                  |
| `PG_PASSWORD`        | required                            | PostgreSQL password. Set a strong value in `.env` or the shell before running Compose.                                                                                            |
| `PG_DATABASE`        | `zutomayo`                          | PostgreSQL database name. boardgame.io match state is stored in the `bjg_matches` table.                                                                                          |
| `REDIS_URL`          | Compose-generated authenticated URL | Redis connection URL for `RedisPubSub` and `@socket.io/redis-adapter`. Compose builds it from `REDIS_PASSWORD`; use `redis://localhost:6379` only for passwordless local dev.     |
| `REDIS_DB`           | `0`                                 | Redis DB index (0-15) for key isolation when sharing a Redis instance with other services. See [Reusing Existing PG/Redis](#reusing-existing-postgresql--redis).                  |
| `ALLOWED_ORIGINS`    | empty                               | Comma-separated extra origins allowed by boardgame.io CORS.                                                                                                                       |
| `JWT_SECRET`         | **required**                        | Shared HMAC secret for JWT signing/verification. **Must be at least 32 characters.** Generate with `openssl rand -hex 32`. Set the same value for both `game` and `api` services. |
| `APP_VERSION`        | `package.json` version              | App release version exposed by `/api/app-version` and baked into the frontend bundle. Leave empty to use the root package version.                                                |
| `APP_BUILD_ID`       | `APP_VERSION`                       | Build identifier used for client/server version checks. Set this to a git SHA, image tag, or release number and change it on every deploy.                                        |
| `GAME_RULES_VERSION` | `APP_VERSION`                       | Rules/calculation compatibility version. Bump when online matches must not mix old and new game logic.                                                                            |
| `LOG_LEVEL`          | `info`                              | pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`). Lower for debugging, raise in production to reduce noise.                                                         |
| `MAX_CONN_PER_IP`    | `10`                                | Max concurrent Socket.IO connections per client IP on the game server. Excess connections are rejected to prevent resource exhaustion.                                            |

Frontend build-time variables (baked into the bundle at `vite build`):

| Variable                          | Default              | Notes                                                                                                                                                     |
| --------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`                    | `/api`               | API base used by [src/api/client.ts](../src/api/client.ts).                                                                                               |
| `VITE_PLATFORM_URL`               | derived              | Optional Colyseus endpoint. Leave empty for same-host production or set an explicit `ws://`/`wss://` URL when the platform service is exposed separately. |
| `VITE_APP_VERSION`                | `APP_VERSION`        | Usually set automatically from `APP_VERSION` by the Docker build.                                                                                         |
| `VITE_APP_BUILD_ID`               | `APP_BUILD_ID`       | Must match the `game` runtime `APP_BUILD_ID`, otherwise clients are asked to reload before online play.                                                   |
| `VITE_GAME_RULES_VERSION`         | `GAME_RULES_VERSION` | Must match the `game` runtime `GAME_RULES_VERSION`.                                                                                                       |
| `VITE_UMAMI_WEBSITE_ID`           | empty                | Umami website ID. Set from deployment secrets; falls back to `VITE_UMAMI_SECONDARY_WEBSITE_ID` for gallery config compatibility.                          |
| `VITE_UMAMI_SCRIPT_URL`           | empty                | Umami analytics script URL. Set from deployment secrets. Analytics is disabled when this or the website ID is empty.                                      |
| `VITE_UMAMI_HOST_URL`             | empty                | Optional Umami host URL override. Usually unnecessary when loading the standard Umami script directly.                                                    |
| `VITE_UMAMI_TELEMETRY_SCRIPT_URL` | empty                | Optional replay / telemetry script URL. Leave empty for standard Umami analytics only.                                                                    |
| `VITE_UMAMI_SECONDARY_WEBSITE_ID` | empty                | Backward-compatible alias used by `zutumayo-gallery`.                                                                                                     |
| `VITE_UMAMI_SECONDARY_HOST_URL`   | empty                | Backward-compatible host URL alias used by `zutumayo-gallery`.                                                                                            |

> Admin authentication is no longer handled in the frontend. The `VITE_ADMIN_PASSWORD` build-time variable has been removed; admin login now goes through `POST /api/admin/login` backed by the `ADMIN_PASSWORD` environment variable on the `api` service.

### `api`

| Variable                      | Default                             | Notes                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_PORT`                    | `3001`                              | API service port inside the container.                                                                                                                                                                         |
| `PG_HOST`                     | `postgres`                          | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                                                                                                |
| `PG_PORT`                     | `5432`                              | PostgreSQL port.                                                                                                                                                                                               |
| `PG_USER`                     | `zutomayo`                          | PostgreSQL user.                                                                                                                                                                                               |
| `PG_PASSWORD`                 | required                            | PostgreSQL password. Set a strong value in `.env` or the shell before running Compose.                                                                                                                         |
| `PG_DATABASE`                 | `zutomayo`                          | PostgreSQL database name. Source of truth for users, decks, matches, and leaderboard.                                                                                                                          |
| `REDIS_URL`                   | Compose-generated authenticated URL | Redis connection URL for refresh rotation, the compatibility queue, and rate limits. Compose builds it from `REDIS_PASSWORD`.                                                                                  |
| `REDIS_DB`                    | `0`                                 | Redis DB index (0-15) for key isolation when sharing a Redis instance with other services. See [Reusing Existing PG/Redis](#reusing-existing-postgresql--redis).                                               |
| `JWT_SECRET`                  | **required**                        | HMAC key for signed user/admin tokens. **Must be at least 32 characters.** Generate with `openssl rand -hex 32`. Set a stable secret in production or all tokens become invalid when the API process restarts. |
| `ADMIN_PASSWORD`              | empty                               | Password checked by `POST /api/admin/login`. **Recommended: at least 8 characters.** When empty, admin login returns `503` and admin endpoints are effectively disabled.                                       |
| `ALLOWED_ORIGINS`             | empty                               | Comma-separated CORS allowlist. When empty, the server falls back to localhost dev origins only.                                                                                                               |
| `TRUSTED_PROXY`               | empty                               | Comma-separated trusted proxy IP/CIDR allowlist. `X-Forwarded-For` is honored only when the TCP peer matches this list; keep empty for direct traffic.                                                         |
| `APP_VERSION`                 | `package.json` version              | App release version returned by `/api/version` and `/api/app-version`. Leave empty to use the package version.                                                                                                 |
| `APP_BUILD_ID`                | `APP_VERSION`                       | Build identifier; keep it aligned with the `game` service.                                                                                                                                                     |
| `GAME_RULES_VERSION`          | `APP_VERSION`                       | Rules/calculation compatibility version; keep it aligned with the `game` service.                                                                                                                              |
| `LOG_LEVEL`                   | `info`                              | pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`).                                                                                                                                                |
| `CHAT_TRANSLATION_ENDPOINT`   | empty                               | Optional HTTP LLM translation gateway. When empty, chat translation requests are persisted as `pending` rows instead of calling a provider.                                                                    |
| `CHAT_TRANSLATION_API_KEY`    | empty                               | Optional bearer token sent to `CHAT_TRANSLATION_ENDPOINT`.                                                                                                                                                     |
| `CHAT_TRANSLATION_PROVIDER`   | `http`                              | Provider label stored on ready/pending translation rows.                                                                                                                                                       |
| `CHAT_TRANSLATION_MODEL`      | empty                               | Optional model label sent to the provider and stored with translation rows.                                                                                                                                    |
| `CHAT_TRANSLATION_TIMEOUT_MS` | `10000`                             | Provider request timeout, clamped between 1s and 60s.                                                                                                                                                          |

### `platform`

| Variable                           | Default                                   | Notes                                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_PORT`                    | `3002`                                    | Colyseus platform service port inside the container.                                                                                                                         |
| `NODE_ENV`                         | `production` in Compose                   | Runtime mode; also controls the default Redis mode when `PLATFORM_REDIS_MODE` is unset.                                                                                      |
| `PG_HOST`                          | `postgres`                                | PostgreSQL host used by platform Postgres stores for friend presence lookup and durable match/room chat participant evidence.                                                |
| `PG_PORT`                          | `5432`                                    | PostgreSQL port.                                                                                                                                                             |
| `PG_USER`                          | `zutomayo`                                | PostgreSQL user.                                                                                                                                                             |
| `PG_PASSWORD`                      | required                                  | PostgreSQL password. Required in Compose because friend presence and match/room chat participant evidence are backed by Postgres.                                            |
| `PG_DATABASE`                      | `zutomayo`                                | PostgreSQL database name.                                                                                                                                                    |
| `REDIS_URL`                        | Compose-generated authenticated URL       | Redis connection URL for Colyseus `RedisPresence` and `RedisDriver`, built from `REDIS_PASSWORD`. Use `redis://localhost:6379` only for passwordless local dev.              |
| `REDIS_DB`                         | `0`                                       | Redis DB index shared with other online coordination services.                                                                                                               |
| `JWT_SECRET`                       | **required**                              | Shared HMAC secret for validating account session cookies during Colyseus matchmaking/auth. Must match `game` and `api`.                                                     |
| `PLATFORM_SEAT_TOKEN_SECRET`       | `JWT_SECRET`                              | Optional independent seat-token signing secret. Production startup fails when neither this nor `JWT_SECRET` is configured.                                                   |
| `PLATFORM_REDIS_MODE`              | `redis` in production, `memory` otherwise | `memory` keeps local development dependency-light; `redis` enables multi-instance room discovery and presence in Compose/production.                                         |
| `PLATFORM_FRIEND_STORE`            | `postgres` in Compose, auto otherwise     | `postgres` resolves friend presence subscriptions from `user_friends`; `none` disables friend lookup for local development.                                                  |
| `PLATFORM_MATCH_PARTICIPANT_STORE` | `postgres` in Compose, auto otherwise     | `postgres` records account-backed Colyseus match-shell and custom-room participants so ChatService can enforce match/room chat ACLs; `none` keeps local presence transient.  |
| `PLATFORM_CHAT_PREVIEW_STORE`      | `postgres` in Compose, auto otherwise     | `postgres` verifies Colyseus match chat preview sync signals against durable ChatService messages; `none` disables preview broadcasts when no durable verifier is available. |
| `PLATFORM_PG_POOL_MAX`             | `PG_POOL_MAX` or `5`                      | Optional pool size override shared by platform Postgres-backed stores.                                                                                                       |
| `APP_VERSION`                      | `package.json` version                    | Release version used in platform logs/Sentry release metadata.                                                                                                               |
| `APP_BUILD_ID`                     | `APP_VERSION`                             | Build identifier; keep it aligned with `game` and `api`.                                                                                                                     |
| `GAME_RULES_VERSION`               | `APP_VERSION`                             | Rules compatibility version; keep it aligned with `game` and `api`.                                                                                                          |
| `SENTRY_DSN`                       | empty                                     | Backend DSN. Leave empty to disable platform error reporting.                                                                                                                |
| `LOG_LEVEL`                        | `info`                                    | pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`).                                                                                                              |

The platform service exposes `/health` and `/ready` over HTTP on `PLATFORM_PORT`; Colyseus websocket room traffic uses the same port. `/health` actively checks PostgreSQL and Redis whenever the configured stores/mode use them and returns `503` with dependency errors when degraded; `/ready` confirms the HTTP runtime is accepting traffic.

## Observability / 可觀測性

### Structured Logging

`game`, `api`, and `platform` services emit structured JSON logs via [pino](https://github.com/pinojs/pino). `game` and `api` bind HTTP requests to an `X-Request-Id`; `platform` logs Colyseus service lifecycle and room-level events with the same deployment metadata.

Sensitive fields (`authorization` headers, cookies, passwords, tokens) are redacted automatically. Adjust the log level with `LOG_LEVEL` (default `info`).

```bash
docker compose logs -f game api platform | jq .
```

### Prometheus Metrics

The `game` and `api` services expose a `/metrics` endpoint in the Prometheus text format:

| Endpoint                     | Service | Scrape config example    |
| ---------------------------- | ------- | ------------------------ |
| `http://<host>:3000/metrics` | `game`  | `targets: ['game:3000']` |
| `http://<host>:3001/metrics` | `api`   | `targets: ['api:3001']`  |

Exposed metrics include:

- `http_request_duration_seconds` (Histogram, labels: `method`, `path`, `status`) — dynamic path segments are normalized to `:id` to bound cardinality.
- `http_requests_total` (Counter, labels: `method`, `path`, `status`)
- `rate_limited_requests_total` (Counter, label: `pathname`) — requests rejected by the rate limiter (api server).
- `matchmaking_queue_depth` (Gauge) — current legacy REST matchmaking queue depth (game server).
- `active_socket_connections` (Gauge) — active Socket.IO connections (game server).
- Default Node.js metrics (event loop, GC, heap, etc.) via `collectDefaultMetrics`.

Example Prometheus `scrape_configs`:

```yaml
scrape_configs:
  - job_name: 'zutomayo-game'
    static_configs:
      - targets: ['<host>:3000']
  - job_name: 'zutomayo-api'
    static_configs:
      - targets: ['<host>:3001']
```

### Rate Limiting & Connection Limiting

- **API server**: Redis-backed fixed-window rate limiter (per-IP, per-minute) on all routes. Rejected requests return `429` and increment `rate_limited_requests_total`.
- **Game server**: Redis-backed rate limiter on `/games/*` lobby routes (configurable, default 120/min) plus per-IP Socket.IO connection limiting (`MAX_CONN_PER_IP`, default 10) to prevent connection flooding.

Both rate limiters **fail open** (allow the request through) when Redis is unavailable, to avoid blocking all traffic during a Redis outage.

## Volumes / 資料卷

| Volume       | Mount                               | Purpose                                                                                                                                                                |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg-data`    | `postgres:/var/lib/postgresql/data` | PostgreSQL data directory. Source of truth for boardgame.io match state (`bjg_matches`) and API data (users/decks/matches/leaderboard).                                |
| `redis-data` | `redis:/data`                       | Redis AOF persistence directory. Holds Colyseus room/presence backing, legacy matchmaking queue, and rate-limit counters; loss is tolerable but causes a cold restart. |

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

## Schema Migrations / 資料表遷移

Schema changes are managed by [node-pg-migrate](https://github.com/salsita/node-pg-migrate). Migration files live in [`migrations/`](../migrations); the initial migration (`000001_init_schema.js`) mirrors the previous `initSchema()` `CREATE TABLE IF NOT EXISTS` statements using `pgm.createTable` / `pgm.createIndex` / `pgm.addColumn` with `ifNotExists: true`, so it is safe to run on databases that already had the old `initSchema()` applied.

### Available scripts

| Script                           | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `npm run db:migrate`             | Apply all pending migrations (up).                 |
| `npm run db:migrate:down`        | Roll back the most recent migration (down).        |
| `npm run db:migrate:make <name>` | Generate a new migration file under `migrations/`. |

The wrapper [`scripts/db-migrate.cjs`](../scripts/db-migrate.cjs) bridges the project's `PG_*` environment variables to node-pg-migrate's `databaseUrl`. If `DATABASE_URL` is set it takes precedence; otherwise the wrapper assembles a `pg.ClientConfig` from `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE`.

### Docker Compose

The `migrate` service runs migrations before `api` starts:

```yaml
migrate:
  build:
    context: .
    dockerfile: Dockerfile
    target: builder
  command: ['npm', 'run', 'db:migrate']
  depends_on:
    postgres:
      condition: service_healthy
  restart: 'no'

api:
  depends_on:
    migrate:
      condition: service_completed_successfully
```

If the `migrate` service exits non-zero, `api` will not start. Check `docker compose logs migrate` for details.

### Fallback (production API image)

The production API Docker image (`api/Dockerfile`) does not bundle `node-pg-migrate` (it is a `devDependency`) nor the `migrations/` directory. When `api/server.cjs` cannot `require('node-pg-migrate')` or cannot find `migrations/`, it falls back to the original `initSchema()` (`CREATE TABLE IF NOT EXISTS`), so the API still self-heals the schema in production. The `migrate` Compose service is the preferred path; the fallback is a safety net for images built without dev dependencies.

### Creating a new migration

```bash
npm run db:migrate:make add_some_column
# edit migrations/<timestamp>_add_some_column.js
npm run db:migrate
```

Use `pgm.addColumn` / `pgm.createTable` / `pgm.alterTable` etc. For irreversible changes (e.g. dropping a column) export `down = false` or provide a `down` function.

## 水平擴展 / Horizontal Scaling

The `game`, `api`, and `platform` services can be replicated (multiple instances) to scale horizontally. PostgreSQL serves as the shared data layer — boardgame.io uses `PostgresAdapter` for the `bjg_matches` table, the API uses `pg.Pool` for durable product/chat data, and the platform service uses PostgreSQL for server-side friend presence lookup plus durable match/custom-room participant evidence used by ChatService access control.

Redis serves five roles simultaneously:

- boardgame.io PubSub (custom `RedisPubSub` implementing `GenericPubSub`) for cross-node match-state broadcast.
- `@socket.io/redis-adapter` for Socket.IO horizontal scaling.
- Colyseus room and presence backing for the `platform` service via `RedisDriver` and `RedisPresence`.
- Legacy REST matchmaking queue shared across API instances: a Redis sorted set (`mm:queue`) plus a hash (`mm:{userId}`) plus a Lua script perform atomic pairing, so multiple instances never match the same user twice.
- Rate-limit counters shared across API instances: Redis `INCR` + `EXPIRE` for cross-instance counting.

To scale up, increase the replica count for `game`, `api`, and/or `platform`. Both `postgres` and `redis` should remain single instances. Ensure `JWT_SECRET` is identical across all three services; keep `ALLOWED_ORIGINS` identical across `game`/`api` instances. Platform replicas must run with `PLATFORM_REDIS_MODE=redis` so Colyseus room discovery and presence are shared.

## Reusing Existing PostgreSQL / Redis

To reuse PostgreSQL and Redis instances already running on the server (instead of starting the dedicated `postgres` / `redis` containers), isolate data by **database** (PostgreSQL) and **DB index** (Redis).

### PostgreSQL — separate database

Create a dedicated database; the app uses generic table names (`users`, `decks`, `matches`, `bjg_matches`) that would collide with other services sharing the same database.

```bash
# On the server's existing PostgreSQL (as superuser)
psql -U postgres -h localhost
CREATE DATABASE zutomayo;
CREATE USER zutomayo WITH PASSWORD '<strong-password>';
GRANT ALL PRIVILEGES ON DATABASE zutomayo TO zutomayo;
```

Then point the services at the existing instance — remove the `postgres` and `redis` services from `docker-compose.yml` (or override with an external compose file) and set:

```bash
PG_HOST=<existing-pg-host>
PG_PORT=5432
PG_USER=zutomayo
PG_PASSWORD=<strong-password>
PG_DATABASE=zutomayo   # the dedicated database created above
```

Schemas (`users`/`decks`/`matches`/`bjg_matches`) are applied automatically on startup via `node-pg-migrate` (see [Schema Migrations](#schema-migrations--資料表遷移)). The API falls back to `CREATE TABLE IF NOT EXISTS` when `node-pg-migrate` is unavailable.

### Redis — separate DB index

Redis databases (0-15) are logical namespaces — all keys in DB index N are invisible to clients using a different index. Use a dedicated index to avoid key collisions with other services (the app uses `ratelimit:*`, `mm:*`, `MATCH-*`, Colyseus presence/driver keys, and Socket.IO adapter internal keys).

Pick an index not used by other services (e.g. `2`) and set the same value on both `game` and `api`:

```bash
REDIS_URL=redis://<existing-redis-host>:6379
REDIS_DB=2
```

The `REDIS_DB` option is applied to every ioredis connection (publish, subscribe, and `duplicate()`-d connections inherit it), so boardgame.io PubSub channels, Socket.IO adapter keys, Colyseus room/presence backing, legacy matchmaking, and rate-limit counters all land in the same isolated DB index.

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

## 資料遷移 / SQLite → PostgreSQL Migration

To migrate data from a previous SQLite deployment to PostgreSQL, use [scripts/migrate-sqlite-to-pg.ts](../scripts/migrate-sqlite-to-pg.ts). It migrates the `users`, `decks`, and `matches` tables using `ON CONFLICT DO NOTHING`, so it is safe to re-run.

```bash
npm i -D better-sqlite3  # migration-only dependency, not required in production
SQLITE_PATH=/data/zutomayo.db \
PG_HOST=localhost PG_USER=zutomayo PG_PASSWORD=<strong-password> \
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
curl http://localhost:3002/health
curl http://localhost:3002/ready
```

For application-level verification, run before building the image when possible:

```bash
npm run smoke
npm run smoke:api
npm run smoke:platform-deployment
npm run build
npm run smoke:online
```

`smoke:platform-deployment` checks the Colyseus platform HTTP readiness endpoints and performs a real guest lobby
join/leave over websocket. It defaults to `http://127.0.0.1:3002`; override the target with:

```bash
PLATFORM_SMOKE_HTTP_URL=https://battle.zutomayocard.online/platform \
PLATFORM_SMOKE_WS_URL=wss://battle.zutomayocard.online/platform \
npm run smoke:platform-deployment
```

## CI / 持續整合

GitHub Actions workflow: [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs on every push and pull request targeting `master`.

Runner: `ubuntu-latest`, Node 22, with `npm` caching.

Pipeline steps, in order:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 22, npm cache)
3. `npm ci` — install dependencies from the lockfile.
4. `npm run format:check:tracked` — Prettier check for Git-tracked files.
5. `npm run version:check` — root/API version synchronization and managed fallback check.
6. `npm run lint` — ESLint.
7. `npm run typecheck` — `tsc --noEmit` for the app.
8. `npm run typecheck:scripts` — `tsc --noEmit -p tsconfig.scripts.json`.
9. `npm test` — vitest unit tests.
10. `npm run build` — full production build (repeats both typechecks before `vite build`).

A failing step blocks the merge. The `smoke:*` scripts are intentionally not part of CI because they require a running API/boardgame.io server.

### Local pre-push checklist / 本機推送前檢查

To mirror CI locally before pushing:

```bash
npm run verify
```

## CD / 持續部署

Continuous Deployment pipeline: [.github/workflows/cd.yml](../.github/workflows/cd.yml).

### 觸發條件

| 事件                | 動作                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| push to `master`    | Build 3 images → push GHCR tag `staging` + `<short-sha>`                    |
| push tag `v*`       | Build 3 images → push GHCR tag `<version>` + `latest` → 建立 GitHub Release |
| `workflow_dispatch` | 手動 SSH 部署到 staging 或 production（需配置 secrets）                     |

### GHCR Image 列表

三個服務 image 位於 GitHub Container Registry (`ghcr.io`)：

| Service    | Image                                                |
| ---------- | ---------------------------------------------------- |
| `game`     | `ghcr.io/lyangjyehaur/zutomayo-card-online-game`     |
| `api`      | `ghcr.io/lyangjyehaur/zutomayo-card-online-api`      |
| `platform` | `ghcr.io/lyangjyehaur/zutomayo-card-online-platform` |

Image tag 惯例：

- `latest` — 最新 production release（tag `v*` push 時更新）
- `<version>` — 如 `0.1.3`，對應 git tag `v0.1.3`
- `staging` — master 分支最新 build
- `<short-sha>` — 如 `a1b2c3d`，對應 commit SHA
- `rollback` — 部署腳本自動 tag 的上一版 image（供回滾用）

GHCR 登入使用內建 `GITHUB_TOKEN`（`packages: write` permission）。在 server 上手動 pull 時需 `docker login ghcr.io -u <github-username> -p <personal-access-token>`。

### Build 快取

CD pipeline 使用 GitHub Actions cache（`type=gha`）加速 build。每個服務（game / api / platform）使用獨立的 cache scope，game 與 platform 共用相同 Dockerfile 但 cache 獨立管理。

### GitHub Release

Push tag `v*` 時自動建立 GitHub Release（使用 `softprops/action-gh-release`），含自動產生的 changelog。預發布版本（tag 含 `-rc` / `-beta` / `-alpha`）標記為 prerelease。

## Staging 環境 / Staging Environment

Staging compose file: [docker-compose.staging.yml](../docker-compose.staging.yml).

與 production（server4）的差異：

| 項目           | Production (server4)             | Staging                   |
| -------------- | -------------------------------- | ------------------------- |
| DB 名稱        | `zutomayo`                       | `zutomayo_staging`        |
| Redis DB       | `0`                              | `3`                       |
| game port      | `3000`                           | `4000`                    |
| api port       | `3001`（expose）                 | `4001`                    |
| platform port  | `3002`                           | `4002`                    |
| image 來源     | server 上 `docker compose build` | GHCR 預建 image（`pull`） |
| postgres/redis | 外部（1panel-network）           | 自帶容器（獨立 volume）   |

### Staging 部署流程

1. CD pipeline 在 push to master 時自動 build 並 push image 到 GHCR（tag: `staging` + SHA）。
2. Staging server 上拉取 image 並啟動：

```bash
# 在 staging server 上
cd /opt/zutomayo-card-online-staging
TAG=staging docker compose -f docker-compose.staging.yml pull
TAG=staging docker compose -f docker-compose.staging.yml up -d
docker compose -f docker-compose.staging.yml ps
```

3. 驗證 staging 服務：

```bash
curl http://<staging-host>:4000/api/version
curl http://<staging-host>:4001/api/version
curl http://<staging-host>:4002/health
```

> Staging server 尚未準備好時，CD pipeline 只 build + push image，不自動部署。`workflow_dispatch` 手動觸發 SSH 部署需配置 `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` secrets。

## Rollback 流程 / Rollback

部署腳本 [scripts/deploy-server4.sh](../scripts/deploy-server4.sh) 支援自動與手動 rollback。

### 自動 rollback

部署流程中（Step 4），腳本會先將現有 `:latest` image tag 為 `:rollback`。若部署後驗證（Step 7）失敗（health check 不通過），腳本自動：

1. 使用 `TAG=rollback` 重新 `docker compose up -d`
2. 重新驗證 health check
3. 回報 rollback 結果

### 手動 rollback

```bash
./scripts/deploy-server4.sh --rollback
```

此指令會跳過 build，直接使用 `:rollback` tag 的 image 重啟服務並驗證。

### 注意事項

- 首次部署時無 `:latest` image，rollback tag 會被跳過（無上一版可回滾）。
- Rollback 僅回滾 image，不回滾資料庫 migration。若新版本含 breaking migration，rollback 後可能需要手動處理 schema。
- `:rollback` tag 存在於 server 本地 Docker image cache，不會被 GHCR 清理政策影響。
