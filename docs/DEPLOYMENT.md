# Deployment

Production deployment uses [docker-compose.yml](../docker-compose.yml) with two services:

- `game`: boardgame.io server, built React app, static card/admin assets, and `/api/*` proxy.
- `api`: REST API service with SQLite persistence.

Target host: `149.104.6.238` on Debian 12, 8 cores, 8 GB RAM.

## Runtime Requirements / 執行需求

- Node.js `>=20` (see `engines` in [package.json](../package.json)); the Docker images use Node 22.
- Docker with Compose v2.
- A persistent volume for the API's SQLite database (see [Volumes](#volumes--資料卷)).

## Ports / 連接埠

| Port   | Service | Purpose                                                          |
| ------ | ------- | ---------------------------------------------------------------- |
| `3000` | `game`  | Browser app, boardgame.io HTTP routes, Socket.IO, `/api/*` proxy |
| `3001` | `api`   | Direct REST API access                                           |

Users should normally open `http://<host>:3000`.

## Compose Setup / Compose 設定

Start or rebuild both services:

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
| `DB_DIR`          | `/data`                 | Directory for game service persistent data (mounted from the `game-data` volume).                                               |
| `ALLOWED_ORIGINS` | empty                   | Comma-separated extra origins allowed by boardgame.io CORS.                                                                     |
| `JWT_SECRET`      | empty                   | Shared HMAC secret. The `game` service forwards it so the same key signs/verifies across services; set the same value as `api`. |

Frontend build-time variables (baked into the bundle at `vite build`):

| Variable       | Default | Notes                                                       |
| -------------- | ------- | ----------------------------------------------------------- |
| `VITE_API_URL` | `/api`  | API base used by [src/api/client.ts](../src/api/client.ts). |

> Admin authentication is no longer handled in the frontend. The `VITE_ADMIN_PASSWORD` build-time variable has been removed; admin login now goes through `POST /api/admin/login` backed by the `ADMIN_PASSWORD` environment variable on the `api` service.

### `api`

| Variable          | Default             | Notes                                                                                                                                |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `API_PORT`        | `3001`              | API service port inside the container.                                                                                               |
| `DB_PATH`         | `/data/zutomayo.db` | SQLite database path. Parent directory is created if missing.                                                                        |
| `JWT_SECRET`      | random per process  | HMAC key for signed user/admin tokens. Set a stable secret in production or all tokens become invalid when the API process restarts. |
| `ADMIN_PASSWORD`  | empty               | Password checked by `POST /api/admin/login`. When empty, admin login returns `503` and admin endpoints are effectively disabled.     |
| `ALLOWED_ORIGINS` | empty               | Comma-separated CORS allowlist. When empty, the server falls back to localhost dev origins only.                                     |

## Volumes / 資料卷

| Volume      | Mount        | Purpose                                                                                                                                                                                                                             |
| ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game-data` | `game:/data` | Game service persistent data directory (`DB_DIR=/data`). The current boardgame.io server keeps match state in memory, so this volume is reserved for any future file-based persistence; match state is not durable across restarts. |
| `api-data`  | `api:/data`  | Stores the SQLite database at `/data/zutomayo.db` (path configured via `DB_PATH`). This is the source of truth for users, decks, matches, and leaderboard.                                                                          |

## SQLite Backup / Restore

The API stores all registered users, saved decks, submitted matches, and leaderboard state in the `api-data` Docker volume at `/data/zutomayo.db` inside the `api` container. The database uses WAL mode, so prefer SQLite's online backup command over copying only the main `.db` file from a running container.

Create a consistent backup while the service is running:

```bash
docker compose exec api sqlite3 /data/zutomayo.db ".backup '/data/zutomayo-$(date +%Y%m%d-%H%M%S).db'"
docker compose cp api:/data/zutomayo-YYYYMMDD-HHMMSS.db ./backups/
```

If the API image does not include the `sqlite3` CLI, stop the API briefly and copy the full SQLite file set:

```bash
docker compose stop api
docker compose cp api:/data/zutomayo.db ./backups/zutomayo.db
docker compose cp api:/data/zutomayo.db-wal ./backups/zutomayo.db-wal
docker compose cp api:/data/zutomayo.db-shm ./backups/zutomayo.db-shm
docker compose start api
```

Restore from a `.backup` database file:

```bash
docker compose stop api
docker compose cp ./backups/zutomayo-YYYYMMDD-HHMMSS.db api:/data/zutomayo.db
docker compose run --rm --no-deps api rm -f /data/zutomayo.db-wal /data/zutomayo.db-shm
docker compose start api
```

For a full file-set restore, copy `zutomayo.db`, `zutomayo.db-wal`, and `zutomayo.db-shm` back into `/data` while the API is stopped, then start the service.

Volume inspection and manual export:

```bash
docker volume inspect zc-remaining_api-data
docker run --rm -v zc-remaining_api-data:/data -v "$PWD/backups:/backup" alpine sh -c 'cp /data/zutomayo.db* /backup/'
```

The actual volume name is prefixed by the Compose project directory. Confirm it with `docker compose ps` and `docker volume ls`.

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
