# REST API

> `bjg_match_telemetry` 與三張 `match_analytics*` 表都是內部資料，不提供 public REST endpoint，API
> runtime role 無權讀取。前者由 platform server 短期保存可信來源與每席連線計數；後者由 game server
> 在權威終局 transaction 或 stale cleanup 的 abandoned 流程永久保存去識別投影。

The API service runs from [api/server.cjs](../api/server.cjs). In Docker, the game server proxies `/api/*` to the `api` service; the API is also exposed directly on port `3001`.

Base URLs:

- Through game server: `http://localhost:3000/api`
- Direct API service: `http://localhost:3001/api`

Authenticated endpoints prefer the `zutomayo_session` HttpOnly cookie established by login or OAuth. Legacy clients may still send:

```http
Authorization: Bearer <token>
```

User tokens are returned by `POST /api/register` and `POST /api/login` for backward compatibility. Admin tokens are returned by `POST /api/admin/login`; they carry an individual admin identity, role, and persisted jti with a configurable one-hour default lifetime.

A signed-in user whose account is explicitly linked to an admin role may instead exchange the normal user session through `POST /api/admin/session`. Both admin login paths issue the same persisted, revocable admin token and enforce the same role permissions.

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

### Card collection / 實體卡收藏

All collection endpoints require an authenticated account. Only published cards visible in the public catalog may be stored.

| Method | Path                                   | Body                            | Description                                               |
| ------ | -------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `GET`  | `/api/profile/card-collection`         | —                               | Return `{ "cardIds": [...] }` for the signed-in user.     |
| `PUT`  | `/api/profile/card-collection/:cardId` | `{ "owned": true \| false }`    | Add or remove one physical-card ownership mark.           |
| `POST` | `/api/profile/card-collection/merge`   | `{ "cardIds": ["1st_1", ...] }` | Merge up to 1,000 local ownership marks into the account. |

The merge operation is additive and idempotent. It does not remove cards already stored on the account.

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

## Deck Sharing / 卡組分享

Deck sharing is available only when `DECK_SHARING_ENABLED=true`. Public and unlisted shares are immutable card snapshots tied to the publishing rules version; private source decks remain owned by their authenticated users.

| Method   | Path                                | Auth     | Description                                                       |
| -------- | ----------------------------------- | -------- | ----------------------------------------------------------------- |
| `GET`    | `/api/deck-shares`                  | Optional | List visible shares with sort, query, element, cursor, and limit. |
| `POST`   | `/api/deck-shares`                  | User     | Publish a saved deck with `public` or `unlisted` visibility.      |
| `GET`    | `/api/decks/:deckId/share`          | Owner    | Read the current user's share for one saved deck.                 |
| `GET`    | `/api/deck-shares/:shareId`         | Optional | Read a visible public or directly addressed unlisted share.       |
| `PUT`    | `/api/deck-shares/:shareId`         | Owner    | Update visibility, display metadata, or refresh the snapshot.     |
| `DELETE` | `/api/deck-shares/:shareId`         | Owner    | Unpublish a share without deleting the source deck.               |
| `POST`   | `/api/deck-shares/:shareId/copy`    | User     | Copy a valid share into the user's saved decks.                   |
| `PUT`    | `/api/deck-shares/:shareId/like`    | User     | Like a visible share.                                             |
| `DELETE` | `/api/deck-shares/:shareId/like`    | User     | Remove the current user's like.                                   |
| `POST`   | `/api/deck-shares/:shareId/reports` | User     | Report a share for moderation.                                    |

Create body:

```json
{ "deckId": "d_...", "visibility": "public" }
```

Copy requests require a new deck name and idempotency key. The API revalidates the 20-card snapshot, two-copy limit, known card IDs, block relationships, moderation state, and rules-version compatibility inside the transaction. See [deck-sharing-lobby-spec.md](deck-sharing-lobby-spec.md) for the complete visibility and moderation contract.

## Official Rulings / 官方裁定

