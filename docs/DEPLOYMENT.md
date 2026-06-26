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
| `JWT_SECRET` | random per process | Present in config, but the current token helper does not yet sign tokens with it. |

## Volumes / 資料卷

| Volume | Mount | Purpose |
| --- | --- | --- |
| `game-data` | `game:/data` | Reserved for game service data; current game server does not write persistent data there. |
| `api-data` | `api:/data` | Stores SQLite database at `/data/zutomayo.db`. |

Back up the API database:

```bash
docker compose exec api cp /data/zutomayo.db /data/zutomayo.db.backup
docker cp zc-docs-api-1:/data/zutomayo.db.backup ./zutomayo.db.backup
```

Container names may differ by Compose project name; confirm with `docker compose ps`.

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
npm run build
npm run smoke:online
```
