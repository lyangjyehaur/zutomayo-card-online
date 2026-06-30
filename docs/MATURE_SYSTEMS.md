# Mature Systems Adoption

This document records where the project should use mature external systems or frameworks instead of maintaining bespoke infrastructure.

## Decisions

| Area                        | Decision                                                              | Status    | Rationale                                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account management          | Use Logto                                                             | Adopted   | Authentication, sign-in/out, identity lifecycle, and token verification should not be hand-rolled. The app keeps only game-local profile, deck, match, and leaderboard data.                                                                                                                                      |
| Error reporting             | Use GlitchTip/Sentry-compatible SDKs                                  | Adopted   | Browser, API, and game-server exceptions need release/environment context and production alerting. Session replay stays disabled to avoid hidden card/deck leakage.                                                                                                                                               |
| API routing and validation  | Use Hono + Zod                                                        | Adopted   | Handwritten route dispatch, body parsing, CORS, error handling, and query/body validation are better handled by a small framework while preserving existing SQL and Redis behavior.                                                                                                                               |
| Admin CRUD                  | Prefer Refine incrementally; defer Directus                           | Evaluated | The current admin surface edits game-specific card/config/user/match resources through custom auth and validation. Refine can improve CRUD UI/data-provider structure without adding a second backend/auth plane. Directus is deferred until the project needs a general CMS/back-office owned by non-developers. |
| Online matchmaking/presence | Keep boardgame.io + Redis for now; re-evaluate Colyseus before Nakama | Evaluated | Current online play is 1v1 boardgame.io rooms with a Redis Lua queue. Colyseus is the closer fit if matchmaking/presence becomes custom realtime room infrastructure. Nakama is heavier and becomes attractive only with broader social, party, wallet/inventory, or cross-game platform needs.                   |

## Admin CRUD Recommendation

Use Refine when the admin UI next receives substantial CRUD work:

- Add a Refine `dataProvider` backed by existing `/api/admin/*` endpoints.
- Start with card definitions, card i18n, game config, users, and matches as resources.
- Keep Logto for player identity and the existing admin token flow until a dedicated admin identity model is designed.
- Keep server-side validation and audit logging in the API; Refine should structure the UI, not become the source of truth.

Do not adopt Directus yet:

- It would introduce a second authorization and admin model beside Logto plus the existing API.
- Direct table editing is risky for game state, hidden information, ELO, and audit-sensitive records.
- Its best fit is content operations such as news, announcements, rich CMS pages, or non-developer card database maintenance after a clear permission model exists.

Adopt Directus later only if all of these are true:

1. Non-developers need broad back-office editing.
2. The editable data can be isolated into safe tables/views.
3. Logto/Directus admin identity and permissions are designed together.
4. The API remains the owner of game-critical writes.

## Online Matchmaking And Presence Recommendation

Keep the current stack for now:

- `boardgame.io` remains the authoritative game state engine.
- Redis remains the matchmaking queue, rate-limit store, and pub/sub layer.
- PostgreSQL remains the durable store for matches, profiles, leaderboard, cards, and config.

Re-evaluate Colyseus when two or more of these become true:

1. Presence needs live lobby state beyond simple queue/status polling.
2. Matchmaking needs skill bands, region/latency rules, rematch flow, or party queueing.
3. Room lifecycle/abandon/reconnect behavior becomes too custom for boardgame.io alone.
4. Spectators or tournament rooms need first-class realtime server concepts.

Re-evaluate Nakama only when platform features matter more than simple rooms:

1. Parties/friends/chat/social graph are product requirements.
2. Built-in matchmaking, leaderboards, storage, and authoritative server modules should be centralized.
3. The deployment can absorb another stateful service and its operational model.
4. The project is becoming a broader multiplayer platform, not only this card game.

## Near-Term Sequence

1. Keep GlitchTip and Hono/Zod as adopted foundations.
2. If admin grows, refactor the existing admin page toward Refine resource/data-provider boundaries.
3. Before replacing online infrastructure, first finish stale-room cleanup, abandon handling, and invite/share-link polish in the current boardgame.io + Redis stack.
4. Revisit Colyseus/Nakama only after those current-stack lifecycle gaps are measured in production.
