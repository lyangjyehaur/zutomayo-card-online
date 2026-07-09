# Multiplayer Platform Architecture

Status: Draft
Date: 2026-07-09

## Summary

The online platform should use a hybrid architecture:

```txt
boardgame.io = authoritative turn-based card match engine
Colyseus    = multiplayer platform layer: lobby, room lifecycle, presence, spectators, invites
ChatService = durable chat domain: history, unread, reports, moderation, translation
Postgres    = source of truth for durable product data
Redis       = pub/sub, room backing, rate limits, queues, ephemeral coordination
```

The goal is not to replace `boardgame.io`. The game remains turn-based and benefits from `boardgame.io`'s rules engine, hidden information handling, reconnect, state sync, and action logs. Colyseus should wrap the match as a realtime platform shell.

## Initial Implementation Slice

The first implementation slice adds a standalone Colyseus platform runtime without switching existing gameplay traffic:

- `npm run platform`
- `src/platform/server.ts`
- `src/platform/rooms/LobbyRoom.ts`
- `src/platform/rooms/MatchShellRoom.ts`
- Docker Compose `platform` service on port `3002`
- `PLATFORM_REDIS_MODE=memory|redis` for local single-process development versus multi-instance production
- Browser lobby presence integration through `VITE_PLATFORM_URL`, with the existing HTTP presence heartbeat kept as fallback

Existing `boardgame.io` online battles continue to use the current flow.

By default, `npm run platform` uses in-memory Colyseus presence/driver outside production so local development can start without Redis. Docker Compose sets `PLATFORM_REDIS_MODE=redis` and uses the shared Redis service for production-style room discovery, presence, and future horizontal scaling.

The frontend resolves the platform endpoint from `VITE_PLATFORM_URL` when set. When unset, local `:3000` or Vite `:5173` pages connect to `:3002`; other origins use the same host and websocket scheme. If the Colyseus lobby connection fails or disconnects, `useOnlinePresence()` falls back to the existing `/api/presence/heartbeat` path.

Friend presence subscriptions are resolved server-side from the durable `user_friends` table. The browser no longer sends friend IDs in Colyseus lobby join options; production Compose sets `PLATFORM_FRIEND_STORE=postgres`, while local development can keep `PLATFORM_FRIEND_STORE=none`.

Friend direct messages use the durable `ChatService` direct conversation type. The Online Lobby provides friend management plus direct chat history/send/read/report/translate flows; direct conversation subject IDs are canonicalized so both participants share one thread.

Cross-room lobby chat uses the durable `ChatService` global conversation type (`online-lobby`) with the same history, read-state, report, moderation, and translation behavior instead of Colyseus room memory.

Admin moderation uses ChatService as the evidence source of truth. Chat reports include the reported message snapshot, and the admin console can load the full durable conversation context for post-match lookup and report review, including messages that are blocked, pending review, or deleted from normal user history.

Chat sanctions are durable server-side moderation actions. Admins can mute or unmute a reported author from the chat report workflow; `ChatService` checks active mute sanctions before accepting any match, room, direct, or global chat message, so Colyseus room memory and frontend state are not trusted for enforcement.

Player match history stores the online boardgame match ID when available. The history page can reopen the durable `ChatService` match conversation after a game ends, with read-state sync, translation, and report actions still using the same REST-backed chat domain.

## Migration Plan

1. Add Colyseus runtime and room contracts.
2. Use Colyseus for presence while keeping `/api/presence` compatibility.
3. Move lobby shell and custom room lifecycle to Colyseus.
4. Move quick matchmaking away from HTTP polling and Redis `realMatchId` handoff.
5. Add spectators and ChatService-backed chat.
6. Add friend presence, invitations, unread counts, moderation, reports, and LLM translation.

## Key Risks

- Dual connection identity: map `userId`, Colyseus `sessionId`, boardgame `matchID`, boardgame `playerID`, and boardgame credentials explicitly.
- Split brain: do not duplicate hidden or authoritative card state in Colyseus.
- Persistence: room memory is transient; chat, reports, unread state, and moderation audit data must be durable.
- Operational complexity: add Colyseus where realtime room semantics matter, not for normal CRUD APIs.