Official Japanese Q&A and errata are read from the active PostgreSQL content-release snapshot. `lang` accepts `ja`, `zh-TW`, `zh-HK`, `zh-CN`, `en`, or `ko`; responses always include the Japanese `source`, displayed `localized` content, requested/effective locale, translation status, source URL, sync time, and content version. Q&A items expose source-language `tagIds` beside localized `tags`; clients must use `tagIds` for filter state and `tags` for display. The `tag` query accepts a stable source tag ID and retains localized-label compatibility for older URLs.

| Method | Path                              | Query                            | Description                                |
| ------ | --------------------------------- | -------------------------------- | ------------------------------------------ |
| `GET`  | `/api/official/qa`                | `lang`, `query`, `tag`, `cardId` | List and filter published official Q&A.    |
| `GET`  | `/api/official/qa/:number`        | `lang`                           | Read one Q&A item by official number.      |
| `GET`  | `/api/official/errata`            | `lang`, `cardId`                 | List published official errata.            |
| `GET`  | `/api/official/errata/:errataId`  | `lang`                           | Read one three-digit official errata item. |
| `GET`  | `/api/official/rules/:documentId` | `lang`                           | Read the active `grand` or `floor` rules.  |
| `GET`  | `/api/official/status`            |                                  | Read active content/build/hash metadata.   |

Public responses use five-minute cache headers, stale-while-revalidate, and content ETags. Activation requires all five reviewed translations for every current source version, so a published non-Japanese release never relies on fallback. Repository JSON is never a runtime source. Source synchronization and release operations are documented in [official-rulings.md](official-rulings.md).

Grand Rules and Floor Rules are stored as versioned PostgreSQL documents and ordered sections. The public document endpoint returns Japanese source text beside the requested reviewed translation, section hierarchy, source page numbers, the official PDF URL, and the PDF SHA-256 fingerprint. Structural chapter and section headings may have an empty body; content-bearing sections preserve the complete source text. Grand Rules translations retain the exact numbered-rule sequence, while Floor Rules translations retain every ordered list, bullet, note, and numbered procedural step from the Japanese source.

## Knowledge Search / 統一全文搜尋

### `GET /api/search`

Searches public cards, official Q&A, Grand/Floor Rules sections, errata, and public deck shares. PostgreSQL remains the source of truth; the API queries the internal Meilisearch index and transparently uses a cached PostgreSQL-derived substring search when the index is unavailable.

Query parameters:

| Parameter          | Contract                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `q`                | Search text, up to 240 characters. An empty query returns no hits.                         |
| `scope`            | `all` or a comma-separated allowlist of `card`, `qa`, `rule`, `errata`, and `deck`.        |
| `lang`             | `ja`, `zh-TW`, `zh-CN`, `zh-HK`, `en`, or `ko`; defaults to `zh-TW`.                       |
| `limit`, `offset`  | `limit` is 1–100; `offset` is 0–10,000.                                                    |
| structured filters | `pack`, `rarity`, `element`, `cardType`, `distributionType`, `documentId`, `tag`, `cardId` |

Example:

```http
GET /api/search?q=Chronos&scope=card,qa&lang=zh-TW&limit=24&offset=0
```

Response:

```json
{
  "hits": [
    {
      "uid": "card__4th_106__zh-TW",
      "type": "card",
      "sourceId": "4th_106",
      "title": "海膽栗子",
      "titleHighlights": [{ "start": 0, "end": 2 }],
      "snippet": "將 Chronos 回溯一格。",
      "snippetHighlights": [{ "start": 2, "end": 9 }],
      "url": "/cards/4th_106",
      "relatedCardIds": ["4th_106"]
    }
  ],
  "estimatedTotalHits": 1,
  "limit": 24,
  "offset": 0,
  "processingTimeMs": 2,
  "engine": "meilisearch"
}
```

`engine` is diagnostic and is either `meilisearch` or `postgres-fallback`. Deck-share page searches use a larger, server-only candidate window, then reapply PostgreSQL publication, moderation, visibility, block, element, cursor, and sort checks before returning any share.

