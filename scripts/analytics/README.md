# Match analytics query pack

Run the core read-only report against an isolated analytics connection or a production read replica:

```bash
psql "$ANALYTICS_DATABASE_URL" --set=ON_ERROR_STOP=1 --file scripts/analytics/match-analytics-core.sql
```

The SQL never selects account identifiers or the original boardgame match ID. Balance queries partition by app, rules, and card-dataset identity and exclude abandoned, non-production, and timeout-heavy sessions. Internal results retain their sample size and 95% Wilson interval. Deck and card rows below 100 eligible appearances are explicitly marked `insufficient_sample` and must not be published as conclusions.

The funnel reports zero-action abandoned rows with `missing-seat-reservation` as `unformed_sessions`. They remain visible for room-formation operations, but are excluded from the denominator used for gameplay completion and abandonment rates.

Connection classes remain whole-match summaries based on trusted disconnect/reconnect counters. The lifecycle report separately groups server-derived `connectionDisconnect` and `connectionReconnect` events by mode, game step, and seat, and reports p50/p90 reconnect gaps. Its payload contains only bounded offsets/durations; no absolute timestamp or match, room, session, socket, user, or IP identifier is selected. Quick/custom/invite provenance is written by the platform relay, while direct provenance is established by the trusted game/platform runtime; neither is inferred from browser claims.

`npm run db:roles:smoke` loads `match-analytics-fixture.sql` only into its disposable `role_smoke` database and compares every query result with `match-analytics-expected.csv`. The fixture refuses database names that do not clearly identify a test environment.
