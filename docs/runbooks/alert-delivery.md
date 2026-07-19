# Alert Delivery And Resolution Drill

## Pass condition

RR-07 requires evidence that the assigned on-call destination received both firing and resolved notifications for all player-impacting failure classes:

1. `api-failure`
2. `platform-failure`
3. `reconnect-spike`
4. `database-outage`
5. `resource-pressure`
6. `outbox-backlog`

Prometheus showing an alert as firing is not delivery evidence. Each scenario needs an HTTPS receipt link from the actual on-call destination plus injection and receipt timestamps.

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

Include all six scenario objects. Missing scenarios, non-HTTPS receipts, receipt timestamps predating injection, or delivery beyond the configured threshold fail closed.
