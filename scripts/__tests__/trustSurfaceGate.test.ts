import { describe, expect, it } from 'vitest';
import {
  parseTrustSurfaceArguments,
  REQUIRED_LS10_EVIDENCE,
  summarizeTrustSurfaceReport,
  validateTrustSurfaceTopology,
} from '../trust-surface-gate';

function passingReport() {
  return {
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [
      {
        specs: [
          {
            title: 'trust journey @ls10-trust',
            tests: [
              {
                results: [
                  {
                    annotations: REQUIRED_LS10_EVIDENCE.map((description) => ({ type: 'ls10', description })),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('trust surface staging gate', () => {
  it('accepts only the supported evidence output option', () => {
    expect(parseTrustSurfaceArguments([]).outputPath).toContain('trust-surface.json');
    expect(parseTrustSurfaceArguments(['--output', 'evidence/trust.json']).outputPath).toMatch(
      /evidence\/trust\.json$/,
    );
    expect(() => parseTrustSurfaceArguments(['--profile', 'beta'])).toThrow('usage:');
  });

  it('requires every independent trust marker and a retry-free critical test', () => {
    expect(summarizeTrustSurfaceReport(passingReport())).toMatchObject({
      passed: true,
      expected: 1,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
      foundJourneyEvidence: REQUIRED_LS10_EVIDENCE,
    });

    const missing = passingReport();
    missing.suites[0].specs[0].tests[0].results[0].annotations.pop();
    expect(summarizeTrustSurfaceReport(missing).failures).toContain(
      'required LS-10 evidence deleted-account-rejected is missing from the report',
    );

    const skipped = passingReport();
    skipped.stats = { expected: 0, skipped: 1, unexpected: 0, flaky: 0 };
    expect(summarizeTrustSurfaceReport(skipped)).toMatchObject({ passed: false, skipped: 1 });
  });

  it('refuses the known or configured production hostname', () => {
    const production = {
      E2E_BASE_URL: 'https://battle.zutomayocard.online/',
      E2E_API_URL: 'https://battle.zutomayocard.online/api',
      E2E_PLATFORM_URL: 'wss://battle.zutomayocard.online/colyseus',
    };
    expect(() => validateTrustSurfaceTopology(production)).toThrow('refuses production hostname');
    expect(() =>
      validateTrustSurfaceTopology({
        ...production,
        E2E_BASE_URL: 'https://staging.cards.example.com/',
        E2E_API_URL: 'https://staging.cards.example.com/api',
        E2E_PLATFORM_URL: 'wss://staging.cards.example.com/colyseus',
        PRODUCTION_HOSTNAME: 'staging.cards.example.com',
      }),
    ).toThrow('refuses production hostname');
  });
});
