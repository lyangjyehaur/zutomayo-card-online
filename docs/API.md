# REST API

The API service runs from [api/server.cjs](../api/server.cjs). In Docker, the game server proxies `/api/*` to the `api` service; the API is also exposed directly on port `3001`.

Base URLs:

- Through game server: `http://localhost:3000/api`
- Direct API service: `http://localhost:3001/api`

Authenticated endpoints require:

```http
Authorization: Bearer <token>
```

User tokens are returned by `POST /api/register` and `POST /api/login` (7-day expiry). Admin tokens are returned by `POST /api/admin/login` (24-hour expiry) and carry an `admin: true` claim.

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

- Requires a user JWT. The authenticated user must be the `winnerId`; otherwise the server returns `403`. This prevents clients from forging match results on behalf of another user.
- ELO changes are `0` if either submitted user ID is not found.
- `duration` maps to `duration_seconds` in SQLite.
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

Errors: `404`.

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

All admin endpoints require an admin token in the `Authorization: Bearer <token>` header, obtained from `POST /api/admin/login`. The admin password is configured via the `ADMIN_PASSWORD` environment variable on the API service; if unset, `POST /api/admin/login` returns `503`.

### `POST /api/admin/login`

Exchange the configured admin password for an admin token (24-hour expiry). Subject to the auth rate limit (10/min).

Request:

```json
{
  "password": "admin-secret"
}
```

Response:

```json
{
  "token": "<admin-token>"
}
```

Errors: `401` (wrong password), `503` (admin not configured).

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

## Matchmaking / 配對佇列

In-memory matchmaking queue keyed by user ID. Entries expire after 60 seconds without a match, with a 10-second grace window before deletion. All endpoints require a user JWT.

### `POST /api/matchmaking/queue`

Join the matchmaking queue (or refresh an existing entry). If a compatible opponent is already queued, both entries are immediately marked `matched` and assigned a shared `matchId`; the user with the lexicographically smaller ID becomes `host`.

Request:

```json
{
  "deckName": "Dark Test",
  "deckIds": ["1st_9", "1st_9", "..."]
}
```

- `deckName` and `deckIds` are optional metadata used by the client. `deckIds` is capped at 20 string entries.

Response (queued):

```json
{
  "queueId": "q_...",
  "status": "queued"
}
```

Response (matched immediately):

```json
{
  "queueId": "q_...",
  "status": "matched"
}
```

Errors: `401`.

### `GET /api/matchmaking/status`

Poll the caller's current queue entry. Expired entries are cleaned up before the lookup.

Response (queued or matched):

```json
{
  "status": "matched",
  "matchId": "mm_...",
  "opponentId": "u_...",
  "role": "host",
  "realMatchId": null
}
```

Response (no entry / timed out):

```json
{
  "status": "timeout"
}
```

`role` is `"host"` or `"guest"`. `realMatchId` is the boardgame.io match ID once the host reports it via `PUT /api/matchmaking/match`.

Errors: `401`.

### `DELETE /api/matchmaking/queue`

Leave the queue. If the caller was already matched, the opponent's entry is marked `timeout` so they detect the cancellation on their next poll.

Response:

```json
{
  "deleted": true
}
```

Errors: `401`.

### `PUT /api/matchmaking/match`

Called by the host after creating the boardgame.io match to publish the real match ID so the guest can join.

Request:

```json
{
  "matchId": "boardgameio-match-id"
}
```

Response:

```json
{
  "ok": true
}
```

Errors: `400` (missing `matchId` or not in a `matched` state), `401`.
