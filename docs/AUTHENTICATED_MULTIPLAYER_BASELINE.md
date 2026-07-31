# Authenticated Multiplayer Baseline

Status: Local evidence contract validated; production-like staging journey pending  
Workstream: `LS-05`  
Evidence ID: `LS-EV-20260731-07`  
Observed at: 2026-07-31 (Asia/Taipei)  
Repository release: `704c1aa5f2b030011b681316421a74677b447f44` / `0.2.5`

This document records the local implementation and validation of the authenticated multiplayer evidence contract. It is not a staging journey receipt. No staging or production endpoint was contacted while preparing this baseline.

## Evidence Contract

Every retry-free Playwright run must finish both critical tests and independently record all of these markers after their assertions pass:

| Journey evidence               | Proven behavior                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| `authenticated-sessions`       | Independent accounts completed registration and authenticated login |
| `secure-cookies`               | Both sessions received Secure and HttpOnly authentication cookies   |
| `server-backed-decks`          | Both players selected an enabled deck supplied by the server        |
| `quick-match`                  | Both browsers joined the same Quick Match room                      |
| `same-origin-websocket`        | The browser used WSS through the application origin                 |
| `chat-authorization`           | An authenticated match message reached the opponent                 |
| `disconnect-reconnect`         | A browser disconnected and rejoined the active match                |
| `spectator-hidden-information` | Spectator controls stayed read-only and hand cards stayed hidden    |
| `result-submission`            | Surrender produced player and spectator result delivery             |
| `match-history`                | Both server histories and both history pages recorded the result    |
| `friend-invite`                | Two authenticated friends joined the same invited match             |

The runner fails closed when a marker, critical test, report, or immutable identity field is absent. Aggregate test success is not accepted as proof for an unobserved sub-journey.

## Release Binding

The generated evidence records and validates:

- the full release commit SHA;
- five immutable game, API, platform, migration, and retention image references;
- the expected migration basename and SHA-256 checksum;
- the expected card dataset SHA-256;
- GitHub Actions provenance or an accountable HTTPS signer;
- SHA-256 hashes for the raw Playwright report and redacted log.

The release gate requires the authenticated evidence migration to match the release manifest. It also requires its dataset SHA-256 to match the separately generated `staging/card-dataset.json` receipt. Missing or conflicting identity evidence blocks the gate.

## Local Verification

| Check                                       | Result                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Authenticated runner and release-gate tests | 12/12 tests passed                                                      |
| Script TypeScript check                     | Passed                                                                  |
| Repository verification                     | 199/199 files and 1,556/1,556 tests passed; production/PWA build passed |

## Scope Limits

- No production-like HTTPS/WSS journey has been executed for this release candidate.
- No current screenshots, Playwright trace, server log, or staging receipt exists yet.
- The local test proves contract behavior with synthetic report fixtures; it does not prove the deployed proxy, cookie, PostgreSQL, Redis, game, API, or platform path.
- Beta acceptance requires one complete run. Five consecutive complete runs remain production-hardening evidence.

`LS-05` therefore remains `Evidence pending`.

## Staging Acceptance Steps

1. Generate `staging/card-dataset.json` for the exact staging release and retain its dataset SHA-256.
2. Deploy the same immutable release manifest to the production-like staging topology.
3. Set `EXPECTED_CARD_DATASET_SHA256` to the dataset receipt value and run `npm run e2e:authenticated-staging` through the public HTTPS/WSS gateway.
4. Confirm both critical tests, all 11 markers, zero skips/failures/flakes, migration identity, dataset identity, and artifact hashes pass.
5. Run `npm run release:gate` with the release manifest and the combined staging evidence directory.
6. Archive the evidence artifact in access-controlled operational storage and obtain Backend/QA review.
