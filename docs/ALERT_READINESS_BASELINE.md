# Alert Readiness Baseline

Status: Local configuration validated; production delivery evidence pending  
Workstream: `LS-03`  
Evidence ID: `LS-EV-20260731-05`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: `704c1aa5f2b030011b681316421a74677b447f44` / `0.2.5`

This document records local validation of alert rules, routing configuration, and the receipt evidence gate. It is not proof that a production on-call destination received an alert.

## Local Validation

| Check                        | Result                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| Prometheus rule syntax       | Passed with `promtool`; 28 rules found                                |
| Alertmanager configuration   | Passed with `amtool`; 3 receivers found                               |
| Operational evidence tests   | Passed; receipts fail closed on incomplete or mismatched evidence     |
| Repository verification      | `npm run verify` exited 0; 199/199 files and 1,554/1,554 tests passed |
| Alert destination delivery   | Not exercised                                                         |
| Firing and resolved receipts | Pending                                                               |

The local change adds direct rules for:

- `PlatformReconnectSpike`, based on accepted platform reconnects over five minutes.
- `PostgresExporterDown`, so loss of PostgreSQL monitoring is explicit rather than inferred only through application readiness.
- `RedisExporterDown`, so loss of Redis monitoring is explicit.
- Platform event-loop lag through the existing `HighEventLoopLag` alert.

The hardening receipt gate now requires exactly one entry for each of the six approved scenarios. Each entry must include a mapped alert name, a named controlled injection, exact firing/resolved timestamps, a recipient role, and an HTTPS receipt URL. Duplicate scenarios, unknown scenarios, and scenario-to-alert mismatches fail closed.

## Scope Limits

- Production had no observed durable Prometheus or Alertmanager deployment at the day-0 inspection.
- No real Slack, email, paging, or other on-call destination was contacted during local validation.
- Rule syntax and evidence validation do not prove notification delivery, acknowledgement, escalation, or recovery handling.
- The accountable on-call role and private contact directory still require operator confirmation under `LS-00`.
- No incident timeline has yet recorded detection, acknowledgement, mitigation, resolution, and follow-up for the target production release.

`LS-03` therefore remains `Evidence pending`.

## Production Acceptance Steps

1. Deploy the persistent collector and Alertmanager with a real secret-managed notification destination.
2. Select one critical service-unavailable scenario from [`alert-delivery.md`](runbooks/alert-delivery.md), record the release and configuration identity, and run the controlled staging injection.
3. Capture actual firing and resolved destination receipts with exact timestamps and the accountable recipient role.
4. Record acknowledgement, mitigation, recovery, and follow-up timestamps in the redacted incident timeline.
5. Run all six scenarios for production-hardening evidence, then archive the raw receipt through the operational evidence gate.
