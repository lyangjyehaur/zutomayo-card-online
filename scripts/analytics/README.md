# Match analytics query pack

Run the core read-only report against an isolated analytics connection or a production read replica:

```bash
psql "$ANALYTICS_DATABASE_URL" --set=ON_ERROR_STOP=1 --file scripts/analytics/match-analytics-core.sql
```

The SQL never selects account identifiers or the original boardgame match ID. Balance queries partition by app, rules, and card-dataset identity and exclude abandoned, non-production, and timeout-heavy sessions. Internal results retain their sample size and 95% Wilson interval. Deck and card rows below 100 eligible appearances are explicitly marked `insufficient_sample` and must not be published as conclusions.

Connection classes are whole-match summaries based on trusted disconnect/reconnect counters; they do not prove socket state at the exact timeout event. Quick/custom/invite provenance is written by the platform relay and is never inferred from browser claims.

`npm run db:roles:smoke` loads `match-analytics-fixture.sql` only into its disposable `role_smoke` database and compares every query result with `match-analytics-expected.csv`. The fixture refuses database names that do not clearly identify a test environment.
