import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateReleaseMetadata, validateStagingTopology } from './authenticated-multiplayer-gate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_TEST_TAG = '@ls10-trust';
const KNOWN_PRODUCTION_HOSTNAMES = new Set(['battle.zutomayocard.online']);
export const REQUIRED_LS10_EVIDENCE = [
  'public-policy-routes',
  'operator-contact',
  'retention-deletion-copy',
  'moderation-appeal-copy',
  'rightsholder-takedown-copy',
  'profile-policy-entry',
  'account-export',
  'account-deletion',
  'session-revocation',
  'deleted-account-rejected',
] as const;

interface PlaywrightReport {
  stats?: { expected?: unknown; skipped?: unknown; unexpected?: unknown; flaky?: unknown };
  suites?: unknown;
}

export interface TrustSurfaceRunSummary {
  passed: boolean;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
  foundJourneyEvidence: string[];
  failures: string[];
}

export function validateTrustSurfaceTopology(env: NodeJS.ProcessEnv) {
  const topology = validateStagingTopology(env);
  const hostname = new URL(topology.baseURL).hostname.toLowerCase();
  const configuredProductionHostname = env.PRODUCTION_HOSTNAME?.trim().toLowerCase();
  if (
    KNOWN_PRODUCTION_HOSTNAMES.has(hostname) ||
    (configuredProductionHostname && hostname === configuredProductionHostname)
  ) {
    throw new Error(`trust-surface rehearsal refuses production hostname ${hostname}`);
  }
  return topology;
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function collectReportData(value: unknown, titles: string[], evidence: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectReportData(item, titles, evidence);
    return;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.tests) && typeof record.title === 'string') titles.push(record.title);
  if (record.type === 'ls10' && typeof record.description === 'string') evidence.add(record.description);
  for (const child of Object.values(record)) collectReportData(child, titles, evidence);
}

export function summarizeTrustSurfaceReport(report: PlaywrightReport, exitCode = 0): TrustSurfaceRunSummary {
  const failures: string[] = [];
  const expected = finiteNonNegativeInteger(report.stats?.expected);
  const skipped = finiteNonNegativeInteger(report.stats?.skipped);
  const unexpected = finiteNonNegativeInteger(report.stats?.unexpected);
  const flaky = finiteNonNegativeInteger(report.stats?.flaky);
  if (expected === undefined) failures.push('report.stats.expected is missing');
  if (skipped === undefined) failures.push('report.stats.skipped is missing');
  if (unexpected === undefined) failures.push('report.stats.unexpected is missing');
  if (flaky === undefined) failures.push('report.stats.flaky is missing');

  const titles: string[] = [];
  const evidence = new Set<string>();
  collectReportData(report.suites, titles, evidence);
  if (!titles.some((title) => title.includes(REQUIRED_TEST_TAG))) {
    failures.push(`required test ${REQUIRED_TEST_TAG} is missing from the report`);
  }
  const foundJourneyEvidence = REQUIRED_LS10_EVIDENCE.filter((item) => evidence.has(item));
  for (const item of REQUIRED_LS10_EVIDENCE) {
    if (!evidence.has(item)) failures.push(`required LS-10 evidence ${item} is missing from the report`);
  }
  if (expected !== 1) failures.push(`expected exactly 1 passed critical test, received ${expected ?? 'unknown'}`);
  if ((skipped ?? 1) !== 0) failures.push(`skipped tests: ${skipped ?? 'unknown'}`);
  if ((unexpected ?? 1) !== 0) failures.push(`unexpected tests: ${unexpected ?? 'unknown'}`);
  if ((flaky ?? 1) !== 0) failures.push(`flaky tests: ${flaky ?? 'unknown'}`);
  if (exitCode !== 0) failures.push(`Playwright exited with status ${exitCode}`);

  return {
    passed: failures.length === 0,
    expected: expected ?? 0,
    skipped: skipped ?? 0,
    unexpected: unexpected ?? 0,
    flaky: flaky ?? 0,
    foundJourneyEvidence,
    failures,
  };
}

function redact(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|api[-_]?key)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/(https?:\/\/[^\s:@]+:)[^@\s]+@/gi, '$1[redacted]@');
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function parseTrustSurfaceArguments(argv: string[]): { outputPath: string } {
  const outputPath = path.join(ROOT, '.release-evidence', 'staging', 'trust-surface.json');
  if (argv.length === 0) return { outputPath };
  if (argv.length === 2 && argv[0] === '--output' && argv[1]) {
    return { outputPath: path.resolve(process.cwd(), argv[1]) };
  }
  throw new Error('usage: npm run e2e:trust-staging -- [--output <staging/trust-surface.json>]');
}

