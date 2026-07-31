# Traffic And Reliability Baseline

Status: Measurement setup in progress  
Workstream: `LS-01`  
Evidence ID: `LS-EV-20260731-03`  
Observed at: 2026-07-31 (Asia/Taipei)  
Release observed: `fb37aed78983818d59388c182aa7fcb1f26b9ee9` / `0.2.5`

This document records the day-0, privacy-preserving discovery for the seven-day live-service baseline. It is not yet seven-day SLO evidence. Raw identifiers, credentials, request bodies, chat content, and match state are excluded.

## Day-0 Finding

The production host was inspected read-only. Game, API, and Platform expose protected Prometheus metrics, but no Prometheus, Grafana, or exporter containers were running at the observation time. The application containers had been running for about ten hours, so their in-process counters cannot provide a durable seven-day history.

Repository monitoring configuration exists in `docker-compose.monitoring.yml`, but configuration in Git is not evidence that production collection is active. The seven-day measurement window starts only after a durable collector is deployed and a scrape/storage receipt is recorded.

## Privacy-Preserving Database Snapshot

Read-only aggregate queries returned these current totals:

| Aggregate                          | Value |
| ---------------------------------- | ----: |
| Registered accounts                |    22 |
| Stored decks                       |    16 |
| Canonical completed matches        |     0 |
| Current boardgame.io match rows    |     0 |
| Platform match-participant records |    69 |
| Platform room-participant records  |    83 |

The following diagnostic groups records by their current `last_seen_at` date and counts distinct users. It is only a latest-participation proxy, not DAU: later activity can move a user's record to another date, and non-room activity is absent.

| UTC date   | Latest-participation proxy | New accounts | New decks | Completed matches |
| ---------- | -------------------------: | -----------: | --------: | ----------------: |
| 2026-07-24 |                          2 |            1 |         2 |                 0 |
| 2026-07-25 |                          1 |            0 |         5 |                 0 |
| 2026-07-26 |                          1 |            0 |         1 |                 0 |
| 2026-07-27 |                          0 |            2 |         0 |                 0 |
| 2026-07-28 |                          1 |            0 |         0 |                 0 |
| 2026-07-29 |                          3 |            0 |         0 |                 0 |
| 2026-07-30 |                          1 |            1 |         0 |                 0 |
| 2026-07-31 |                          0 |            0 |         0 |                 0 |

These values show real but very low platform use. They do not establish match success, completion, reconnect success, latency, or availability.

## Measurement Coverage

| Required measurement            | Existing source                                                | Day-0 assessment                                                |
| ------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| DAU                             | Umami daily unique visitors/sessions; participant proxy        | Source exists; authenticated production query receipt pending   |
| Peak CCU                        | Game and Platform active-connection gauges                     | Instrumented in process; durable collection absent              |
| Match starts                    | Umami `F_Match_Start`                                          | Instrumented; production event receipt pending                  |
| Match completions               | Umami event, Game counter, and `matches.completed_at`          | Instrumented; observed canonical completed-match value is zero  |
| Queue duration                  | Umami queue events plus Platform counter and histogram         | Instrumented locally; production receipt and collection pending |
| Reconnects                      | Connection attempt/success events and Platform success counter | Attempt denominator added locally; production receipt pending   |
| HTTP 5xx and API latency        | HTTP counters and duration histograms                          | Instrumented; durable collection absent                         |
| WebSocket connection latency    | Connection success `elapsed_s`, split by initial/reconnect     | Instrumented locally; production event receipt pending          |
| Dependency health               | Readiness probes and dependency failure counters               | Configuration exists; durable collection absent                 |
| CPU, memory, DB, Redis, network | cAdvisor, PostgreSQL exporter, Redis exporter configuration    | Configuration exists; production exporters not observed running |

## Start Gate For The Seven-Day Window

The window start timestamp must be recorded only after all of these checks pass:

1. A production collector scrapes Game, API, Platform, readiness, PostgreSQL, Redis, and container resources every 15 seconds and retains at least fourteen days.
2. Current metric names are used by the dashboards; panels that query unimplemented metrics are removed or corrected.
3. Production Umami receives the allowlisted match, queue, and connection events, with saved queries for DAU, reconnect success, and successful connection latency.
4. The collector survives an application restart and the post-restart query still covers the pre-restart interval.
5. A redacted receipt records collector version, target release, scrape-target health, retention setting, window start time, and operator review.

No production monitoring deployment was performed during this inspection. That external operational change requires an explicit operator-approved rollout and a rollback path.

## Repository Changes Prepared

The local task-scoped change adds bounded `platform_quick_match_outcomes_total` and `platform_quick_match_wait_duration_seconds` metrics. Each quick-match room records only its first queue outcome, so a matched room that later cancels before game creation cannot enter both queue result categories.

The Platform Grafana dashboard now uses the implemented `platform_connected_clients`, reconnect, Platform HTTP, and quick-match metric names. Panels that previously queried unimplemented connection, participant, chat, and Redis-latency metrics were removed or replaced. These changes remain local evidence until the identified build is deployed and scraped successfully.

The existing privacy-allowlisted funnel already covers queue, match start, match completion, and successful reconnect events. The local task-scoped change adds `F_Match_Connection_Attempt` and `F_Match_Connection_Success`, split only by `initial` or `reconnect`, with successful elapsed seconds. This supplies a reconnect denominator and WebSocket connection-latency distribution without adding user, room, match, deck, card, or chat identifiers.

Local verification passed `npm run verify` with exit code 0, including release and operations configuration gates, 199/199 test files with 1,554/1,554 passing tests, coverage thresholds, and the production build. This proves the repository change, not production collection.

## Next Actions

- Deploy and confirm the prepared Platform dashboard and quick-match metrics.
- Confirm production Umami receipts and save the DAU, connection-success, latency, queue, and match queries in [`funnel-analytics.md`](funnel-analytics.md).
- Decide and execute the production monitoring deployment separately from the server4 beta application deployment.
- After the start gate passes, append one aggregate row per UTC day and compare the completed seven-day window with [`SLO.md`](SLO.md).
