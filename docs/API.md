# REST API

The API service runs from [api/server.cjs](../api/server.cjs). In Docker, the game server proxies `/api/*` to the `api` service; the API is also exposed directly on port `3001`.

Base URLs:

- Through game server: `http://localhost:3000/api`
- Direct API service: `http://localhost:3001/api`

Authenticated endpoints prefer the `zutomayo_session` HttpOnly cookie established by login or OAuth. Legacy clients may still send:

```http
Authorization: Bearer <token>
```

User tokens are returned by `POST /api/register` and `POST /api/login` for backward compatibility. Admin tokens are returned by `POST /api/admin/login`; they carry an individual admin identity, role, and persisted jti with a configurable one-hour default lifetime.

Cookie-authenticated `POST`, `PUT`, and `DELETE` requests use double-submit CSRF protection. Fetch `GET /api/csrf-token`, retain the `zutomayo_csrf` cookie, and send the same value in `X-CSRF-Token`. Login, registration, OAuth session exchange, and admin login are intentionally exempt because they establish authentication rather than consume an existing user session.

## Rate Limiting / 速率限制

All requests are rate-limited per client IP over a rolling 60-second window:

| Endpoint group                                                     | Limit     | Notes                   |
| ------------------------------------------------------------------ | --------- | ----------------------- |
| Auth endpoints (`/api/login`, `/api/register`, `/api/admin/login`) | 10 / min  | Brute-force protection. |
| All other endpoints                                                | 120 / min | Default bucket.         |

When exceeded, the server responds with `429 Too Many Requests` and a `Retry-After: 60` header.

## Auth / 帳號

### `POST /api/register`

Create a user.

Request:

```json
{
  "email": "player@example.com",
  "password": "secret123",
  "nickname": "Player"
}
```

Rules:

- `email` and `password` are required.
- `password` must be at least 6 characters.
- `nickname` is optional and defaults to the email prefix.

Response:

```json
{
  "token": "<token>",
  "user": {
    "id": "u_...",
    "email": "player@example.com",
    "nickname": "Player",
    "elo": 1000
  }
}
```

Errors: `400`, `409`.

### `POST /api/login`

Authenticate an existing user.

Request:

```json
{
  "email": "player@example.com",
  "password": "secret123"
}
```

Response:

```json
{
  "token": "<token>",
  "user": {
    "id": "u_...",
    "email": "player@example.com",
    "nickname": "Player",
    "elo": 1000
  }
}
```

Errors: `401`.

### `GET /api/profile`

Return the authenticated user profile.

Response:

```json
{
  "id": "u_...",
  "email": "player@example.com",
  "nickname": "Player",
  "elo": 1000,
  "matchCount": 0,
  "wins": 0,
  "winRate": 0,
  "createdAt": "2026-06-26 00:00:00"
}
```

Errors: `401`, `404`.

### `PUT /api/profile`

Update the authenticated user's nickname. Requires a user JWT.

Request:

```json
{
  "nickname": "NewName"
}
```

Rules:

- `nickname` is required and sanitized (max 30 chars; `<` and `>` stripped).

Response: same shape as `GET /api/profile`.

Errors: `400`, `401`.

## Friends / 好友

All friend endpoints require an authenticated account. Friendships are stored bidirectionally and are also used by direct-chat and Colyseus invite authorization.

| Method   | Path                   | Body                          | Description                                                  |
| -------- | ---------------------- | ----------------------------- | ------------------------------------------------------------ |
| `GET`    | `/api/friends`         | —                             | List the current user's friends and public match statistics. |
| `POST`   | `/api/friends`         | `{ "friendUserId": "u_..." }` | Add an existing account as a mutual friend.                  |
| `DELETE` | `/api/friends/:userId` | —                             | Remove both directions of the friendship.                    |

Errors: `400`, `401`, `404`.

## Decks / 牌組

### `GET /api/decks`

List the authenticated user's saved decks.

Response:

```jsonc
{
  "decks": [
    {
      "id": "d_...",
      "user_id": "u_...",
      "name": "Dark Test",
      "card_ids": "[\"1st_9\", \"1st_9\", ...]",
      "created_at": "2026-06-26 00:00:00",
      "updated_at": "2026-06-26 00:00:00",
      "cardIds": ["1st_9", "1st_9"],
    },
  ],
}
```

Example arrays are shortened. Use `cardIds` in clients. The snake_case fields are currently returned from the database row.

Errors: `401`.

### `POST /api/decks`

Create a saved deck for the authenticated user.

Request:

```json
{
  "name": "Dark Test",
  "cardIds": [
    "1st_9",
    "1st_9",
    "1st_10",
    "1st_10",
    "1st_33",
    "1st_34",
    "1st_65",
    "1st_66",
    "1st_37",
    "1st_36",
    "1st_25",
    "1st_26",
    "1st_53",
    "1st_54",
    "1st_55",
    "1st_81",
    "2nd_5",
    "2nd_86",
    "1st_11",
    "1st_11"
  ]
}
```

Rules currently enforced by the API:

- `name` is required.
- `cardIds` must contain exactly 20 IDs.
- No card ID may appear more than twice.

Response:

```jsonc
{
  "id": "d_...",
  "name": "Dark Test",
  "cardIds": ["1st_9", "1st_9", "..."],
}
```

Errors: `400`, `401`.

### `DELETE /api/decks/:id`

Delete one authenticated user's deck. Generated deck IDs use the `d_...` format.

Response:

```json
{
  "deleted": true
}
```

Errors: `401`, `404`.

## Matches / 對戰

### `POST /api/matches`

Submit a match result and update ELO if both users exist.

Request:

```json
{
  "winnerId": "u_winner",
  "loserId": "u_loser",
  "sourceMatchId": "boardgame-match-id",
  "winnerPlayer": 0,
  "turns": 12,
  "duration": 420,
  "actionLog": [
    {
      "id": 1,
      "turn": 1,
      "step": "janken",
      "player": 0,
      "action": "janken",
      "timestamp": 1790000000000,
      "chronosPosition": 0,
      "hp": [100, 100],
      "payload": { "choice": "rock" },
      "result": { "ok": true, "message": "Choice recorded" }
    }
  ]
}
```

Response:

```json
{
  "matchId": "m_...",
  "winnerEloChange": 16,
  "loserEloChange": -16,
  "winnerNewElo": 1016,
  "loserNewElo": 984
}
```

Notes:

- Requires an authenticated user.
- When `sourceMatchId` is present, the server verifies the winner and both boardgame seats from authoritative persisted match state. Either authenticated participant may submit the result; client-provided winner/loser IDs are replaced by the verified identities.
- `sourceMatchId` is a unique idempotency key. Retries and simultaneous submissions return the previously stored ELO result with `duplicate: true` instead of applying ELO twice.
- Legacy submissions without `sourceMatchId` require the authenticated user to equal `winnerId` and do not change ELO.
- ELO changes are `0` when an authoritative match includes a guest or an account cannot be resolved.
- `duration` maps to `duration_seconds` in PostgreSQL.
- `actionLog` is sanitized before storage. Hidden card IDs, deck order, raw text, and unknown payload fields are stripped.
- Safe trace fields are preserved: `id`, `chronosPosition`, `hp`, `pendingEffectCardDefId`, `pendingChoiceType`, `result.ok`, and `result.message`.
- Supported sanitized payloads include janken, mulligan, set-card actions, effect resolution summaries, pending choice summaries, and game-over reason.
- The stored trace is an explainable audit log, not a deterministic replay format.
- Guest placeholder IDs such as `guest-player-1` are accepted for match records but do not update ELO or leaderboard stats.

Errors: `400`, `401`, `403`.

### `GET /api/matches`

List the authenticated user's match history (cross-device sync). Requires a user JWT.

Query:

