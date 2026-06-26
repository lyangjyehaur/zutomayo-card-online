# Deployment

Production deployment uses [docker-compose.yml](/private/tmp/zc-docs/docker-compose.yml) with two services:

- `game`: boardgame.io server, built React app, static card/admin assets, and `/api/*` proxy.
- `api`: REST API service with SQLite persistence.

Target host: `149.104.6.238` on Debian 12, 8 cores, 8 GB RAM.

## Ports / 連接埠

| Port | Service | Purpose |
| --- | --- | --- |
| `3000` | `game` | Browser app, boardgame.io HTTP routes, Socket.IO, `/api/*` proxy |
| `3001` | `api` | Direct REST API access |

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

### `game`

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | boardgame.io/static server port inside the container. |
| `NODE_ENV` | `production` in Compose | Runtime mode. |
| `API_URL` | `http://api:3001` | Upstream API target for the `/api/*` proxy. |
| `ALLOWED_ORIGINS` | empty | Optional comma-separated extra origins for boardgame.io. |

Frontend build-time variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `/api` | API base used by [src/api/client.ts](/private/tmp/zc-docs/src/api/client.ts). |
| `VITE_ADMIN_PASSWORD` | `zutomayo2026` | Admin/i18n UI password fallback. Because Vite embeds this at build time, pass it during image build if changing it. |

### `api`

| Variable | Default | Notes |
| --- | --- | --- |
| `API_PORT` | `3001` | API service port inside the container. |
| `DB_PATH` | `/data/zutomayo.db` | SQLite database path. |
| `JWT_SECRET` | random per process | HMAC key for signed auth tokens. Set a stable secret in production or all tokens become invalid when the API process restarts. |

## Volumes / 資料卷

| Volume | Mount | Purpose |
| --- | --- | --- |
| `game-data` | `game:/data` | Reserved for game service data; current game server does not write persistent data there. |
| `api-data` | `api:/data` | Stores SQLite database at `/data/zutomayo.db`. |

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
