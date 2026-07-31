import { describe, expect, it } from 'vitest';
import {
  parseEvidenceArguments,
  REQUIRED_LS05_EVIDENCE,
  summarizePlaywrightReport,
  validateReleaseMetadata,
  validateStagingTopology,
} from '../authenticated-multiplayer-gate';

function passingReport() {
  return {
    stats: { expected: 2, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [
      {
        specs: [
          {
            title: '完整旅程 @rr05-core',
            tests: [
              {
                results: [
                  {
                    annotations: REQUIRED_LS05_EVIDENCE.filter((item) => item !== 'friend-invite').map(
                      (description) => ({ type: 'ls05', description }),
                    ),
                  },
                ],
              },
            ],
          },
          {
            title: '好友邀請 @rr05-invite',
            tests: [{ results: [{ annotations: [{ type: 'ls05', description: 'friend-invite' }] }] }],
          },
        ],
      },
    ],
  };
}

describe('authenticated multiplayer staging gate', () => {
  it('runs one Beta proof by default and reserves five runs for hardening', () => {
    expect(parseEvidenceArguments([])).toMatchObject({ profile: 'beta', requiredRuns: 1 });
    expect(parseEvidenceArguments(['--profile', 'production-hardening'])).toMatchObject({
      profile: 'production-hardening',
      requiredRuns: 5,
    });
    expect(() => parseEvidenceArguments(['--profile', 'unknown'])).toThrow('usage:');
  });

  it('accepts only HTTPS/WSS same-origin reverse-proxy topology', () => {
    expect(
      validateStagingTopology({
        E2E_BASE_URL: 'https://staging.cards.example.com/',
        E2E_API_URL: 'https://staging.cards.example.com/api',
        E2E_PLATFORM_URL: 'wss://staging.cards.example.com/colyseus',
      }),
    ).toEqual({
      baseURL: 'https://staging.cards.example.com/',
      apiURL: 'https://staging.cards.example.com/api',
      platformURL: 'wss://staging.cards.example.com/colyseus',
      origin: 'https://staging.cards.example.com',
    });
  });

  it('rejects local, insecure, and split-host evidence topology', () => {
    expect(() =>
      validateStagingTopology({
        E2E_BASE_URL: 'http://localhost:3000',
        E2E_API_URL: 'http://localhost:3000/api',
        E2E_PLATFORM_URL: 'ws://localhost:3002',
      }),
    ).toThrow('must use https:');
    expect(() =>
      validateStagingTopology({
        E2E_BASE_URL: 'https://localhost/',
        E2E_API_URL: 'https://localhost/api',
        E2E_PLATFORM_URL: 'wss://localhost/colyseus',
      }),
    ).toThrow('production-like staging hostname');
    expect(() =>
      validateStagingTopology({
        E2E_BASE_URL: 'https://staging.cards.example.com/',
        E2E_API_URL: 'https://api-staging.cards.example.com/api',
        E2E_PLATFORM_URL: 'wss://platform-staging.cards.example.com/',
      }),
    ).toThrow('reverse-proxied');
  });

  it('requires both critical tests with zero skips, failures, retries, or extras', () => {
    expect(summarizePlaywrightReport(passingReport())).toMatchObject({
      passed: true,
      expected: 2,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
      foundJourneyEvidence: REQUIRED_LS05_EVIDENCE,
    });

    const skipped = passingReport();
    skipped.stats = { expected: 1, skipped: 1, unexpected: 0, flaky: 0 };
    expect(summarizePlaywrightReport(skipped)).toMatchObject({ passed: false, skipped: 1 });

    const flaky = passingReport();
    flaky.stats.flaky = 1;
    expect(summarizePlaywrightReport(flaky)).toMatchObject({ passed: false, flaky: 1 });

    const missing = passingReport();
    missing.suites[0].specs.pop();
    expect(summarizePlaywrightReport(missing).failures).toContain(
      'required test @rr05-invite is missing from the report',
    );

    const missingEvidence = passingReport();
    missingEvidence.suites[0].specs[0].tests[0].results[0].annotations.pop();
    expect(summarizePlaywrightReport(missingEvidence).failures).toContain(
      'required LS-05 evidence match-history is missing from the report',
    );
  });

  it('binds evidence to an immutable release, migration, dataset, and image set', () => {
    const env = {
      RELEASE_ENVIRONMENT: 'staging',
      RELEASE_SHA: 'a'.repeat(40),
      EXPECTED_SCHEMA_MIGRATION: '000047_knowledge_search_zero_results',
      EXPECTED_SCHEMA_CHECKSUM: 'b'.repeat(64),
      EXPECTED_CARD_DATASET_SHA256: 'c'.repeat(64),
      E2E_EVIDENCE_SIGNER_URL: 'https://evidence.example.test/run/123',
      ...Object.fromEntries(
        ['GAME', 'API', 'PLATFORM', 'MIGRATE', 'RETENTION'].map((name) => [
          `${name}_IMAGE`,
          `ghcr.io/example/${name.toLowerCase()}@sha256:${'d'.repeat(64)}`,
        ]),
      ),
    };
    expect(validateReleaseMetadata(env)).toMatchObject({
      migration: {
        name: '000047_knowledge_search_zero_results',
        sha256: 'b'.repeat(64),
      },
      datasetSha256: 'c'.repeat(64),
    });
    expect(() => validateReleaseMetadata({ ...env, EXPECTED_CARD_DATASET_SHA256: '' })).toThrow(
      'EXPECTED_CARD_DATASET_SHA256',
    );
  });
});