- `limit`: optional, defaults to `50`, maximum `200`.
- `offset`: optional, defaults to `0`.

Response:

```json
{
  "matches": [
    {
      "id": "m_...",
      "winnerId": "u_...",
      "loserId": "u_...",
      "winnerNickname": "Player",
      "loserNickname": "Rival",
      "winnerEloChange": 16,
      "loserEloChange": -16,
      "turns": 12,
      "duration": 420,
      "createdAt": "2026-06-26 00:00:00"
    }
  ]
}
```

Only matches where the authenticated user is `player0_id` or `player1_id` are returned, newest first.

Errors: `401`.

### `GET /api/matches/:id/log`

Return a stored match's sanitized action log.

Response:

```json
{
  "matchId": "m_...",
  "actionLog": [
    {
      "id": 4,
      "turn": 2,
      "step": "effectOrder",
      "player": 0,
      "action": "resolvePendingEffect",
      "timestamp": 1790000003000,
      "chronosPosition": 4,
      "hp": [100, 93],
      "pendingEffectCardDefId": "1st_9",
      "payload": {
        "index": 0,
        "effectId": "effect-1",
        "cardDefId": "1st_9",
        "source": "played",
        "trigger": "onUse",
        "actionType": "directDamage"
      },
      "result": { "ok": true, "message": "Resolved direct damage" }
    }
  ]
}
```

Requires authentication and match participation. A non-participant receives `403` even when the match ID exists. Errors: `401`, `403`.

## Chat / 聊天

ChatService persists all conversation types in PostgreSQL. Supported `conversationType` values are `match`, `room`, `direct`, and `global`. Direct conversations require a durable friendship; match and room conversations require durable participant evidence. Public writes accept only `player` or `spectator` roles.

