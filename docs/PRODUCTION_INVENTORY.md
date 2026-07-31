# Production Identity And Service Inventory

Status: Evidence reviewed, remediation pending  
Workstream: `LS-00`  
Evidence ID: `LS-EV-20260731-01`  
Observed at: 2026-07-31 (Asia/Taipei)  
Target: server4 production deployment

This is the redacted repository summary of a read-only production inspection. The raw operator capture remains in access-controlled operational storage. It contains no credentials, user identifiers, private hostnames, or application payloads.

## Release Identity

| Field                       | Observed value                                                     | Evidence                                                      |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Deployed Git SHA            | `fb37aed78983818d59388c182aa7fcb1f26b9ee9`                         | Remote checkout, API `/api/version`, and `APP_BUILD_ID` agree |
| Deployment marker           | `2026-07-30T17:08:25Z`                                             | Remote `.release.deployed-at`                                 |
| `APP_VERSION`               | `0.2.5`                                                            | Whitelisted runtime configuration and API response            |
| `APP_BUILD_ID`              | `fb37aed78983818d59388c182aa7fcb1f26b9ee9`                         | Whitelisted runtime configuration and API response            |
| `GAME_RULES_VERSION`        | `0.2.5`                                                            | Whitelisted runtime configuration and API response            |
| Latest applied migration    | `000047_knowledge_search_zero_results`                             | Read-only query through the API database role                 |
| Expected migration checksum | `1cc642a9e10c17ce91f232ceb957b44e1e87dedd5f9e37c4f9cb9a5f7ff0faff` | Whitelisted runtime configuration                             |
| Public card dataset hash    | `fcca13c58bde67a723b0359de377b6e17a2f905f752ecd5c8a84cda2bb137c96` | Active official release row and `/api/official/status` agree  |
| Official release ID         | `c5893098e06b79e9d5167b09bef19231583cee460ca067735886e8b0ffb27c99` | API `/api/official/status`                                    |

## Application Units

| Unit      | Replicas / schedule        | Observed immutable content digest                                                         | State                                                                         |
| --------- | -------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Game      | 1                          | `sha256:a458961c2e72ceeb1bccb8846a7c80e5336e2779019446581e4e2bb511318b02`                 | Running, healthy                                                              |
| API       | 1                          | `sha256:06903ac559487f8ff9d10cf52128e4c6b0c68a9326b6551443b3bfd6df972c6a`                 | Running, healthy                                                              |
| Platform  | 1                          | `sha256:16d3eb186325c937a22a2fa72e86b032bacd2d973eccae8f3fc8ec3e27b56e77`                 | Running, healthy                                                              |
| Migration | One-shot during deployment | `sha256:756077ff13f3411da0e4c13e7b66364fe2b86d680d09b368e29d3036dfb45411` present on host | Applied migration is verified; execution-to-image attestation is not retained |
| Retention | Daily systemd timer        | Not deployed / not resolvable                                                             | Timer is active but every reviewed run was skipped                            |

The running Game, API, and Platform containers use content matching the recorded GHCR `RepoDigest`. The server4 Compose configuration still references mutable `:latest` tags, so the configuration itself does not pin these digests.

## Dependencies

| Dependency                  | Observed version / digest                                                                                 | State / ownership boundary                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| PostgreSQL                  | `postgres:16.14-alpine`, `sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb`        | Running external 1Panel container                                          |
| Redis                       | `redis:8.6.3`, `sha256:4d25e2fe601f7ffaeb4437cb6ced3518bc36edf34ebe98863c80836943d94529`                  | Running external 1Panel container                                          |
| Meilisearch                 | `getmeili/meilisearch:v1.51.0`, `sha256:a9eb29ee09ab4943db3b4c68620bd6f3382e6b2b0ac4431c0e607b48dbcd4c14` | Running external 1Panel container                                          |
| Reverse proxy               | `1panel/openresty:1.31.1.1-2-1-noble`                                                                     | Running external 1Panel container                                          |
| External identity           | Logto                                                                                                     | Runtime integration present; accountable operator still needs recording    |
| DNS / edge                  | Cloudflare                                                                                                | Deployment integration present; accountable operator still needs recording |
| Monitoring / alert delivery | Prometheus-compatible metrics and configured alerts                                                       | Delivery owner and current receipt are deferred to `LS-03`                 |
| Backup                      | Pre-deploy PostgreSQL custom-format dump and WAL tooling                                                  | Restore authority and current proof are deferred to `LS-02`                |

## Topology Differences And Gaps

1. `docker-compose.server4.yml` runs Game, API, Platform, and migration, while the documented retention worker is a separate systemd-triggered Compose job.
2. `/opt/zutomayo-card-online/.release.env` is absent. `zutomayo-retention.service` requires that file, so the daily timer has skipped every reviewed run from 2026-07-14 through 2026-07-30.
3. No production retention image or immutable retention digest is present on the host.
4. The long-running server4 Compose services reference `:latest`; the running container contents are identifiable, but a future recreation is not configuration-pinned to those digests.
5. The migration image exists on the host and the schema is current, but the deployment does not retain an immutable execution manifest proving that exact image performed the migration.
6. The repository documents operational commands, but named authority for deploy, restore, credential rotation, identity administration, Cloudflare, and alert receipt is not yet recorded in an access-controlled owner directory.

## Required Follow-Up

- Generate and install a verified `.release.env` for server4 with immutable Game, API, Platform, migration, and retention image references.
- Make server4 recreation consume immutable references instead of mutable `:latest` tags.
- Run the retention worker successfully and retain its timestamp, image digest, result, and metrics receipt.
- Record accountable operational roles in the private owner directory and link that directory from the stabilization evidence.
- Re-run this inventory after remediation before marking `LS-00` complete.
