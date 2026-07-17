# REST API

The API service runs from [api/server.cjs](../api/server.cjs). In Docker, the game server proxies `/api/*` to the `api` service; the API is also exposed directly on port `3001`.

Base URLs:

- Through game server: `http://localhost:3000/api`
- Direct API service: `http://localhost:3001/api`

Authenticated endpoints prefer the `zutomayo_session` HttpOnly cookie established by login or OAuth. Legacy clients may still send:

```http
Authorization: Bearer <token>
```

User tokens are returned by `POST /api/register` and `POST /api/login` for backward compatibility. Linked administrator accounts exchange a valid user session through `POST /api/admin/session`; legacy standalone administrators can use `POST /api/admin/login`. Admin tokens carry an `admin: true` claim and are backed by revocable PostgreSQL sessions.

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

Translation uses the shared `TRANSLATION_ENDPOINT` service, with `CHAT_TRANSLATION_ENDPOINT` retained as a compatibility fallback. Chat messages and announcements keep separate versioned caches while sharing the same provider call. Without a provider, requests are persisted with `pending` status for a future worker. Active `chat_mute` sanctions are enforced across all conversation types.

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

All admin endpoints require an admin token in the `Authorization: Bearer <token>` header. The preferred flow links an existing user to `admin_users.user_id`; the signed-in user exchanges the normal account session for an admin token. Role changes, account deletion, administrator disabling, session expiry, and explicit revocation take effect server-side.

Link an existing account after applying migrations:

```bash
npm run admin:link -- --email=user@example.com --role=admin
```

Supported roles are `viewer`, `moderator`, `operator`, and `admin`.
The CLI is the bootstrap path for the first full administrator. After that, an `admin` can search registered users and manage linked roles from the **使用者** tab in `/admin`; lower roles cannot see or call the role-management controls.

Revoke the linked role and all of its administrator sessions:

```bash
npm run admin:unlink -- --email=user@example.com
```

### `POST /api/admin/session`

Exchange the current signed-in user session for an admin token. No request body fields are required. Returns `403` when the user is not linked to an enabled administrator record.

Response:

```json
{
  "token": "<admin-token>",
  "role": "admin",
  "expiresIn": 3600
}
```

### `POST /api/admin/login`

Legacy compatibility flow for a standalone administrator account protected by password and TOTP MFA. Subject to the auth rate limit (10/min).

Request:

```json
{
  "username": "operator",
  "password": "admin-secret",
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

Errors: `401` (invalid credentials or MFA code), `403` (MFA missing), `503` (legacy admin login not configured).

### `GET /api/admin/users`

List registered users, newest first. Requires an admin token.

Query:

- `limit`: optional, defaults to `100`, maximum `500`.
- `q`: optional case-insensitive substring search across user ID, email, and nickname.

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
      "createdAt": "2026-06-26 00:00:00",
      "adminRole": "operator",
      "isCurrentAdmin": false
    }
  ]
}
```

`adminRole` and `isCurrentAdmin` are populated only for a full `admin`; lower roles with `users:read` receive `null` and `false` respectively.

Errors: `400` (invalid query), `401`.

### `PUT /api/admin/users/:id/admin-role`

Assign, change, or revoke a linked administrator role. Requires the `admins:manage` permission, which is available only to a full `admin`. The acting administrator cannot change their own role from this endpoint.

Request:

```json
{
  "role": "operator"
}
```

Use `null` to revoke access:

```json
{
  "role": null
}
```

Assigning or changing a role deletes the target administrator's existing sessions. Revoking the role deletes the linked `admin_users` record and cascades session deletion. Every change is written to `admin_audit_log` in the same database transaction.

Response:

```json
{
  "id": "u_...",
  "adminRole": "operator"
}
```

Errors: `400` (invalid role), `401` (missing permission), `404` (active user not found), `409` (attempt to change the acting administrator's own role).

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

These REST endpoints are kept as a compatibility surface for older clients and service-level tests. The current browser quick-match flow uses the Colyseus `quick_match` room for queueing, cancellation, pairing, and boardgame.io match ID relay; see [MULTIPLAYER_PLATFORM_ARCHITECTURE.md](./MULTIPLAYER_PLATFORM_ARCHITECTURE.md). All endpoints require a user JWT.

The legacy queue is Redis-backed and keyed by user ID. Entries expire after 60 seconds without a match, with a 10-second grace window before deletion.

### `POST /api/matchmaking/queue`

Join the legacy matchmaking queue (or refresh an existing entry). If a compatible opponent is already queued, both entries are immediately marked `matched` and assigned a shared `matchId`; the user with the lexicographically smaller ID becomes `host`.

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

Poll the caller's current legacy queue entry. Expired entries are cleaned up before the lookup.

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

`role` is `"host"` or `"guest"`. `realMatchId` is the boardgame.io match ID once the legacy REST host reports it via `PUT /api/matchmaking/match`.

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

Called by the host on the legacy REST flow after creating the boardgame.io match to publish the real match ID so the guest can join. The Colyseus quick-match flow relays this through `boardgameMatchReady` on the `quick_match` room instead.

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