async function main(): Promise<void> {
  const { outputPath } = parseTrustSurfaceArguments(process.argv.slice(2));
  const outputDirectory = path.dirname(outputPath);
  const evidenceRoot = path.basename(outputDirectory) === 'staging' ? path.dirname(outputDirectory) : outputDirectory;
  mkdirSync(outputDirectory, { recursive: true });
  const topology = validateTrustSurfaceTopology(process.env);
  const release = validateReleaseMetadata(process.env);
  const reportPath = path.join(outputDirectory, 'trust-surface-report.json');
  const logPath = path.join(outputDirectory, 'trust-surface.log');
  const playwrightCli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  if (!existsSync(playwrightCli)) throw new Error('Playwright is not installed; run npm ci first');

  const startedMs = Date.now();
  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', 'e2e/trust-surface.spec.ts', '--project=chromium', '--retries=0'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        E2E_BASE_URL: topology.baseURL,
        E2E_API_URL: topology.apiURL,
        E2E_PLATFORM_URL: topology.platformURL,
        E2E_TRUST_SURFACE: '1',
        E2E_TRUST_EVIDENCE: '1',
        E2E_JSON_REPORT_PATH: reportPath,
        E2E_OUTPUT_DIR: path.join(outputDirectory, 'trust-surface-results'),
        CI: '1',
      },
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  const exitCode = result.status ?? 1;
  writeFileSync(
    logPath,
    redact(
      [
        `exitCode=${exitCode}`,
        `origin=${topology.origin}`,
        '',
        'stdout:',
        result.stdout || '',
        '',
        'stderr:',
        result.stderr || '',
      ].join('\n'),
    ),
    'utf8',
  );

  let summary: TrustSurfaceRunSummary;
  if (!existsSync(reportPath)) {
    summary = {
      passed: false,
      expected: 0,
      skipped: 0,
      unexpected: 1,
      flaky: 0,
      foundJourneyEvidence: [],
      failures: ['Playwright JSON report was not produced', `Playwright exited with status ${exitCode}`],
    };
  } else {
    try {
      summary = summarizeTrustSurfaceReport(JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport, exitCode);
    } catch (error) {
      summary = {
        passed: false,
        expected: 0,
        skipped: 0,
        unexpected: 1,
        flaky: 0,
        foundJourneyEvidence: [],
        failures: [`Playwright JSON report is invalid: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  const finishedMs = Math.max(Date.now(), startedMs + 1);
  const artifactPaths = [logPath, ...(existsSync(reportPath) ? [reportPath] : [])];
  const marker = (name: (typeof REQUIRED_LS10_EVIDENCE)[number]) =>
    summary.passed && summary.foundJourneyEvidence.includes(name);
  const evidence = {
    schemaVersion: 1,
    status: summary.passed ? 'passed' : 'failed',
    environment: 'staging',
    evidenceType: 'trust-surface',
    releaseSha: release.releaseSha,
    imageDigests: release.imageDigests,
    migration: release.migration,
    datasetSha256: release.datasetSha256,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    checkedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    topology,
    metrics: {
      completedJourneys: summary.passed ? 1 : 0,
      skippedTests: summary.skipped,
      failedTests: summary.unexpected + (summary.passed ? 0 : 1),
      flakyTests: summary.flaky,
    },
    thresholds: { minCompletedJourneys: 1, maxSkippedTests: 0, maxFailedTests: 0, maxFlakyTests: 0 },
    results: {
      publicPoliciesReachable: marker('public-policy-routes'),
      operatorContactReachable: marker('operator-contact'),
      retentionDeletionPublished: marker('retention-deletion-copy'),
      moderationAppealPublished: marker('moderation-appeal-copy'),
      rightsholderTakedownPublished: marker('rightsholder-takedown-copy'),
      authenticatedPolicyEntryReachable: marker('profile-policy-entry'),
      accountExportVerified: marker('account-export'),
      accountDeletionRehearsed: marker('account-deletion'),
      deletedSessionRevoked: marker('session-revocation'),
      deletedAccountRejected: marker('deleted-account-rejected'),
      zeroConditionalSkips: summary.passed && summary.skipped === 0,
    },
    artifacts: artifactPaths.map((artifactPath) => ({
      path: path.relative(evidenceRoot, artifactPath),
      sha256: sha256File(artifactPath),
    })),
    run: summary,
    ...('provenance' in release
      ? { provenance: release.provenance, source: release.source }
      : { signer: release.signer }),
  };
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`trust surface evidence: ${outputPath}`);
  console.log(`trust surface gate: ${summary.passed ? 'PASSED' : 'FAILED'}`);
  if (!summary.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