| Method | Path                                                 | Description                                                                            |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`  | `/api/chat/messages?type=&subjectId=&limit=&before=` | Sync authorized conversation history.                                                  |
| `POST` | `/api/chat/messages`                                 | Persist a message, run moderation rules, and return the durable message.               |
| `POST` | `/api/chat/read`                                     | Store the user's read cursor for one conversation.                                     |
| `GET`  | `/api/chat/unread?limit=`                            | Return cross-conversation unread summaries.                                            |
| `POST` | `/api/chat/messages/:id/translate`                   | Request a target-language translation; returns `200` when ready or `202` when pending. |
| `POST` | `/api/chat/messages/:id/report`                      | Report a message and persist an immutable evidence snapshot.                           |

Message creation body:

```json
{
  "conversationType": "match",
  "subjectId": "boardgame-match-id",
  "content": "Good game!",
  "authorRole": "player",
  "clientMessageId": "optional-idempotency-key",
  "sourceLanguage": "en"
}
```

Translation uses the configured `CHAT_TRANSLATION_ENDPOINT`. Without a provider, requests are persisted with `pending` status for a future worker. Active `chat_mute` sanctions are enforced across all conversation types.

## Leaderboard / 排行榜

### `GET /api/leaderboard`

Return users with at least one recorded match, sorted by ELO descending.

Query:

- `limit`: optional, defaults to `100`, maximum `500`.

Response:

```json
{
  "leaderboard": [
    {
      "id": "u_...",
      "nickname": "Player",
      "elo": 1016,
      "matchCount": 1,
      "wins": 1,
      "winRate": 100
    }
  ]
}
```

## Admin / 管理後台

All admin endpoints require an admin token in the `Authorization: Bearer <token>` header, obtained from `POST /api/admin/login`. Each request checks the persisted jti, account role, expiry, revocation, and disabled state. Admin accounts are provisioned in PostgreSQL with the transaction-safe `admin:create`, `admin:rotate`, and `admin:recover` commands documented in [DEPLOYMENT.md](./DEPLOYMENT.md#admin-bootstrap-rotation-and-recovery); the legacy shared `ADMIN_PASSWORD` is ignored.

### `POST /api/admin/login`

Verify an individual admin username, password, and six-digit TOTP code, then issue a persisted revocable admin session. The default lifetime is one hour and is bounded to five minutes through eight hours by `ADMIN_SESSION_TTL_SECONDS`. Subject to the auth rate limit (10/min).

Request:

```json
{
  "username": "operator",
  "password": "individual-admin-password",
  "totpCode": "123456"
}
```

Response:

```json
{
  "token": "<admin-token>",
  "role": "operator",
  "expiresIn": 3600
}
```

Errors: `401` (unknown/disabled account, wrong password, invalid MFA, or credentials changed concurrently), `403` (MFA is not configured), `503` (admin TOTP encryption is not configured).

### `GET /api/admin/users`

List registered users, newest first. Requires an admin token.

Query:

- `limit`: optional, defaults to `100`, maximum `500`.

Response:

```json
{
  "users": [
    {
      "id": "u_...",
      "email": "player@example.com",
      "nickname": "Player",
      "elo": 1000,
      "matchCount": 0,
      "wins": 0,
      "winRate": 0,
      "createdAt": "2026-06-26 00:00:00"
    }
  ]
}
```

Errors: `401`.

### `GET /api/admin/matches`

List all recorded matches, newest first. Requires an admin token.

Query:

- `limit`: optional, defaults to `50`, maximum `200`.

Response:

```json
{
  "matches": [
    {
      "id": "m_...",
      "winnerId": "u_...",
      "loserId": "u_...",
      "winnerNickname": "Player",
      "loserNickname": "Rival",
      "winnerEloChange": 16,
      "loserEloChange": -16,
      "turns": 12,
      "duration": 420,
      "createdAt": "2026-06-26 00:00:00"
    }
  ]
}
```

Errors: `401`.

### `PUT /api/admin/users/:id/elo`

Reset a user's ELO rating. Requires an admin token.

Request:

```json
{
  "elo": 1000
}
```

Rules:

- `elo` is clamped to `[0, 9999]` and truncated to an integer. Defaults to `1000` when invalid.

Response:

```json
{
  "id": "u_...",
  "elo": 1000
}
```

Errors: `401`.

### Chat moderation endpoints

| Method   | Path                                                        | Description                                                          |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/api/admin/chat/reports?status=&limit=`                    | List reports with immutable message snapshots.                       |
| `GET`    | `/api/admin/chat/conversations/:id/messages?limit=&before=` | Load full evidence history, including blocked or deleted messages.   |
| `POST`   | `/api/admin/chat/reports/:id`                               | Set report status to `reviewing`, `resolved`, or `dismissed`.        |
| `POST`   | `/api/admin/chat/messages/:id/moderation`                   | Set message status to `visible`, `blocked`, or `deleted`.            |
| `POST`   | `/api/admin/chat/sanctions`                                 | Create a durable `chat_mute`, optionally linked to a report/message. |
| `DELETE` | `/api/admin/chat/sanctions/:id`                             | Revoke a durable chat sanction.                                      |

## Legacy Matchmaking / 舊版配對佇列

The Redis-backed REST queue was retired on 2026-07-15. The browser and supported clients use the Colyseus `quick_match` room for queueing, cancellation, pairing, and boardgame.io match ID relay; see [MULTIPLAYER_PLATFORM_ARCHITECTURE.md](./MULTIPLAYER_PLATFORM_ARCHITECTURE.md).

The following authenticated routes remain as tombstones so old clients fail explicitly without reading or writing Redis:

- `POST /api/matchmaking/queue`
- `GET /api/matchmaking/status`
- `DELETE /api/matchmaking/queue`
- `PUT /api/matchmaking/match`

Response:

```json
{
  "error": "Legacy REST matchmaking was removed; use the Colyseus quick_match room"
}
```

Errors: `401` without a valid user session; otherwise `410 Gone`. The response includes `Deprecation: true`, `Sunset`, and `Cache-Control: no-store`.
