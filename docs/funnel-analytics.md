# Public Beta Funnel Analytics

This is the event contract for RR-08. Umami remains the analytics backend; no second product analytics service is introduced.

## Privacy Boundary

Funnel events may contain only application/rules/dataset version, locale, viewport class, first entry route, aggregate step/timing/mode, reason, and outcome fields. They must not contain user IDs, match/room/invite IDs, deck or card IDs, chat text, email, nickname, or free-form player input. `src/funnelAnalytics.ts` enforces the client-side allowlist.

## Events

| Event                     | Meaning                                                 | Event-specific fields                      |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| `F_Tutorial_Start`        | Tutorial route became interactive                       | `total_steps`                              |
| `F_Tutorial_Step`         | A tutorial step became current                          | `step`, `total_steps`, `phase`             |
| `F_Tutorial_First_Action` | The first action-driven step completed                  | `step`, `phase`, `elapsed_s`               |
| `F_Tutorial_Exit`         | Player left before completion                           | `reason`, `elapsed_s`                      |
| `F_Tutorial_Complete`     | Player completed the final step                         | `total_steps`, `elapsed_s`                 |
| `F_Queue_Start`           | Quick Match queue started                               | `match_mode`                               |
| `F_Queue_Checkpoint`      | Queue reached the 45-second fallback point              | `match_mode`, `queue_duration_s`           |
| `F_Queue_Cancel`          | Player cancelled or chose a fallback                    | `match_mode`, `queue_duration_s`, `reason` |
| `F_Queue_Match`           | Queue produced a playable boardgame.io session          | `match_mode`, `queue_duration_s`           |
| `F_Match_Start`           | Both online players were detected                       | `match_mode`                               |
| `F_Match_Reconnect`       | An online player rejoined an existing WebSocket session | `match_mode`                               |
| `F_Match_Complete`        | A seated online player reached a final result           | `match_mode`, `outcome`                    |
| `F_First_Win`             | First win observed in this browser profile              | `match_mode`, `outcome`                    |

Every event also includes `app_version`, `build_id`, `rules_version`, `dataset_sha256`, `locale`, `viewport_class`, and `entry_route`.

## Beta Queries

Create saved Umami segments for the exact `build_id` and `dataset_sha256` under review. The minimum operating queries are:

1. Tutorial: `Start -> First_Action -> Complete`, grouped by locale and viewport class; inspect `Exit.reason` and median `First_Action.elapsed_s`.
2. Quick Match: `Queue_Start -> Queue_Match -> Match_Start`, with checkpoint and cancellation rates plus queue-duration percentiles.
3. First match: `Match_Start -> Match_Complete`, grouped by viewport, locale, and outcome.
4. Activation: first entry pageview or `entry_route -> Tutorial_Complete/Queue_Match -> Match_Complete -> First_Win`.

Do not combine different build IDs or dataset hashes in a release decision. RR-08 remains open until the production Umami destination receives these events and the saved queries are verified with synthetic Beta accounts.
