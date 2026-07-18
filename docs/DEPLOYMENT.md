# Deployment

Production deployment uses [docker-compose.yml](../docker-compose.yml) with six services:

- `postgres`: PostgreSQL 16 (`postgres:16.4-alpine`) database. Shared data layer for both boardgame.io match state (`bjg_matches` table) and API data (users/decks/matches). Healthcheck: `pg_isready`.
- `redis`: Redis 7 (`redis:7.2.5-alpine`, `appendonly yes`, `maxmemory-policy noeviction`). Powers boardgame.io PubSub, Socket.IO redis-adapter, Colyseus room/presence backing, legacy matchmaking queue, authentication revocation/refresh state, and rate-limit counters. Healthcheck: `redis-cli ping`. `noeviction` is required because evicting a blacklist or `auth:revoked-before:*` key would silently resurrect a revoked session.
- `migrate`: One-shot schema/data release service (least-privilege migration role). It applies migrations and, when `REQUIRE_OFFICIAL_CARD_DATA=true`, audits/imports the signed 422-card official-text dataset and requires the 422-card/12-errata completeness gate before app services start. Exits `0` on success; app services wait via `depends_on: service_completed_successfully`.
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
export EXPECTED_SCHEMA_MIGRATION="$(find migrations -maxdepth 1 -type f -name '*.js' | sort | tail -n 1 | xargs basename | sed 's/\.js$//')"
export EXPECTED_SCHEMA_CHECKSUM="$(shasum -a 256 "migrations/${EXPECTED_SCHEMA_MIGRATION}.js" | awk '{print $1}')"
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

Compose reads host variables from a `.env` file or shell export for interpolation. Immutable staging/production Compose files do not mount that shared file into containers; every runtime receives only its explicit per-service allowlist.

Feedback image attachments are stored in the Compose-managed `feedback_uploads` volume mounted at `/app/data/feedback-uploads`; include that volume in host-level backups together with PostgreSQL logical backups.

**REQUIRED:** production/staging require `PG_MIGRATION_USER`/`PG_MIGRATION_PASSWORD`; distinct API, GAME, PLATFORM, RETENTION, MONITOR, BACKUP, WAL replication, and WAL operator `PG_*_USER`/`PG_*_PASSWORD` pairs; `EXPECTED_SCHEMA_MIGRATION`; the seven immutable `*_IMAGE` references (including release gateway and PostgreSQL OPS); `JWT_SECRET`; the game/platform-only `PLATFORM_SEAT_TOKEN_SECRET`; a process/slot-specific `PLATFORM_PUBLIC_ADDRESS`; API-only `ADMIN_TOTP_ENCRYPTION_KEY` and `OAUTH_TOKEN_ENCRYPTION_KEY`; and either `OAUTH_PUBLIC_BASE_URL` or `PUBLIC_BASE_URL`. The four security keys must be pairwise distinct. `PG_APP_USER` remains a local-development compatibility alias only. Compose exits early if a production role is missing or aliased. Production/staging `REDIS_URL` must use `rediss://` and include Redis ACL/password credentials in the URL authority.

Create a `.env` file from the template:

```bash
cp .env.example .env
# Edit .env and set secure values for:
# - PG_MIGRATION_USER / PG_MIGRATION_PASSWORD
# - PG_API_USER / PG_API_PASSWORD
# - PG_GAME_USER / PG_GAME_PASSWORD
# - PG_PLATFORM_USER / PG_PLATFORM_PASSWORD
# - PG_RETENTION_USER / PG_RETENTION_PASSWORD
# - PG_MONITOR_USER / PG_MONITOR_PASSWORD
# - PG_BACKUP_USER / PG_BACKUP_PASSWORD
# - PG_WAL_USER / PG_WAL_PASSWORD
# - PG_WAL_OPERATOR_USER / PG_WAL_OPERATOR_PASSWORD
# - REDIS_PASSWORD (required in production)
# - REDIS_URL=rediss://:<password>@redis:6380 (required in production)
# - PG_CA_FILE (host path to the trusted PostgreSQL/Redis CA)
# - PG_SSLROOTCERT and NODE_EXTRA_CA_CERTS=/run/secrets/zutomayo-service-ca.crt
# - JWT_SECRET (generate with: openssl rand -hex 32)
# - ACCOUNT_EXPORT_S3_BUCKET / ACCOUNT_EXPORT_S3_REGION
# - ACCOUNT_EXPORT_S3_CREDENTIALS_MODE=default|static
# - ACCOUNT_EXPORT_S3_VERSIONING_MODE=disabled|required
# - ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED=true (only after bucket verification)
# - ACCOUNT_EXPORT_PSEUDONYM_KEY (independent; generate with: openssl rand -hex 32)
# Image digests and EXPECTED_SCHEMA_* come from the verified release manifest.
```

PostgreSQL WAL deploy gate 另外要求 `PG_WAL_OPERATOR_DATABASE`、`PG_WAL_OFFSITE_URI`、`PG_WAL_S3_REGION` 與三個 host file path：`PG_WAL_OPERATOR_PGPASS_FILE`、`PG_WAL_AGE_IDENTITY_FILE`、`PG_WAL_S3_CREDENTIALS_FILE`。三個 source 檔案必須為 `root:<POSTGRES_OPS_SECRETS_GID>`、mode `0440`；entrypoint 會在 tmpfs 建立 OPS UID 所有、mode `0600` 的 runtime PGPASS，避免 libpq 忽略 group-readable password file。Compose 只把 source 唯讀掛入 non-root OPS container，不接受 `PGPASSWORD`、AWS access key 或 age identity 明文環境變數。部署腳本會從主 Compose 的 migration service 取得 gate 使用的 host/port；直接執行輔助 Compose 時可用 `PG_DEPLOY_GATE_HOST`、`PG_DEPLOY_GATE_PORT` 覆寫，production 預設為 `postgresql:5432`。

### `game`

