# REST API

The API service runs from [api/server.cjs](/private/tmp/zc-docs/api/server.cjs). In Docker, the game server proxies `/api/*` to the `api` service; the API is also exposed directly on port `3001`.

Base URLs:

- Through game server: `http://localhost:3000/api`
- Direct API service: `http://localhost:3001/api`

Authenticated endpoints require:

```http
Authorization: Bearer <token>
```

Tokens are returned by `POST /api/register` and `POST /api/login`.

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
      "cardIds": ["1st_9", "1st_9"]
    }
  ]
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
  "cardIds": ["1st_9", "1st_9", "..."]
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
  "duration": 420
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

- This endpoint is not currently authenticated.
- ELO changes are `0` if either submitted user ID is not found.
- `duration` maps to `duration_seconds` in SQLite.

Errors: `400`.

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
