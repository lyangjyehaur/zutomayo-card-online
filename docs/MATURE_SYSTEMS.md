# Mature Systems Adoption

This document records where the project should use mature external systems or frameworks instead of maintaining bespoke infrastructure.

## Decisions

| Area                        | Decision                                                              | Status    | Rationale                                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account management          | Use Logto                                                             | Adopted   | Authentication, sign-in/out, identity lifecycle, and token verification should not be hand-rolled. The app keeps only game-local profile, deck, match, and leaderboard data.                                                                                                                                    |
| Error reporting             | Use GlitchTip/Sentry-compatible SDKs                                  | Adopted   | Browser, API, and game-server exceptions need release/environment context and production alerting. Session replay stays disabled to avoid hidden card/deck leakage.                                                                                                                                             |
| API routing and validation  | Use Hono + Zod                                                        | Adopted   | Handwritten route dispatch, body parsing, CORS, error handling, and query/body validation are better handled by a small framework while preserving existing SQL and Redis behavior.                                                                                                                             |
| Admin CRUD                  | Use Refine core; do not adopt Directus                                | Adopted   | Admin CRUD is only for back-office data maintenance. Refine now provides the resource/data-provider layer over the existing Admin API, while the API remains responsible for auth, validation, audit logging, and game-specific write rules. Directus is unnecessary without CMS or third-party data API needs. |
| Online matchmaking/presence | Keep boardgame.io + Redis for now; re-evaluate Colyseus before Nakama | Evaluated | Current online play is 1v1 boardgame.io rooms with a Redis Lua queue. Colyseus is the closer fit if matchmaking/presence becomes custom realtime room infrastructure. Nakama is heavier and becomes attractive only with broader social, party, wallet/inventory, or cross-game platform needs.                 |

## Admin CRUD Recommendation

Use Refine as the admin CRUD framework:

- The admin page is wrapped in Refine core.
- The Refine `dataProvider` is backed by existing `/api/admin/*` endpoints plus existing public read endpoints for card data.
- Card definitions, card i18n, game config, users, and matches are represented as resources.
- Keep Logto for player identity and the existing admin token flow until a dedicated admin identity model is designed.
- Keep server-side validation and audit logging in the API; Refine should structure the UI, not become the source of truth.

Do not adopt Directus for the current CRUD scope:

- It would introduce a second authorization and admin model beside Logto plus the existing API.
- Direct table editing is risky for game state, hidden information, ELO, and audit-sensitive records.
- The current CRUD surface is internal back-office maintenance, not a public data API or CMS.
- Its best fit would be content operations such as news, announcements, rich CMS pages, or non-developer card database maintenance after a clear permission model exists.

Adopt Directus later only if all of these are true:

1. Non-developers need broad CMS-style content editing.
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
2. Continue moving admin CRUD flows through Refine resource/data-provider boundaries.
3. Before replacing online infrastructure, first finish stale-room cleanup, abandon handling, and invite/share-link polish in the current boardgame.io + Redis stack.
4. Revisit Colyseus/Nakama only after those current-stack lifecycle gaps are measured in production.