`titleHighlights` and `snippetHighlights` are zero-based UTF-16 text ranges (`start` inclusive, `end` exclusive). The API removes Meilisearch markers before responding. Clients must render the returned plain text and ranges as text nodes; they must not interpret either value as HTML.

### `GET /api/search/suggest`

Returns up to eight compact autocomplete suggestions from the same public index and PostgreSQL fallback. It accepts `q` (required, 1–120 characters), optional `scope`/`lang`, and `limit` (1–8). Each suggestion contains only `uid`, `type`, `sourceId`, `title`, `titleHighlights`, `subtitle`, and `url`; private or administrative fields are never returned.

### `GET /api/search/ids`

Page-local filtering uses this reduced-payload endpoint. It requires exactly one non-deck `scope`, accepts the same structured filters, limits results to 500 public source IDs, and returns `{ ids, estimatedTotalHits, engine }`. The full result endpoint remains capped at 100. Authorized administrative screens set `analytics=0` so searches over drafts or review notes are never included in public zero-result aggregation; public page searches default to analytics enabled.

### `GET /api/search/status`

Returns index enablement, logical index UID, last successful sync, public document count, last sync error, and fallback readiness. It never returns the Meilisearch host or master key.

The index includes only published/reviewed card text, active official content, and `public + published + visible` deck shares. Private/unlisted decks, pending translations, ownership data, and administrative notes are excluded.

### `GET /api/admin/search/zero-results`

