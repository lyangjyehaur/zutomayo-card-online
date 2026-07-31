# Alert Delivery And Resolution Drill

## Pass condition

`LS-03` requires at least one critical service-unavailable firing and resolved delivery receipt. The production-hardening evidence gate is stricter and requires the assigned on-call destination to receive both notifications for all player-impacting failure classes:

1. `api-failure`
2. `platform-failure`
3. `reconnect-spike`
4. `database-outage`
5. `resource-pressure`
6. `outbox-backlog`

Prometheus showing an alert as firing is not delivery evidence. Each scenario needs an HTTPS receipt link from the actual on-call destination plus injection and receipt timestamps.

Each scenario must use one of these implemented alert rules:

| Scenario            | Approved alert names                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-failure`       | `ServiceDown`, `ReadinessProbeFailed`, `HighErrorRate5xx`                                                                                                              |
| `platform-failure`  | `ServiceDown`, `PlatformHealthProbeFailed`, `ReadinessProbeFailed`, `PlatformHighErrorRate5xx`                                                                         |
| `reconnect-spike`   | `PlatformReconnectSpike`, `WebSocketConnectionsHigh`                                                                                                                   |
| `database-outage`   | `ReadinessProbeFailed`, `PostgresExporterDown`, `MatchResultOutboxMetricsStale`, `RelationshipChangeOutboxMetricsStale`                                                |
| `resource-pressure` | `HighEventLoopLag`                                                                                                                                                     |
| `outbox-backlog`    | `MatchResultOutboxBacklog`, `MatchResultOutboxOldestRow`, `RelationshipChangeOutboxBacklog`, `RelationshipChangeOutboxOldestRow`, `RelationshipChangeOutboxDeadLetter` |

## Controlled staging procedures

- API/platform failure: stop only the target staging service and wait for `ServiceDown`, `ReadinessProbeFailed`, or `PlatformHealthProbeFailed`; restart it and wait for resolved delivery.
- Reconnect spike: use the existing WebSocket load test at a bounded staging connection count and verify the connection/readiness alert plus recovery.
- Database outage: use the provider staging failover control or an approved network block; do not run a production outage from this runbook.
- Resource pressure: apply a bounded staging CPU/memory limit and verify event-loop, readiness, or container pressure alert delivery.
- Outbox backlog: pause the staging delivery worker or insert an approved fixture through the migration role, verify the backlog/oldest-row alert, then redrive and verify resolution.

Record the final receipt as JSON:

```json
{
  "schemaVersion": 1,
  "status": "passed",
  "environment": "staging",
  "releaseSha": "<40-character-sha>",
  "alertmanagerUrl": "https://alerts.staging.example.com",
  "scenarios": [
    {
      "scenario": "api-failure",
      "alertName": "ServiceDown",
      "injection": "stopped only the staging API service",
      "firingInjectedAt": "2026-07-19T03:00:00.000Z",
      "firingReceivedAt": "2026-07-19T03:00:25.000Z",
      "resolvedInjectedAt": "2026-07-19T03:05:00.000Z",
      "resolvedReceivedAt": "2026-07-19T03:05:20.000Z",
      "recipient": "beta-on-call",
      "receiptUrl": "https://chat.example.com/archives/alerts/message-id"
    }
  ]
}
```

For production-hardening evidence, include exactly one object for each of the six scenarios. Duplicate or unknown scenarios, an alert name that does not match the scenario, an empty injection description, non-HTTPS receipts, receipt timestamps predating injection, or delivery beyond the configured threshold fail closed.

## Stabilization receipt

The first `LS-03` receipt may cover only one critical service-unavailable scenario, but its redacted record must still include the same scenario, alert name, injection, timestamps, recipient role, and receipt URL fields. Record the Alertmanager build/config identity and release SHA, then append the firing, acknowledgement, mitigation, recovery, and follow-up timestamps to the incident timeline. Do not label a Prometheus rule evaluation as delivered unless the actual on-call destination received it.
