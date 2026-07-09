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

Existing `boardgame.io` online battles continue to use the current flow.

By default, `npm run platform` uses in-memory Colyseus presence/driver outside production so local development can start without Redis. Docker Compose sets `PLATFORM_REDIS_MODE=redis` and uses the shared Redis service for production-style room discovery, presence, and future horizontal scaling.

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