Requires an administrator session with `audit:read`. Returns privacy-filtered zero-result query aggregates ordered by count, with `limit` 1–200 and `days` 1–90. The aggregate stores no user ID, IP, or request ID. Queries resembling email addresses, URLs, credentials/tokens, secrets, or values longer than 120 characters increment only a low-cardinality Prometheus counter and are not stored in plaintext.

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
- Completed authoritative matches also derive a schema-v1 `replay_summary` from server-owned state. It stores ordered decisions, phase/effect summaries, explicitly revealed hand cards, the result, and the sanitized timeline; raw state, unrevealed hands, decks, RNG, and replay manifests are excluded.
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
      "replayAvailable": true,
      "replaySearchText": "battle resolvependingeffect 1st_9 clockadvance",
      "createdAt": "2026-06-26 00:00:00"
    }
  ]
}
```

Only matches where the authenticated user is `player0_id` or `player1_id` are returned, newest first.

`replaySearchText` is a bounded, lower-cased token index for the authenticated history UI. Full decisions and timeline entries are not embedded in the list response.

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

### `GET /api/matches/:id/replay`

Return the completed match's searchable replay summary. The response contains the final result, contiguous phase spans, ordered server decision records, ordered effect resolutions, explicitly revealed hand card definitions, and the sanitized action timeline.

```json
{
  "matchId": "m_...",
  "rulesVersion": "0.2.6",
  "replay": {
    "schemaVersion": 1,
    "traceComplete": true,
    "result": {
      "winner": 0,
      "reason": "hp",
      "turns": 12,
      "finalHp": [18, 0],
      "finalChronos": 6
    },
    "phases": [{ "step": "battle", "fromTurn": 1, "toTurn": 1, "actionCount": 4 }],
    "decisions": [{ "sequence": 1, "player": 0, "move": "janken", "args": ["rock"] }],
    "effects": [{ "order": 1, "turn": 1, "cardDefId": "1st_9", "choiceType": null }],
    "revealedHands": [{ "player": 1, "cardDefIds": ["1st_20"] }],
    "timeline": []
  }
}
```

Requires authentication and match participation. A non-participant receives `403`; a pre-migration or legacy match without a replay summary receives `404`. The endpoint is never used for active match state. Errors: `401`, `403`, `404`.

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

Except for the two session-establishment endpoints, admin endpoints require an admin token in the `Authorization: Bearer <token>` header. Each request checks the persisted jti, account role, expiry, revocation, and disabled state. Credential-based admin accounts are provisioned in PostgreSQL with the transaction-safe `admin:create`, `admin:rotate`, and `admin:recover` commands documented in [DEPLOYMENT.md](./DEPLOYMENT.md#admin-bootstrap-rotation-and-recovery); the legacy shared `ADMIN_PASSWORD` is ignored.

| Role        | Access                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------- |
| `viewer`    | Read users, matches, audit records, and seasons.                                              |
| `moderator` | Viewer access plus chat and feedback moderation.                                              |
| `operator`  | Moderator access plus ELO, card, configuration, and season writes, and legal-hold reads.      |
| `admin`     | All admin permissions, including granting, changing, and revoking linked-account admin roles. |

Link an existing account after applying migrations:

```bash
npm run admin:link -- --email=user@example.com --role=admin
```

Supported roles are `viewer`, `moderator`, `operator`, and `admin`.
The Refine 5 console under `/admin/*` maps navigation resources to these backend permissions and hides unavailable resources. The CLI is the bootstrap path for the first full administrator. After that, an `admin` can search registered users and manage linked roles from `/admin/users`; lower roles cannot see or call the role-management controls. Frontend access control is only a UX boundary; every endpoint continues to enforce its own permission.

### Deck sharing and official-content administration

| Method | Path                                                                  | Permission          | Description                                        |
| ------ | --------------------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| `GET`  | `/api/admin/deck-share-reports`                                       | `feedback:moderate` | List deck-share reports by status and limit.       |
| `PUT`  | `/api/admin/deck-shares/:shareId/moderation`                          | `feedback:moderate` | Hide, restore, or resolve a shared deck.           |
| `GET`  | `/api/admin/official-content/translations`                            | `config:write`      | Filter translation coverage and review state.      |
| `PUT`  | `/api/admin/official-content/translations/:type/:id/:locale`          | `config:write`      | Save reviewed Q&A or errata translation content.   |
| `POST` | `/api/admin/official-content/translations/:type/:id/:locale/generate` | `config:write`      | Generate one missing translation through provider. |
| `GET`  | `/api/admin/official-content/sync-status`                             | `config:write`      | Read recent official-source comparison results.    |
| `POST` | `/api/admin/official-content/sync`                                    | `config:write`      | Run a fail-closed, read-only official-source diff. |

Admin source checks never apply remote changes. Applying verified Japanese updates remains an explicit maintenance CLI operation.

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

### `POST /api/admin/session`

Exchange the current signed-in user session for a persisted admin session when that user has an active linked admin role. Cookie-authenticated requests must include the normal double-submit CSRF token. No admin password or TOTP is required because the account session has already authenticated the linked user.

Response:

```json
{
  "token": "<admin-token>",
  "role": "moderator",
  "expiresIn": 3600
}
```

Errors: `401` (no valid user session), `403` (the active user has no linked admin role).

### `POST /api/admin/logout`

Revoke the persisted jti for the supplied admin bearer token. Response: `{ "revoked": true }`. Errors: `401`.

### `GET /api/admin/users`

List registered users, newest first. Requires an admin token.

Query:

- `limit`: optional, defaults to `100`, maximum `500`.
- `q`: optional case-insensitive user ID, email, or nickname search, truncated to 200 characters.

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
      "adminRole": "moderator",
      "isCurrentAdmin": false
    }
  ]
}
```

Errors: `401`.

Only an `admin` receives populated `adminRole` and `isCurrentAdmin` metadata. Other roles receive `null` and `false`, respectively.

### `PUT /api/admin/users/:id/admin-role`

Grant, change, or revoke a normal user's linked admin role. Requires the `admin` role.

Request:

```json
{
  "role": "operator"
}
```

Allowed values are `viewer`, `moderator`, `operator`, `admin`, or `null` to revoke access. The role change, active-session revocation, and audit record are committed in one transaction. An admin cannot change their own role through this endpoint.

Response:

```json
{
  "id": "u_...",
  "adminRole": "operator"
}
```

Errors: `400` (invalid role), `401` (missing permission), `404` (active user not found), `409` (attempted self-role change).

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