| Variable              | Default                             | Notes                                                                                                                                                                                                   |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `3000`                              | boardgame.io/static server port inside the container.                                                                                                                                                   |
| `NODE_ENV`            | `production` in Compose             | Runtime mode.                                                                                                                                                                                           |
| `PG_HOST`             | `postgres`                          | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                                                                                         |
| `PG_PORT`             | `5432`                              | PostgreSQL port.                                                                                                                                                                                        |
| `PG_USER`             | `PG_GAME_USER` in Compose           | GAME role with match-state and narrowly scoped user rating/auth column privileges.                                                                                                                      |
| `PG_PASSWORD`         | `PG_GAME_PASSWORD` in Compose       | GAME-only runtime password; never use the migration-owner password here.                                                                                                                                |
| `PG_DATABASE`         | `zutomayo`                          | PostgreSQL database name. boardgame.io match state is stored in the `bjg_matches` table.                                                                                                                |
| `PGSSLMODE`           | `verify-full` in production         | Server4 mounts `PG_CA_FILE`; `PG_SSLROOTCERT` points to `/run/secrets/zutomayo-service-ca.crt`.                                                                                                         |
| `REDIS_URL`           | Compose-generated authenticated URL | Redis connection URL for `RedisPubSub` and `@socket.io/redis-adapter`. Production/staging require an authenticated TLS URL (`rediss://`); use `redis://localhost:6379` only for passwordless local dev. |
| `REDIS_DB`            | `0`                                 | Redis DB index (0-15) for key isolation when sharing a Redis instance with other services. See [Reusing Existing PG/Redis](#reusing-existing-postgresql--redis).                                        |
| `ALLOWED_ORIGINS`     | empty                               | Comma-separated extra origins allowed by boardgame.io CORS.                                                                                                                                             |
| `JWT_SECRET`          | **required**                        | Shared HMAC secret for JWT signing/verification. **Must be at least 32 characters.** Generate with `openssl rand -hex 32`. Set the same value for both `game` and `api` services.                       |
| `APP_VERSION`         | `package.json` version              | App release version exposed by `/api/app-version` and baked into the frontend bundle. Leave empty to use the root package version.                                                                      |
| `APP_BUILD_ID`        | `APP_VERSION`                       | Build identifier used for client/server version checks. Set this to a git SHA, image tag, or release number and change it on every deploy.                                                              |
| `GAME_RULES_VERSION`  | `APP_VERSION`                       | Rules/calculation compatibility version. Bump when online matches must not mix old and new game logic.                                                                                                  |
| `LOG_LEVEL`           | `info`                              | pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`). Lower for debugging, raise in production to reduce noise.                                                                               |
| `MAX_CONN_PER_IP`     | `10`                                | Max concurrent Socket.IO connections per client IP on the game server. Excess connections are rejected to prevent resource exhaustion.                                                                  |
| `GAME_DRAIN_GRACE_MS` | `5000`                              | On SIGTERM, stop readiness/new HTTP connections and allow existing Socket.IO clients this grace period before disconnect.                                                                               |
| `SHUTDOWN_TIMEOUT_MS` | `30000`                             | Hard shutdown deadline; deployment `stop_grace_period` must exceed it.                                                                                                                                  |

Frontend build-time variables (baked into the bundle at `vite build`):

| Variable                          | Default              | Notes                                                                                                                                                                                                        |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_API_URL`                    | `/api`               | API base used by [src/api/client.ts](../src/api/client.ts).                                                                                                                                                  |
| `VITE_PLATFORM_URL`               | derived              | Browser matchmaking endpoint. Release images deliberately keep it empty so the client derives `wss://<current-host>` and enters the same-origin gateway; do not vary immutable images with a mutable secret. |
| `VITE_APP_VERSION`                | `APP_VERSION`        | Usually set automatically from `APP_VERSION` by the Docker build.                                                                                                                                            |
| `VITE_APP_BUILD_ID`               | `APP_BUILD_ID`       | Must match the `game` runtime `APP_BUILD_ID`, otherwise clients are asked to reload before online play.                                                                                                      |
| `VITE_GAME_RULES_VERSION`         | `GAME_RULES_VERSION` | Must match the `game` runtime `GAME_RULES_VERSION`.                                                                                                                                                          |
| `VITE_UMAMI_WEBSITE_ID`           | empty                | Umami website ID. Set from deployment secrets; falls back to `VITE_UMAMI_SECONDARY_WEBSITE_ID` for gallery config compatibility.                                                                             |
| `VITE_UMAMI_SCRIPT_URL`           | empty                | Umami analytics script URL. Set from deployment secrets. Analytics is disabled when this or the website ID is empty.                                                                                         |
| `VITE_UMAMI_HOST_URL`             | empty                | Optional Umami host URL override. Usually unnecessary when loading the standard Umami script directly.                                                                                                       |
| `VITE_UMAMI_TELEMETRY_SCRIPT_URL` | empty                | Optional replay / telemetry script URL. Leave empty for standard Umami analytics only.                                                                                                                       |
| `VITE_UMAMI_SECONDARY_WEBSITE_ID` | empty                | Backward-compatible alias used by `zutumayo-gallery`.                                                                                                                                                        |
| `VITE_UMAMI_SECONDARY_HOST_URL`   | empty                | Backward-compatible host URL alias used by `zutumayo-gallery`.                                                                                                                                               |

> Admin authentication is not handled in the frontend. `POST /api/admin/login` verifies an individual PostgreSQL-backed admin account, its password, and TOTP MFA, then issues a persisted revocable jti. `VITE_ADMIN_PASSWORD` and the legacy shared `ADMIN_PASSWORD` are ignored.

### `api`

| Variable                                   | Default                             | Notes                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_PORT`                                 | `3001`                              | API service port inside the container.                                                                                                                                                                         |
| `PG_HOST`                                  | `postgres`                          | PostgreSQL host. Use `localhost` for local dev outside Compose.                                                                                                                                                |
| `PG_PORT`                                  | `5432`                              | PostgreSQL port.                                                                                                                                                                                               |
| `PG_USER`                                  | `PG_API_USER` in Compose            | API data-plane role; it cannot perform DDL or modify migration history.                                                                                                                                        |
| `PG_PASSWORD`                              | `PG_API_PASSWORD` in Compose        | API-only runtime password; never use the migration-owner password here.                                                                                                                                        |
| `PG_DATABASE`                              | `zutomayo`                          | PostgreSQL database name. Source of truth for users, decks, matches, and leaderboard.                                                                                                                          |
| `PGSSLMODE`                                | `verify-full` in production         | The server4 Compose requires the mounted trusted CA and does not permit a plaintext fallback.                                                                                                                  |
| `REDIS_URL`                                | Compose-generated authenticated URL | Redis connection URL for refresh rotation, the compatibility queue, and rate limits. Production/staging require an authenticated TLS URL (`rediss://`).                                                        |
| `REDIS_DB`                                 | `0`                                 | Redis DB index (0-15) for key isolation when sharing a Redis instance with other services. See [Reusing Existing PG/Redis](#reusing-existing-postgresql--redis).                                               |
| `JWT_SECRET`                               | **required**                        | HMAC key for signed user/admin tokens. **Must be at least 32 characters.** Generate with `openssl rand -hex 32`. Set a stable secret in production or all tokens become invalid when the API process restarts. |
| `ADMIN_TOTP_ENCRYPTION_KEY`                | **required**                        | Stable key of at least 32 characters used only to encrypt admin TOTP secrets. Rotating this key requires a separate envelope re-encryption procedure; replacing it directly locks out existing accounts.       |
| `ADMIN_SESSION_TTL_SECONDS`                | `3600`                              | Persisted admin jti lifetime, clamped between five minutes and eight hours. Credential rotation/recovery revokes every still-active jti for that admin.                                                        |
| `ALLOWED_ORIGINS`                          | empty                               | Comma-separated CORS allowlist. When empty, the server falls back to localhost dev origins only.                                                                                                               |
| `TRUSTED_PROXY`                            | empty                               | Comma-separated trusted proxy IP/CIDR allowlist. `X-Forwarded-For` is honored only when the TCP peer matches this list; keep empty for direct traffic.                                                         |
| `APP_VERSION`                              | `package.json` version              | App release version returned by `/api/version` and `/api/app-version`. Leave empty to use the package version.                                                                                                 |
| `APP_BUILD_ID`                             | `APP_VERSION`                       | Build identifier; keep it aligned with the `game` service.                                                                                                                                                     |
| `GAME_RULES_VERSION`                       | `APP_VERSION`                       | Rules/calculation compatibility version; keep it aligned with the `game` service.                                                                                                                              |
| `LOG_LEVEL`                                | `info`                              | pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`).                                                                                                                                                |
| `API_HTTP_DRAIN_TIMEOUT_MS`                | `10000`                             | After readiness turns `503`, stop new HTTP accepts and wait this long for in-flight API requests before force-closing sockets. Clamped to the hard shutdown deadline.                                          |
| `SHUTDOWN_TIMEOUT_MS`                      | `30000`                             | Hard deadline for HTTP drain, background workers, PostgreSQL/Redis closure, and telemetry flush; Compose `stop_grace_period` must remain longer.                                                               |
| `CHAT_TRANSLATION_ENDPOINT`                | empty                               | Optional HTTP LLM translation gateway. When empty, chat translation requests are persisted as `pending` rows instead of calling a provider.                                                                    |
| `CHAT_TRANSLATION_API_KEY`                 | empty                               | Optional bearer token sent to `CHAT_TRANSLATION_ENDPOINT`.                                                                                                                                                     |
| `CHAT_TRANSLATION_PROVIDER`                | `http`                              | Provider label stored on ready/pending translation rows.                                                                                                                                                       |
| `CHAT_TRANSLATION_MODEL`                   | empty                               | Optional model label sent to the provider and stored with translation rows.                                                                                                                                    |
| `CHAT_TRANSLATION_TIMEOUT_MS`              | `10000`                             | Provider request timeout, clamped between 1s and 60s.                                                                                                                                                          |
| `LOGTO_M2M_APP_ID`                         | required with Logto in production   | Dedicated M2M client used only to recover ambiguous account deletions after a crash. Inject at runtime.                                                                                                        |
| `LOGTO_M2M_APP_SECRET`                     | required with Logto in production   | Runtime-only M2M secret. It must not appear in Docker build arguments, image layers, or frontend variables.                                                                                                    |
| `LOGTO_MANAGEMENT_RESOURCE`                | required with Logto in production   | Absolute HTTPS resource identifier for the Logto Management API.                                                                                                                                               |
| `LOGTO_MANAGEMENT_SCOPE`                   | `delete:users` only                 | Production startup rejects `all`, additional scopes, or a missing value. Grant this client only user deletion.                                                                                                 |
| `ACCOUNT_DELETION_RECOVERY_INTERVAL_MS`    | `60000`                             | Interval for retrying durable `provider_deleting` and `provider_deleted` requests; clamped to 10 seconds through one hour.                                                                                     |
| `ACCOUNT_EXPORT_STORAGE_MODE`              | `s3` in production Compose          | Production/staging is fail-closed and cannot disable durable asynchronous export storage.                                                                                                                      |
| `ACCOUNT_EXPORT_S3_BUCKET`                 | **required**                        | Private S3-compatible bucket dedicated to DSAR artifacts.                                                                                                                                                      |
| `ACCOUNT_EXPORT_S3_REGION`                 | **required**                        | S3 region used by the AWS SDK client.                                                                                                                                                                          |
| `ACCOUNT_EXPORT_S3_PREFIX`                 | `account-exports`                   | Least-privilege object-key prefix; the runtime rejects traversal and keys outside it.                                                                                                                          |
| `ACCOUNT_EXPORT_S3_ENDPOINT`               | AWS default                         | Optional S3-compatible origin. Production accepts only an absolute HTTPS origin without credentials, query, fragment, or path.                                                                                 |
| `ACCOUNT_EXPORT_S3_CREDENTIALS_MODE`       | **required**                        | `default` uses the AWS SDK workload/instance credential chain; `static` requires the dedicated access key and secret.                                                                                          |
| `ACCOUNT_EXPORT_S3_SERVER_SIDE_ENCRYPTION` | `AES256`                            | Set `aws:kms` and `ACCOUNT_EXPORT_S3_KMS_KEY_ID` to use a customer-managed key.                                                                                                                                |
| `ACCOUNT_EXPORT_S3_VERSIONING_MODE`        | **required**                        | `disabled` is recommended on server4; `required` fails upload/download/delete closed unless the exact VersionId is available.                                                                                  |
| `ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED`    | **required `true`**                 | Operator attestation that an enforced lifecycle cleans orphan/expired objects under the configured prefix. Never set it before verifying the bucket policy.                                                    |
| `ACCOUNT_EXPORT_PSEUDONYM_KEY`             | **required**                        | Independent HMAC key of at least 32 bytes; never reuse JWT, OAuth, TOTP, or storage credentials.                                                                                                               |
| `ACCOUNT_EXPORT_TMP_DIR`                   | `/app/data/account-exports`         | Fixed production path backed by a node-owned `0700`, 256 MiB tmpfs; it must not be a persistent volume.                                                                                                        |
| `ACCOUNT_EXPORT_INTERVAL_MS`               | `1000`                              | Worker polling interval.                                                                                                                                                                                       |
| `ACCOUNT_EXPORT_LEASE_MS`                  | `300000`                            | Fenced job lease; heartbeat renews it while a stream/upload is active.                                                                                                                                         |
| `ACCOUNT_EXPORT_BATCH_SIZE`                | `2`                                 | Maximum jobs claimed per worker tick.                                                                                                                                                                          |
| `ACCOUNT_EXPORT_DOWNLOAD_CONCURRENCY`      | `1`                                 | Concurrent export download streams, clamped to 1–4; keep 1 on server4 to preserve tmpfs/network/process headroom.                                                                                              |
| `ACCOUNT_EXPORT_EXPIRY_SECONDS`            | `604800`                            | Download availability, seven days by default.                                                                                                                                                                  |
| `ACCOUNT_EXPORT_MAX_ATTEMPTS`              | `5`                                 | Per-job retry ceiling before permanent failure.                                                                                                                                                                |
| `ACCOUNT_EXPORT_BASE_RETRY_MS`             | `5000`                              | Initial retry delay for artifact/storage failures.                                                                                                                                                             |
| `ACCOUNT_EXPORT_MAX_RETRY_MS`              | `300000`                            | Maximum retry delay.                                                                                                                                                                                           |
| `ACCOUNT_EXPORT_MAX_BYTES`                 | `104857600`                         | Maximum serialized JSON stream before gzip (100 MiB); the 256 MiB tmpfs leaves bounded compressed-file/filesystem headroom.                                                                                    |

#### Admin bootstrap, rotation, and recovery

Run the credential CLI as a controlled one-shot migration operation, with `PG_USER`/`DATABASE_URL` matching `PG_MIGRATION_USER` and the same stable `ADMIN_TOTP_ENCRYPTION_KEY` used by the API. Supply the password through an owner-only regular file whenever possible. If the TOTP secret is generated, an absolute `--totp-output-file` is mandatory; the CLI creates it with `O_EXCL`, mode `0600`, fsyncs it before changing PostgreSQL, and never writes the secret to ordinary stdout.

```bash
export ADMIN_BOOTSTRAP_PASSWORD_FILE=/run/secrets/admin-bootstrap-password

npm run admin:create -- \
  --username=operator \
  --role=operator \
  --totp-output-file=/run/secrets/admin-operator.totp

npm run admin:rotate -- \
  --username=operator \
  --totp-output-file=/run/secrets/admin-operator-rotation.totp

npm run admin:recover -- \
  --username=operator \
  --totp-output-file=/run/secrets/admin-operator-recovery.totp
```

`admin:create` fails if the username already exists. `admin:rotate` accepts only an active account, while `admin:recover` accepts only a disabled account and re-enables it. Omitting `--role` during rotation/recovery preserves the current role. To inject a pre-provisioned TOTP secret instead of generating one, set exactly one of `ADMIN_BOOTSTRAP_TOTP_SECRET` or `ADMIN_BOOTSTRAP_TOTP_SECRET_FILE` and omit the output flag; the file form must be a non-symlink regular file with no group/other permissions.

Creation, rotation, and recovery serialize on the username and lock the admin row. Credential update, active-session revocation, and the durable `admin_audit_log` record commit in one database transaction. The API role has only `SELECT`/`INSERT` on this audit table; policy-driven deletion remains isolated to the retention role. Audit details contain only the operation, target username, previous/current role and disabled state, source, and revoked-session count; password hashes, salts, plaintext TOTP secrets, and encrypted TOTP envelopes are excluded. Move the TOTP material directly into the operator's authenticator, verify a new login, then securely delete the one-time output and password input files.

Before production use, run `npm run smoke:admin-credentials-pg` with `ADMIN_CREDENTIAL_PG_SMOKE_URL` pointing to a disposable local PostgreSQL database. The smoke creates and drops only a random schema and proves all three operations, session revocation, stale-login rejection, secret-free audit contents, and transaction rollback on audit failure. It refuses `NODE_ENV=production`; a remote disposable database additionally requires `ADMIN_CREDENTIAL_PG_SMOKE_ALLOW_REMOTE=true`. Never point this contract at the production database.

#### DSAR object-storage contract

The export bucket is compliance storage, not a public download origin. Enable S3 Public Access Block (all four settings), disable ACL-based public access, deny requests where `aws:SecureTransport` is `false`, and require server-side encryption. The API streams downloads after checking ownership and integrity; do not expose bucket URLs or add a CDN/public bucket policy.

Give the API identity access only to `ACCOUNT_EXPORT_S3_PREFIX`. The normal policy needs `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` for `<bucket>/<prefix>/*`; restrict `s3:ListBucket`, if granted, with an `s3:prefix` condition. Do not grant bucket administration, policy changes, or unrelated prefixes. With SSE-KMS, scope KMS permissions to the selected key and workload. Static credentials may be passed directly or through the exclusive `*_FILE` inputs, but must never enter `.release.env`, source control, image layers, or logs; prefer `ACCOUNT_EXPORT_S3_CREDENTIALS_MODE=default` with an instance/workload role.

Server4 should use `ACCOUNT_EXPORT_S3_VERSIONING_MODE=disabled` on a dedicated ephemeral bucket. If organizational policy mandates versioning, set `required`: every successful Put must return a VersionId and every Get/Delete must supply the persisted `object_version_id`. Grant only the additional `s3:GetObjectVersion` and `s3:DeleteObjectVersion` actions. A key-only delete or delete marker is not accepted as proof of physical deletion.

An enforced lifecycle on the dedicated prefix is mandatory before setting `ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED=true`. It must expire orphan/expired objects after a window longer than `ACCOUNT_EXPORT_EXPIRY_SECONDS` (for example 14 days with the seven-day default), abort incomplete multipart uploads, and, when versioning is required, expire non-current versions and delete markers. The worker remains the primary version-aware purge mechanism and records retry/audit state; lifecycle is a safety net, not the only deletion mechanism, and must not remove still-downloadable objects early.

Custom S3-compatible endpoints must present a trusted TLS certificate; production rejects plain HTTP. All production Compose files mount `/app/data/account-exports` as `noexec,nosuid,nodev`, `0700`, UID/GID 1000, with a 256 MiB hard capacity. Do not replace this tmpfs with a persistent volume; restart cleanup is part of the data-minimization contract.

### `platform`

| Variable                           | Default                                   | Notes                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_PORT`                    | `3002`                                    | Colyseus platform service port inside the container.                                                                                                                                                |
| `PLATFORM_PUBLIC_ADDRESS`          | required in production/staging            | Absolute `wss://` address advertised in room reservations. Every independently routed process or release slot needs a unique gateway path/host; the browser follows this address after matchmaking. |
| `NODE_ENV`                         | `production` in Compose                   | Runtime mode; also controls the default Redis mode when `PLATFORM_REDIS_MODE` is unset.                                                                                                             |
| `PG_HOST`                          | `postgres`                                | PostgreSQL host used by platform Postgres stores for friend presence lookup and durable match/room chat participant evidence.                                                                       |
| `PG_PORT`                          | `5432`                                    | PostgreSQL port.                                                                                                                                                                                    |
| `PG_USER`                          | `PG_PLATFORM_USER` in Compose             | PLATFORM role with participant writes and column-limited account revocation reads.                                                                                                                  |
| `PG_PASSWORD`                      | `PG_PLATFORM_PASSWORD` in Compose         | PLATFORM-only runtime password; never use the migration-owner password here.                                                                                                                        |
| `PG_DATABASE`                      | `zutomayo`                                | PostgreSQL database name.                                                                                                                                                                           |
| `REDIS_URL`                        | Compose-generated authenticated URL       | Redis connection URL for Colyseus `RedisPresence` and `RedisDriver`; production/staging require authenticated TLS (`rediss://`). Use `redis://localhost:6379` only for passwordless local dev.      |
| `REDIS_DB`                         | `0`                                       | Redis DB index shared with other online coordination services.                                                                                                                                      |
| `JWT_SECRET`                       | **required**                              | Shared HMAC secret for validating account session cookies during Colyseus matchmaking/auth. Must match `game` and `api`.                                                                            |
| `PLATFORM_SEAT_TOKEN_SECRET`       | **required in release Compose**           | Independent seat-token signing secret shared only by `game` and `platform`, allowing rotation separately from account-session JWTs.                                                                 |
| `PLATFORM_REDIS_MODE`              | `redis` in production, `memory` otherwise | `memory` keeps local development dependency-light; `redis` enables multi-instance room discovery and presence in Compose/production.                                                                |
| `PLATFORM_BLOCK_STORE`             | `postgres` in production                  | PostgreSQL-backed bidirectional block checks for quick-match admission. Platform authentication fails closed if the query fails.                                                                    |
| `PLATFORM_FRIEND_STORE`            | `postgres` in Compose, auto otherwise     | `postgres` resolves friend presence subscriptions from `user_friends`; `none` disables friend lookup for local development.                                                                         |
| `PLATFORM_MATCH_PARTICIPANT_STORE` | `postgres` in Compose, auto otherwise     | `postgres` records account-backed Colyseus match-shell and custom-room participants so ChatService can enforce match/room chat ACLs; `none` keeps local presence transient.                         |
| `PLATFORM_CHAT_PREVIEW_STORE`      | `postgres` in Compose, auto otherwise     | `postgres` verifies Colyseus match chat preview sync signals against durable ChatService messages; `none` disables preview broadcasts when no durable verifier is available.                        |
| `PLATFORM_DRAIN_GRACE_MS`          | `5000`                                    | On Colyseus graceful shutdown, return readiness 503 and let existing rooms drain before disposal.                                                                                                   |
| `PLATFORM_PG_POOL_MAX`             | `PG_POOL_MAX` or `5`                      | Optional pool size override shared by platform Postgres-backed stores.                                                                                                                              |
| `APP_VERSION`                      | `package.json` version                    | Release version used in platform logs/Sentry release metadata.                                                                                                                                      |
| `APP_BUILD_ID`                     | `APP_VERSION`                             | Build identifier; keep it aligned with `game` and `api`.                                                                                                                                            |
| `GAME_RULES_VERSION`               | `APP_VERSION`                             | Rules compatibility version; keep it aligned with `game` and `api`.                                                                                                                                 |
| `SENTRY_DSN`                       | empty                                     | Backend DSN. Leave empty to disable platform error reporting.                                                                                                                                       |
| `LOG_LEVEL`                        | `info`                                    | pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`).                                                                                                                                     |

The platform service exposes `/health`, `/ready`, and `/api/version` over HTTP on `PLATFORM_PORT`; Colyseus websocket room traffic uses the same port. `/health` actively checks PostgreSQL and Redis whenever the configured stores/mode use them and returns `503` with dependency errors when degraded. `/ready` also checks dependencies and immediately returns `503` during graceful drain. `/api/version` returns the app/build/rules identifiers used by deployment smoke checks.

## Observability / 可觀測性

### Structured Logging

`game`, `api`, and `platform` services emit structured JSON logs via [pino](https://github.com/pinojs/pino). `game` and `api` bind HTTP requests to an `X-Request-Id`; `platform` logs Colyseus service lifecycle and room-level events with the same deployment metadata.

Sensitive fields (`authorization` headers, cookies, passwords, tokens) are redacted automatically. Adjust the log level with `LOG_LEVEL` (default `info`).

```bash
docker compose logs -f game api platform | jq .
```

### Prometheus Metrics

The `game`, `api`, and `platform` services expose a `/metrics` endpoint in the Prometheus text format:

| Endpoint                     | Service    | Scrape config example        |
| ---------------------------- | ---------- | ---------------------------- |
| `http://<host>:3000/metrics` | `game`     | `targets: ['game:3000']`     |
| `http://<host>:3001/metrics` | `api`      | `targets: ['api:3001']`      |
| `http://<host>:3002/metrics` | `platform` | `targets: ['platform:3002']` |

Exposed metrics include:

- `http_request_duration_seconds` (Histogram, labels: `method`, `path`, `status`) — dynamic path segments are normalized to `:id` to bound cardinality.
- `http_requests_total` (Counter, labels: `method`, `path`, `status`)
- `rate_limited_requests_total` (Counter, label: `pathname`) — requests rejected by the rate limiter (api server).
- `matchmaking_queue_depth` (Gauge) — live Redis sorted-set depth, refreshed by API matchmaking operations.
- `active_socket_connections` (Gauge) — active Socket.IO connections (game server).
- `match_result_outbox_pending`, `match_result_outbox_oldest_age_seconds`, and `match_result_outbox_rows{status}` — durable ranked-result delivery state from PostgreSQL.
- `relationship_change_outbox_pending`, `relationship_change_outbox_oldest_age_seconds`, `relationship_change_outbox_dead_letter`, and `relationship_change_outbox_metrics_refresh_success` — durable friend/block/account-revocation delivery health.

Operators can redrive one investigated dead-letter event through the migration/operations image while explicitly using the production API database role:

```bash
docker compose run --rm --no-deps \
  -e PG_USER="$PG_API_USER" \
  -e PG_PASSWORD="$PG_API_PASSWORD" \
  -e PG_API_USER="$PG_API_USER" \
  migrate npm run relationship:outbox:redrive -- <event-id>
```

The command rejects a mismatched database role, rejects non-dead-letter rows, and does not support bulk replay.

- `game_match_completions_total{rating_mode,result}` — ranked completions after durable ELO/history delivery.
- `platform_reconnects_total{room_type}` — accepted same-user room/seat reconnects.
- `pg_backup_*`, `pg_wal_archive_*`, and `pg_restore_drill_*` — backup host textfile metrics scraped through the backup metrics exporter.
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

### Monitoring Stack (Grafana / Prometheus)

A ready-to-use monitoring stack is defined in [docker-compose.monitoring.yml](../docker-compose.monitoring.yml). It launches Prometheus, Grafana, postgres-exporter, redis-exporter, a node-exporter textfile collector for backup, retention, restore, and synthetic metrics, and cAdvisor. Prometheus and blackbox-exporter join both the legacy app network and the blue/green release-edge network. Legacy app targets use the dedicated `game-legacy`, `api-legacy`, and `platform-legacy` aliases; slot replicas are discovered from `game-<slot>`, `api-<slot>`, and `platform-<slot>-p[12]` DNS A records.

**Dashboards** (`observability/grafana/dashboards/`) are provisioned automatically into a `Zutomayo` folder:

| Dashboard       | UID               | Key panels                                                                                                     |
| --------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Game Server     | `game-server`     | WebSocket connections, HTTP latency P50/P95/P99, 5xx rate, event loop lag, heap, PG pool                       |
| API Server      | `api-server`      | HTTP rate by route, latency quantiles, 5xx rate, auth success/failure, rate limit, Turnstile, DB query latency |
| Platform Server | `platform-server` | Active rooms, connections, match participants, chat rate, Redis op latency                                     |
| Infrastructure  | `infrastructure`  | PostgreSQL connections/query rate, Redis memory/ops/connections, Docker CPU/memory                             |

**Alerting rules** (`observability/grafana/alerting/alerts.yml`) cover 5xx error rate, PG pool saturation, Redis memory, WebSocket limits, event loop lag, service availability, the full synthetic player journey, and matchmaking queue depth. Contact points (`contact-points.yml`) route critical alerts to Slack and warnings to email via environment-variable substitution.

**Starting the monitoring stack**

```bash
# Ensure the app stack is running first (it creates the default network).
docker compose up -d

# The monitoring and blue/green slot Compose files share this external network.
docker network inspect "${GATEWAY_EDGE_NETWORK:-zutomayo-release-edge}" >/dev/null 2>&1 || \
  docker network create "${GATEWAY_EDGE_NETWORK:-zutomayo-release-edge}"

# Launch the monitoring stack.
docker compose -f docker-compose.monitoring.yml up -d
```

When upgrading an existing server4 legacy stack, its running containers do not gain new network aliases merely because the Compose YAML changed. Recreate `game`, `api`, and `platform` under the reviewed legacy manifest before switching Prometheus to this config, then verify that `game-legacy`, `api-legacy`, and `platform-legacy` resolve from `${APP_NETWORK}`. Keep the existing monitoring config running until all three names resolve; this avoids a scrape blackout during the control-plane installation.

Grafana is exposed on **port 3003** (avoids conflicts with game `3000`, api `3001`, platform `3002`). Default credentials are `admin / admin`; set `GRAFANA_PASSWORD` in `.env` to override.

**Configuration files**

| File                                                 | Purpose                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `observability/prometheus/prometheus.yml`            | Scrape configs for all services + exporters                    |
| `observability/grafana/provisioning/datasources.yml` | Prometheus datasource provisioning                             |
| `observability/grafana/provisioning/dashboards.yml`  | Dashboard file provisioning from `/var/lib/grafana/dashboards` |
| `observability/grafana/alerting/alerts.yml`          | Alerting rule definitions (Prometheus-compatible)              |
| `observability/grafana/alerting/contact-points.yml`  | Slack + email notification contact points and routes           |

**Metrics token**: if `METRICS_TOKEN` is set on the app servers, create a file containing the token and add `bearer_token_file: /etc/prometheus/metrics_token` to each `zutomayo-*` scrape job in `prometheus.yml`, then mount the token file into the prometheus container.

**Network**: the monitoring stack joins `${APP_NETWORK:-zutomayo-card-online_default}` and `${GATEWAY_EDGE_NETWORK:-zutomayo-release-edge}` as external networks. If your compose project name differs (e.g. running from a worktree directory), set `APP_NETWORK` in `.env` to match `docker compose ls` output. `GATEWAY_EDGE_NETWORK` must exactly match the network installed by the parallel server4 control plane.

Install the one-minute homepage/login/create/join synthetic timer using [`docs/runbooks/synthetic-probe.md`](./runbooks/synthetic-probe.md). The timer writes into the same node-exporter textfile directory. Its local success proves the journey and metric contract only; verify Alertmanager delivery and recovery in staging before treating the alert path as operational.

## Volumes / 資料卷

| Volume       | Mount                               | Purpose                                                                                                                                                                |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg-data`    | `postgres:/var/lib/postgresql/data` | PostgreSQL data directory. Source of truth for boardgame.io match state (`bjg_matches`) and API data (users/decks/matches/leaderboard).                                |
| `redis-data` | `redis:/data`                       | Redis AOF persistence directory. Holds Colyseus room/presence backing, legacy matchmaking queue, and rate-limit counters; loss is tolerable but causes a cold restart. |

## PostgreSQL Backup / Restore

PostgreSQL stores all registered users, saved decks, submitted matches, leaderboard state, and boardgame.io match state in the `pg-data` Docker volume. A volume alone is not a backup.

Production backups must be encrypted, checksummed, copied off-site, monitored for age, and restored on a schedule. Use the scripts and exact operational gates in [`docs/runbooks/database-restore.md`](./runbooks/database-restore.md):

```bash
./scripts/pg-backup.sh
./scripts/pg-base-backup.sh
./scripts/pg-wal-operational-smoke.sh
# Weekly runner consumes the recent immutable upload receipt and exact S3 versions.
./scripts/run-pg-restore-drill-scheduled.sh
```

The logical backup bucket must have versioning enabled. `pg-backup.sh` publishes a local read-only receipt only after both `put-object` responses return non-null immutable `VersionId` values. The weekly wrapper rejects stale, writable, symlinked, or malformed receipts and never resolves a mutable latest S3 object; it passes the exact artifact/checksum versions and receipt SHA-256 to `pg-restore-drill.sh`. The drill downloads both versions with `s3api get-object --version-id` and emits the release-bound `zutomayo-encrypted-offsite-restore-raw` artifact only after receipt/sidecar checksum binding, age decryption, isolated restore, expected migration/checksum, core-data, and legal-hold checks pass. Install and enable all three repository timers documented in the runbook, and verify both immediate run-failure alerts and stale alerts reach the on-call route.

The repository Compose database remains single-instance and is not a production HA topology. See [`docs/runbooks/ha-capacity.md`](./runbooks/ha-capacity.md) before setting replica counts or claiming the documented RPO/RTO.

## Schema Migrations / 資料表遷移

Schema changes are managed by [node-pg-migrate](https://github.com/salsita/node-pg-migrate). Migration files live in [`migrations/`](../migrations); the initial migration (`000001_init_schema.js`) mirrors the previous `initSchema()` `CREATE TABLE IF NOT EXISTS` statements using `pgm.createTable` / `pgm.createIndex` / `pgm.addColumn` with `ifNotExists: true`, so it is safe to run on databases that already had the old `initSchema()` applied.

### Available scripts

| Script                           | Purpose                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run db:migrate`             | Apply all pending migrations (up).                                                            |
| `npm run db:migrate:release`     | Apply migrations, gated legacy tombstone backfill, signed card-data release, and schema gate. |
| `npm run db:schema:gate`         | Verify the expected migration without changing schema.                                        |
| `npm run db:card-data:gate`      | Verify all 422 official English card rows and the exact 12 reviewed errata rows.              |
| `npm run db:migrate:down`        | Roll back the most recent migration (down).                                                   |
| `npm run db:migrate:make <name>` | Generate a new migration file under `migrations/`.                                            |

The wrapper [`scripts/db-migrate.cjs`](../scripts/db-migrate.cjs) bridges the project's `PG_*` environment variables to node-pg-migrate's `databaseUrl`. If `DATABASE_URL` is set it takes precedence; otherwise the wrapper assembles a `pg.ClientConfig` from `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE`.

Server4 may keep using its existing `zutomayo_card` PostgreSQL database; this release does not require copying data to a new database or cluster. Bootstrap the migration owner, runtime-role ownership/ACLs, and migration history in place, then run the signed migration image against that same database.

After the existing schema is baselined, [`000026_account_export_jobs.js`](../migrations/000026_account_export_jobs.js) adds the durable DSAR job/audit tables; [`000027_account_deletion_anonymization.js`](../migrations/000027_account_deletion_anonymization.js) makes retained season, export, deletion, and relationship evidence explicitly anonymizable; canonical append-only [`000028`](../migrations/000028_card_official_texts_i18n.js)–[`000030`](../migrations/000030_card_official_errata_english_source.js) add official/localized card text and errata schema; [`000031_user_linked_admins.js`](../migrations/000031_user_linked_admins.js) links normal accounts to revocable RBAC admin sessions; [`000032_announcements.js`](../migrations/000032_announcements.js) adds public announcements and versioned translations; [`000032_official_card_data_releases.js`](../migrations/000032_official_card_data_releases.js) records the signed extraction/errata/review-provenance digests and first applying release SHA; [`000033_admin_linked_auth_contract.js`](../migrations/000033_admin_linked_auth_contract.js) enforces mutually exclusive credential and linked-account authentication modes; and [`000033_card_text_authority.js`](../migrations/000033_card_text_authority.js) makes `cards` the sole effective Japanese/English authority while keeping only derived languages in `card_texts_i18n`.

The migration wrapper keeps the master-only legacy `000007`–`000009` chain and the superseded `000031_official_card_data_releases` filename visible only when each entry is already present in `schema_migrations`. It recognizes the reviewed card-first hardening backfill, announcement backfill, and master card-authority-first/admin-contract backfill histories. Each history is normalized once into canonical filename order before strict `checkOrder=true` resumes, without replacing pre-existing reviewed localized rows.

The server4 migrate service sets `REQUIRE_OFFICIAL_CARD_DATA=true` and passes the manifest's full `RELEASE_SHA`. The reviewed source JSON is not tracked by Git and is not copied into the migration image. Before running Compose, place the four reviewed files in a private host directory, set `CARD_DATA_DIR` to its absolute path, and keep that directory outside the repository checkout. Compose mounts it read-only at `/run/card-data`; the migrate service reads `card-english-extraction.json`, `card-english-human-reviews.json`, `card-official-errata.json`, and `card-english-ocr-overrides.json` from that mount. Restrict the host directory to the deployment operator and do not upload it as a CI artifact or include it in a Docker build context.

The same signed image audits the mounted extraction (422/422 human-reviewed names and 250/250 effect texts), requiring every `human_verified` value to match either the timestamped human-review ledger or a directly image-verified override. The dataset digest covers extraction, errata, human reviews, and overrides. The runner then serializes import with a PostgreSQL advisory transaction lock. For a new dataset digest it imports through the migration role using the production TLS/CA contract, records the ledger row, and checks every signed card/localized/errata value before the same transaction commits. A source/card-count/Japanese-text mismatch or exact-value gate failure rolls back both data and ledger.

Reconciliation is digest-based: deploying the same signed dataset again does not rewrite card rows, so audited AdminPage edits are preserved; it still requires the ledger plus 422/250/12 completeness, reviewed statuses, and consistent card/errata flags. A deliberately changed signed dataset has a new digest and becomes the new official baseline in one transaction. This data step never moves or rewrites users, decks, matches, or the database location. Never delete a ledger row to force reconciliation, bypass the production flag, or run the importer from an unsigned checkout.

Always run `npm run db:migrate:release` with the verified image and expected checksum rather than executing a migration or data file manually. Local/E2E Compose explicitly leaves `REQUIRE_OFFICIAL_CARD_DATA=false` because those stacks seed synthetic cards after migration; `NODE_ENV=production` refuses to skip the signed data path.

Migration `000027` adds `users.identity_anonymized_at` and a partial pending-tombstone index. A release with no pre-existing deleted accounts needs no special approval. When a production-copy review finds accounts deleted before `000027`, record the exact result of `SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL`, rehearse the release against that copy, and set both `LEGACY_TOMBSTONE_BACKFILL_APPROVED=true` and `LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT=<reviewed-count>` for the one release migration. The backfill serializes against retention/account mutations, respects active legal holds, anonymizes all retained identity domains, emits only hashed account references on failure, and does not publish a second account-deleted event. A missing approval, count drift, held account, failed invariant, or non-zero post-backfill count stops the migrate service. The final schema gate independently refuses application startup while any `deleted_at IS NOT NULL AND identity_anonymized_at IS NULL` row remains. Reset approval to `false` and expected count to `0` after the successful release.

### Docker Compose

The `migrate` service connects directly to PostgreSQL with the migration owner
role before app services start:

```yaml
migrate:
  image: ghcr.io/example/zutomayo-card-online-migrate@sha256:<verified-digest>
  command: ['npm', 'run', 'db:migrate:release']
  environment:
    PG_USER: zutomayo_migrator
    PG_PASSWORD: <migration-password>
    EXPECTED_SCHEMA_MIGRATION: <latest migration basename>
    EXPECTED_SCHEMA_CHECKSUM: <64-character lowercase SHA-256>
    LEGACY_TOMBSTONE_BACKFILL_APPROVED: 'false' # one-time true only after reviewed rehearsal
    LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT: '0'
    REQUIRE_OFFICIAL_CARD_DATA: 'true'
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

### Runtime DDL policy

Production and staging app images run with `RUNTIME_SCHEMA_DDL=false`. The game
adapter and API verify `EXPECTED_SCHEMA_MIGRATION`, its
`EXPECTED_SCHEMA_CHECKSUM`, and required runtime tables,
but they do not execute `CREATE TABLE` or `CREATE INDEX`. A release that has not
run the migration image therefore fails closed instead of silently changing
schema from an application process.

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

Game and API can be scaled by increasing their replica counts. Platform processes must be declared or injected with per-process configuration instead of blindly using `docker compose --scale platform=N`: every process needs a unique `PLATFORM_PUBLIC_ADDRESS` that the gateway routes back to that exact process, while all processes use `PLATFORM_REDIS_MODE=redis` for shared room discovery and presence. Reusing one advertised address across arbitrary platform replicas can send a reserved WebSocket seat to the wrong process. PostgreSQL and Redis remain shared services; keep `JWT_SECRET` and `ALLOWED_ORIGINS` consistent across their consumers.

## PgBouncer 連線池 / PgBouncer Connection Pooler

When you scale `game`, `api`, or `platform` to multiple replicas (see [水平擴展](#水平擴展--horizontal-scaling)), each process opens its own `pg.Pool` (game/api default `PG_POOL_MAX=20`; platform stores default 5). Hundreds of idle backend connections can exhaust PostgreSQL's `max_connections` and degrade performance. [PgBouncer](https://www.pgbouncer.org/) sits between the services and PostgreSQL, multiplexing many client connections onto a small pool of backend connections.

### 何時需要 PgBouncer / When to use PgBouncer

- Single-instance deployment: **not needed**. Services connect directly to `postgres` (the default).
- Multi-instance horizontal scaling: **recommended**. PgBouncer caps backend connections regardless of how many service replicas you run.

PgBouncer is **optional and off by default**. The default `docker-compose.yml` keeps services pointed directly at the `postgres` service (`PG_HOST=${PG_HOST:-postgres}`, `PG_PORT=${PG_PORT:-5432}`).

### 啟用 PgBouncer / Enabling PgBouncer

Use the overlay compose file to repoint `game`/`api`/`platform` at PgBouncer and start the pooler:

```bash
docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml up -d
```

The overlay:

- Sets `PG_HOST=pgbouncer` and `PG_PORT=6432` for `game`, `api`, and `platform`.
- Adds `pgbouncer` to their `depends_on`.
- Clears the `pgbouncer` service profile (via `!reset []`, Compose v2.20+) so it starts automatically.

The `migrate` service always connects directly to `postgres` (not through PgBouncer) to avoid any pooler interference with DDL/migration transactions.

PgBouncer listens on port `6432`. It is published to the host in the default compose file for local inspection; in production you may remove the `ports` mapping and keep it internal to the Compose network.

On older Compose versions that do not support `!reset`, start PgBouncer explicitly with a profile:

```bash
docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml --profile pgbouncer up -d
```

### 設定檔 / Configuration files

Reference config files live under [`observability/pgbouncer/`](../observability/pgbouncer):

| File            | Purpose                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pgbouncer.ini` | Static PgBouncer config (pool mode, sizes, timeouts). Uses `${PG_USER}`/`${PG_PASSWORD}` placeholders — replace at deploy time. |
| `userlist.txt`  | PgBouncer auth file with a password placeholder.                                                                                |
| `Dockerfile`    | Optional custom image that bakes the two config files into the pinned `edoburu/pgbouncer:1.22.1-p1` image.                      |

The default `docker-compose.yml` pgbouncer service uses the `edoburu/pgbouncer` image with environment variables (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_NAME`, `POOL_MODE`, …) which auto-generate both `pgbouncer.ini` and `userlist.txt` at container start, so the static files are only needed for custom builds.

> PgBouncer's ini file does **not** perform environment variable substitution. The `${PG_USER}`/`${PG_PASSWORD}` in `pgbouncer.ini` must be replaced manually (or via the edoburu image env-var mechanism) before use.

### Transaction mode vs Session mode

PgBouncer defaults to **transaction mode** (`POOL_MODE=transaction`), which multiplexes connections at transaction boundaries. This is the most efficient mode but has two limitations:

1. **No server-side prepared statements** — statements prepared on one backend connection may execute on a different one.
2. **No session-scoped state** — advisory locks, `SET` session variables, and transactions held open across separate client checkouts are not supported.

**`api` and `platform`** issue only short, self-contained queries (each `pg.Pool` query is independent) and work correctly in transaction mode.

**`game` server (boardgame.io `PostgresAdapter`)** — caveat: [`src/server/db/postgres-adapter.ts`](../src/server/db/postgres-adapter.ts) `fetchStateForUpdate()` checks out a `PoolClient`, runs `BEGIN ... SELECT ... FOR UPDATE`, and holds that client open across the boardgame.io reducer cycle until `setState()` commits and releases it (tracked in `updateLocks`). A single transaction therefore spans the fetch→setState round-trip. In transaction mode PgBouncer reclaims the backend connection when the transaction commits, but the client is held idle between fetch and setState — long-held idle transactions can starve the pool. If you observe `StaleStateWriteError`, connection timeouts, or prepared-statement errors on the game server, switch the game server's traffic to **session mode**.

#### 切換到 session mode / Switching to session mode

Set `POOL_MODE=session` in `docker-compose.pgbouncer.yml` (and `pool_mode = session` in `observability/pgbouncer/pgbouncer.ini` if using the custom image). Session mode keeps a 1:1 mapping between client and backend connections, which is safe for the boardgame.io adapter but less efficient at multiplexing. A common compromise is to run **two PgBouncer instances**: one in transaction mode for `api`/`platform` and one in session mode for `game`, each on its own port.

### 連線池大小建議 / Pool sizing

| Parameter            | Default | Notes                                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------- |
| `MAX_CLIENT_CONN`    | `200`   | Max client connections accepted by PgBouncer.                                         |
| `DEFAULT_POOL_SIZE`  | `20`    | Backend connections per database/user. Should cover peak concurrency of all replicas. |
| `RESERVE_POOL_SIZE`  | `5`     | Extra connections spawned under load after `reserve_pool_timeout`.                    |
| `max_db_connections` | `100`   | Hard cap on backend connections to PostgreSQL (in `pgbouncer.ini`).                   |

Ensure PostgreSQL `max_connections` ≥ sum of `DEFAULT_POOL_SIZE` across all PgBouncer databases plus headroom for the `migrate` service and direct admin connections.

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

Schemas are applied by the one-shot migration image before application startup (see [Schema Migrations](#schema-migrations--資料表遷移)). Production/staging runtime DDL is disabled and does not fall back to application-owned `CREATE TABLE`.

### Redis — separate DB index

Redis databases (0-15) are logical namespaces — all keys in DB index N are invisible to clients using a different index. Use a dedicated index to avoid key collisions with other services (the app uses `ratelimit:*`, `mm:*`, `MATCH-*`, Colyseus presence/driver keys, and Socket.IO adapter internal keys).

Pick an index not used by other services (e.g. `2`) and set the same value on both `game` and `api`:

```bash
REDIS_URL=redis://<existing-redis-host>:6379
REDIS_DB=2
```

The `REDIS_DB` option is applied to every ioredis connection (publish, subscribe, and `duplicate()`-d connections inherit it), so boardgame.io PubSub channels, Socket.IO adapter keys, Colyseus room/presence backing, legacy matchmaking, and rate-limit counters all land in the same isolated DB index.

At minimum, the API/relationship Redis ACL must permit connection selection plus the commands exercised by authentication, rate limiting, presence, relationship projection, and account-deletion purge: `SELECT`, `PING`, `GET`, `GETDEL`, `SET`, `DEL`, `MGET`, `SCAN`, `INCR`, `EXPIRE`, `EVAL`, `PUBLISH`, `SUBSCRIBE`, `HGET`, `HGETALL`, `HSET`, `HDEL`, `SADD`, `SREM`, `SISMEMBER`, `ZADD`, `ZREM`, `ZCARD`, `ZCOUNT`, and `ZREMRANGEBYSCORE`. Grant only the additional commands and key/channel patterns required by boardgame.io, Socket.IO, or Colyseus; do not grant `ACL`, `CONFIG`, `FLUSH*`, or other administrative commands to runtime users.

Redis ACL key patterns apply across every logical DB, and granting `SELECT` does not restrict a user to the configured index. `REDIS_DB` prevents accidental key collisions; it is not a tenant security boundary. Prefer a dedicated Redis instance for production. If an instance must be shared, use a dedicated ACL user, constrain known application key/channel patterns where the libraries allow it, and treat every DB on that instance as the same trust boundary.

`npm run db:roles:smoke` verifies this contract without requiring Redis administration privileges: its PostgreSQL/Redis smoke selects `REDIS_DB=7` by default and executes the actual data-structure, Lua, scan, publish, and subscribe operations. Override `REDIS_DB` to rehearse another isolated index. A `NOPERM`, unsupported `SELECT`, or missing Lua subcommand permission fails the smoke before deployment.

Redis eviction policy is instance-wide (not per logical DB). The bundled Compose Redis is pinned to `noeviction`; an external Redis used by server4 must be configured and verified the same way before deploying:

```bash
redis-cli -h <existing-redis-host> -p 6379 -a '<redis-password>' CONFIG GET maxmemory-policy
# expected: maxmemory-policy / noeviction
```

If the provider blocks `CONFIG GET`, set `maxmemory-policy=noeviction` in its managed Redis policy and retain the provider configuration/health-check evidence. Do not use `allkeys-lru`, `volatile-lru`, or another eviction policy for this shared instance: refresh, blacklist, and `auth:revoked-before:*` keys are security state, not disposable cache entries. A Redis outage is handled fail-closed by API token verification, but eviction cannot be recovered after the fact.

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
join/leave over websocket. The seat reservation must contain `publicAddress`, and the WebSocket connection follows
that advertised process route. It defaults to `http://127.0.0.1:3002`; override the target with:

```bash
PLATFORM_SMOKE_HTTP_URL=https://battle.zutomayocard.online/platform \
PLATFORM_SMOKE_WS_URL=wss://battle.zutomayocard.online/platform \
PLATFORM_SMOKE_EXPECTED_PUBLIC_ADDRESS=wss://battle.zutomayocard.online/platform \
npm run smoke:platform-deployment
```

## CI / 持續整合

GitHub Actions workflow: [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs on every push and pull request targeting `master`.

Runner: `ubuntu-latest`, Node 22, with `npm` caching.

Pipeline steps, in order:

1. `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` (`v7.0.0`, Node 24 action runtime)
2. `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`, Node 24 action runtime; installs Node 22 with npm cache)
3. `npm ci` — install dependencies from the lockfile.
4. `npm run format:check:tracked` — Prettier check for Git-tracked files.
5. `npm run version:check` — root/API version synchronization and managed fallback check.
6. `npm run lint` — ESLint.
7. `npm run typecheck` — `tsc --noEmit` for the app.
8. `npm run typecheck:scripts` — `tsc --noEmit -p tsconfig.scripts.json`.
9. `npm test` — vitest unit tests.
10. `npm run build` — full production build (repeats both typechecks before `vite build`).

CI、CD 與 browser matrix 的外部 Action 全部鎖定至已審核 allowlist 內的完整 40 字元 commit SHA；直接或 composite dependency graph 內的 JavaScript Action 均已驗證使用 Node 24 runtime。`npm run release:config` 會拒絕可變 tag、舊 Node 20 commit、任意其他 commit 與未列入 allowlist 的 Action。

A failing step blocks the merge. The `smoke:*` scripts are intentionally not part of CI because they require a running API/boardgame.io server.

### Local pre-push checklist / 本機推送前檢查

To mirror CI locally before pushing:

```bash
npm run verify
```

## CD / 持續部署

Continuous Deployment pipeline: [.github/workflows/cd.yml](../.github/workflows/cd.yml).

### 觸發條件

| 事件                | 動作                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| push to `master`    | 同一 preflight、verify、Trivy、build、Cosign、provenance、digest gate               |
| push tag `v*`       | 上述 gate 後建立 semver alias 與 GitHub Release                                     |
| `workflow_dispatch` | 輸入 `release_ref`；staging 部署完整 stack，production 只 stage 指定 candidate slot |

Tag push 與 production dispatch 都會將 `v<semver>` 精確解析為
`refs/tags/<tag>`，不接受同名 branch；release commit 必須在
`origin/master` ancestry 內，tag version 也必須和 `package.json` 一致。
Master push 則始終使用 event 的完整 40 字元 commit SHA。

Production dispatch 還必須選擇 `production_slot=blue|green`。CD 僅在
`/opt/zutomayo-card-runtime` 執行 `deploy-server4-canary.sh stage-slot`，
確認 candidate replicas、build ID 與 immutable image digest；該 job 不執行
`switch`、不修改 OpenResty，也不會改變公開流量。流量切換仍必須
依 canary evidence gate 和 [deployment/rollback runbook](runbooks/deployment-rollback.md)
另行執行。

### GHCR Image 列表

七個 release image 位於 GitHub Container Registry (`ghcr.io`)：

| Service     | Image                                                 |
| ----------- | ----------------------------------------------------- |
| `game`      | `ghcr.io/lyangjyehaur/zutomayo-card-online-game`      |
| `api`       | `ghcr.io/lyangjyehaur/zutomayo-card-online-api`       |
| `platform`  | `ghcr.io/lyangjyehaur/zutomayo-card-online-platform`  |
| `migrate`   | `ghcr.io/lyangjyehaur/zutomayo-card-online-migrate`   |
| `retention` | `ghcr.io/lyangjyehaur/zutomayo-card-online-retention` |
| `gateway`   | `ghcr.io/lyangjyehaur/zutomayo-card-online-gateway`   |
| `ops`       | `ghcr.io/lyangjyehaur/zutomayo-card-online-ops`       |

部署不可直接使用 tag。CD 會以完整 commit SHA 建立可追溯 tag，然後
解析成 `image@sha256:<digest>`，驗證 Cosign keyless signature 與 GitHub
build provenance，最後才寫入 `.release.env`。staging/production Compose
只接受七個完整 digest；`latest`、`staging`、`rollback` 均被禁止。

GHCR 登入使用內建 `GITHUB_TOKEN`（`packages: write` permission）。在 server 上手動 pull 時需 `docker login ghcr.io -u <github-username> -p <personal-access-token>`。

### Build 快取

CD pipeline 使用 GitHub Actions cache（`type=gha`）加速 build。game、api、platform、migrate、retention、gateway 與 ops 都使用獨立的 cache scope；game 與 platform 共用相同 Dockerfile，但 cache 仍分開管理。

共用 Dockerfile 的 runtime stage 以 `npm ci --omit=dev --ignore-scripts` 安裝 production dependencies，避免在未安裝 devDependencies 的映像中觸發 Husky 等開發期 lifecycle scripts；builder stage 仍執行完整的 `npm ci`。

### GitHub Release

Push tag `v*` 時自動建立 GitHub Release（使用 `softprops/action-gh-release`），含自動產生的 changelog。預發布版本（tag 含 `-rc` / `-beta` / `-alpha`）標記為 prerelease。

## Staging 環境 / Staging Environment

Staging compose file: [docker-compose.staging.yml](../docker-compose.staging.yml).

與 production（server4）的差異：

| 項目           | Production (server4)           | Staging                                                                          |
| -------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| DB 名稱        | `zutomayo_card`                | 外部 `PG_DATABASE`（建議 `zutomayo_staging`）                                    |
| Redis DB       | `0`                            | `3`                                                                              |
| game port      | `3000`                         | `4000`                                                                           |
| api port       | `3001`（expose）               | `4001`                                                                           |
| platform port  | `3002`                         | `4002`                                                                           |
| image 來源     | GHCR verified digest（`pull`） | GHCR verified digest（`pull`）                                                   |
| postgres/redis | 外部（1panel-network）         | 外部 PostgreSQL `verify-full` + CA secret；外部 Redis `rediss://` + ACL/password |

### Staging 部署流程

1. 先在 staging 基礎設施建立外部 PostgreSQL/Redis：PostgreSQL 必須提供
   `verify-full` 與 CA，Redis 必須啟用 TLS、ACL 與密碼；建立 Docker external
   secret `PG_CA_SECRET_NAME` 指向的 CA。不要以 bundled plaintext 服務替代。
2. 在外部 PostgreSQL 以 bootstrap administrator 執行
   `scripts/postgres-init-roles.sh`，再執行 migration role 的 migration/schema gate。
3. CD pipeline 在 push 或手動 `workflow_dispatch` 時完成相同 preflight。
4. 從 verified release artifact 取得 `.release.env`，其內容包含七個 digest、
   `APP_VERSION`、`GAME_RULES_VERSION`、`EXPECTED_SCHEMA_MIGRATION` 與 migration file checksum：

```bash
./scripts/deploy-server4.sh --manifest .release.env
```

腳本只 pull 已驗證 image，先執行 migration/schema gate，再啟動服務；不在
server build image。驗證包含 game/api/platform 的 health、ready、build ID，
以及 Colyseus lobby 訂位後依 reservation `publicAddress` 連回房間所屬 process；
因此 gateway／OpenResty 的公開 WebSocket route 不可只在內網 tunnel 下看似正常
（staging ports `4000/4001/4002`）。

```bash
DEPLOY_HOST=<staging-host> GAME_PORT=4000 API_PORT=4001 PLATFORM_PORT=4002 \
  node scripts/deploy-smoke.mjs
```

需要配置 GitHub Environment 的 `STAGING_DEPLOY_HOST`、
`STAGING_DEPLOY_USER`、`STAGING_DEPLOY_SSH_KEY` 與
`STAGING_DEPLOY_KNOWN_HOSTS` secrets；production 使用 `DEPLOY_*` 對應值，
並要求 exact `v<semver>` release tag 與 `production_slot`。Production parallel
runtime 必須先以 runbook 的 `install` 流程建立，CD 不會自動執行首次
OpenResty cutover，也不會代替 `activate-retention` 將既有 systemd timer 指向
parallel runtime 的 stable manifest。`*_KNOWN_HOSTS` 必須是預先核對過的 server host key，
部署流程不使用 `ssh-keyscan` 動態信任未知主機。

### Private battle assets / 私有對戰素材

The PNG/SVG files under `public/battle` are intentionally ignored by Git and are not present in release images. They are a required private deployment input, not optional source data. The tracked [`scripts/battle-assets.sha256`](../scripts/battle-assets.sha256) inventory is the deployment contract for the exact 22 required paths and bytes.

Before a real deployment, provide the asset directory through `BATTLE_ASSET_DIR` or use the default `public/battle` in the deployment checkout. When deploying from the deferred-hardening worktree, point it at the private assets in the main worktree:

```bash
BATTLE_ASSET_DIR=/Users/danersaka/Projects/zutomayo-card-online/public/battle \
  ./scripts/deploy-server4.sh --manifest .release.env --confirm
```

`--dry-run` does not require the private files. A real rollout fails before upload when the directory is absent, a checksum differs, or the PNG/SVG inventory has extra or missing files. The deploy script streams only listed assets with macOS metadata disabled, removes any `._*` files, verifies checksums and the file count in a remote staging directory, then atomically replaces `/opt/zutomayo-card-online/public/battle`. All server4/staging Compose variants bind-mount that directory read-only into `/app/dist/battle`.

Before switching application traffic, deployment smoke must retrieve `/battle/chronos.svg` as SVG and `/battle/medal.png` as PNG with non-empty bodies. A normal rollout snapshots the active private asset directory beside the previous immutable manifest and Compose files. Automatic or manual rollback refuses to proceed without that snapshot and restores the previous application release and private assets together; the failed asset set is retained under `backups/battle-assets/failed` for diagnosis.

## Rollback 流程 / Rollback

部署腳本 [scripts/deploy-server4.sh](../scripts/deploy-server4.sh) 會在遠端保留
上一個 verified manifest、兩份 Compose 與 PostgreSQL role bootstrap script。
只有完整 snapshot 建立後才允許自動 rollback；新版本 smoke 失敗時切回該組
immutable release files，不建立或拉取 mutable rollback tag。

### 手動 rollback

```bash
./scripts/deploy-server4.sh --rollback --confirm
```

此指令會跳過 build，直接使用上一份已驗證 manifest 的 immutable digest 重啟服務並驗證。

### 注意事項

- 缺少 `.release.previous.env`、任一 `.previous` Compose、`scripts/postgres-init-roles.sh.previous` 或上一版私有 battle 素材 snapshot 時，rollback 會拒絕執行。
- 首次 immutable cutover 必須明確使用 `--bootstrap`，並保留人工回退方案；成功後後續部署才會有可驗證的 `.release.previous.env`。
- Rollback 不執行 destructive down migration；schema 必須採 expand/contract，或先發布向後相容修復。
- 每次 rollout/rollback 應保留 manifest、migration、操作者、時間與 smoke 結果。
