import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const IMAGE_DIGEST_PATTERN = /^\S+@sha256:[a-f0-9]{64}$/i;
const BETA_REQUIRED_RUNS = 1;
const HARDENING_REQUIRED_RUNS = 5;
const AUTH_RATE_LIMIT_COOLDOWN_MS = 65_000;
const REQUIRED_TEST_TAGS = ['@rr05-core', '@rr05-invite'] as const;
const IMAGE_NAMES = ['game', 'api', 'platform', 'migrate', 'retention'] as const;

interface StagingTopology {
  baseURL: string;
  apiURL: string;
  platformURL: string;
  origin: string;
}

interface PlaywrightReport {
  stats?: {
    expected?: unknown;
    skipped?: unknown;
    unexpected?: unknown;
    flaky?: unknown;
  };
  suites?: unknown;
}

export interface PlaywrightRunSummary {
  passed: boolean;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
  foundTags: string[];
  failures: string[];
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function collectSpecTitles(value: unknown, titles: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSpecTitles(item, titles);
    return;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.tests) && typeof record.title === 'string') titles.push(record.title);
  if (Array.isArray(record.suites)) collectSpecTitles(record.suites, titles);
  if (Array.isArray(record.specs)) collectSpecTitles(record.specs, titles);
}

export function summarizePlaywrightReport(report: PlaywrightReport, exitCode = 0): PlaywrightRunSummary {
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
  collectSpecTitles(report.suites, titles);
  const foundTags = REQUIRED_TEST_TAGS.filter((tag) => titles.some((title) => title.includes(tag)));
  for (const tag of REQUIRED_TEST_TAGS) {
    if (!foundTags.includes(tag)) failures.push(`required test ${tag} is missing from the report`);
  }
  if (expected !== REQUIRED_TEST_TAGS.length) {
    failures.push(
      `expected exactly ${REQUIRED_TEST_TAGS.length} passed critical tests, received ${expected ?? 'unknown'}`,
    );
  }
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
    foundTags,
    failures,
  };
}

function validatedUrl(label: string, rawValue: string | undefined, protocol: string): URL {
  if (!rawValue?.trim()) throw new Error(`${label} is required`);
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (url.protocol !== protocol) throw new Error(`${label} must use ${protocol}`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  if (url.search || url.hash) throw new Error(`${label} must not contain a query or fragment`);
  return url;
}

function productionLikeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return false;
  }
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return false;
  const private172 = normalized.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  return normalized.includes('.') && !/^\d+(?:\.\d+){3}$/.test(normalized);
}

export function validateStagingTopology(env: NodeJS.ProcessEnv): StagingTopology {
  const base = validatedUrl('E2E_BASE_URL', env.E2E_BASE_URL, 'https:');
  const api = validatedUrl('E2E_API_URL', env.E2E_API_URL, 'https:');
  const platform = validatedUrl('E2E_PLATFORM_URL', env.E2E_PLATFORM_URL, 'wss:');
  if (!productionLikeHostname(base.hostname)) {
    throw new Error(`E2E_BASE_URL must use a production-like staging hostname, received ${base.hostname}`);
  }
  if (base.origin !== api.origin) {
    throw new Error(`E2E_API_URL must be reverse-proxied through ${base.origin}`);
  }
  const platformHttpOrigin = `https://${platform.host}`;
  if (base.origin !== platformHttpOrigin) {
    throw new Error(`E2E_PLATFORM_URL must be reverse-proxied through ${base.origin}`);
  }
  if (!api.pathname.startsWith('/api')) throw new Error('E2E_API_URL must identify the same-origin /api route');
  return {
    baseURL: base.toString(),
    apiURL: api.toString(),
    platformURL: platform.toString(),
    origin: base.origin,
  };
}

function requiredReleaseMetadata(env: NodeJS.ProcessEnv) {
  if (env.RELEASE_ENVIRONMENT !== 'staging') throw new Error('RELEASE_ENVIRONMENT=staging is required');
  const releaseSha = env.RELEASE_SHA?.trim().toLowerCase() || '';
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) throw new Error('RELEASE_SHA must be a full 40-character commit SHA');
  const imageDigests = Object.fromEntries(
    IMAGE_NAMES.map((name) => {
      const value = env[`${name.toUpperCase()}_IMAGE`]?.trim() || '';
      if (!IMAGE_DIGEST_PATTERN.test(value))
        throw new Error(`${name.toUpperCase()}_IMAGE must be an immutable @sha256 reference`);
      return [name, value];
    }),
  );
  const runId = env.GITHUB_RUN_ID?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  const serverUrl = env.GITHUB_SERVER_URL?.trim();
  if (runId && repository && serverUrl) {
    const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
    if (new URL(runUrl).protocol !== 'https:') throw new Error('GitHub evidence run URL must use HTTPS');
    return { releaseSha, imageDigests, provenance: { runId, repository, runUrl }, source: runUrl };
  }
  const signer = env.E2E_EVIDENCE_SIGNER_URL?.trim();
  if (!signer || new URL(signer).protocol !== 'https:') {
    throw new Error('GitHub Actions provenance or E2E_EVIDENCE_SIGNER_URL=https://... is required');
  }
  return { releaseSha, imageDigests, signer };
}

function redact(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|api[-_]?key)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/(https?:\/\/[^\s:@]+:)[^@\s]+@/gi, '$1[redacted]@');
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function parseEvidenceArguments(argv: string[]): {
  outputPath: string;
  profile: 'beta' | 'production-hardening';
  requiredRuns: number;
} {
  let outputPath = path.join(ROOT, '.release-evidence', 'staging', 'authenticated-e2e.json');
  let profile: 'beta' | 'production-hardening' = 'beta';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--output' && value) {
      outputPath = path.resolve(process.cwd(), value);
      index += 1;
    } else if (argument === '--profile' && (value === 'beta' || value === 'production-hardening')) {
      profile = value;
      index += 1;
    } else {
      throw new Error(
        'usage: npm run e2e:authenticated-staging -- [--profile beta|production-hardening] [--output <staging/authenticated-e2e.json>]',
      );
    }
  }
  return {
    outputPath,
    profile,
    requiredRuns: profile === 'production-hardening' ? HARDENING_REQUIRED_RUNS : BETA_REQUIRED_RUNS,
  };
}

async function main(): Promise<void> {
  const { outputPath, profile, requiredRuns } = parseEvidenceArguments(process.argv.slice(2));
  const outputDirectory = path.dirname(outputPath);
  const evidenceRoot = path.basename(outputDirectory) === 'staging' ? path.dirname(outputDirectory) : outputDirectory;
  mkdirSync(outputDirectory, { recursive: true });

  const topology = validateStagingTopology(process.env);
  const release = requiredReleaseMetadata(process.env);
  const startedMs = Date.now();
  const runRecords: Array<PlaywrightRunSummary & { run: number; reportPath: string; logPath: string }> = [];
  const artifactPaths: string[] = [];
  const playwrightCli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  if (!existsSync(playwrightCli)) throw new Error('Playwright is not installed; run npm ci first');

  for (let run = 1; run <= requiredRuns; run += 1) {
    const reportPath = path.join(outputDirectory, `authenticated-e2e-run-${run}.json`);
    const logPath = path.join(outputDirectory, `authenticated-e2e-run-${run}.log`);
    const result = spawnSync(
      process.execPath,
      [playwrightCli, 'test', 'e2e/authenticated-multiplayer.spec.ts', '--project=chromium', '--retries=0'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          E2E_BASE_URL: topology.baseURL,
          E2E_API_URL: topology.apiURL,
          E2E_PLATFORM_URL: topology.platformURL,
          E2E_AUTHENTICATED_MULTIPLAYER: '1',
          E2E_RANKED_MATCHES_ENABLED: '1',
          E2E_AUTHENTICATED_EVIDENCE: '1',
          E2E_JSON_REPORT_PATH: reportPath,
          E2E_OUTPUT_DIR: path.join(outputDirectory, `authenticated-e2e-run-${run}-results`),
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
          `run=${run}`,
          `exitCode=${exitCode}`,
          `signal=${result.signal ?? ''}`,
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
    artifactPaths.push(logPath);

    let summary: PlaywrightRunSummary;
    if (!existsSync(reportPath)) {
      summary = {
        passed: false,
        expected: 0,
        skipped: 0,
        unexpected: 1,
        flaky: 0,
        foundTags: [],
        failures: ['Playwright JSON report was not produced', `Playwright exited with status ${exitCode}`],
      };
    } else {
      artifactPaths.push(reportPath);
      try {
        summary = summarizePlaywrightReport(JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport, exitCode);
      } catch (error) {
        summary = {
          passed: false,
          expected: 0,
          skipped: 0,
          unexpected: 1,
          flaky: 0,
          foundTags: [],
          failures: [`Playwright JSON report is invalid: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }
    runRecords.push({
      run,
      ...summary,
      reportPath: path.relative(evidenceRoot, reportPath),
      logPath: path.relative(evidenceRoot, logPath),
    });
    if (!summary.passed) break;
    // Each run creates and then logs in four accounts (8 auth requests). The
    // production API limit is 10 auth requests per IP/minute, so crossing the
    // fixed 60-second window preserves the real limiter instead of weakening
    // staging configuration for the evidence job.
    if (run < requiredRuns) await new Promise((resolve) => setTimeout(resolve, AUTH_RATE_LIMIT_COOLDOWN_MS));
  }

  const passedRuns = runRecords.filter((run) => run.passed).length;
  const completedJourneys = runRecords.reduce((total, run) => total + (run.passed ? run.expected : 0), 0);
  const skippedTests = runRecords.reduce((total, run) => total + run.skipped, 0);
  const failedTests = runRecords.reduce((total, run) => total + run.unexpected + (run.passed ? 0 : 1), 0);
  const flakyTests = runRecords.reduce((total, run) => total + run.flaky, 0);
  const passed = passedRuns === requiredRuns && runRecords.length === requiredRuns;
  const finishedMs = Math.max(Date.now(), startedMs + 1);
  const artifacts = artifactPaths.map((artifactPath) => ({
    path: path.relative(evidenceRoot, artifactPath),
    sha256: sha256File(artifactPath),
  }));
  const evidence = {
    schemaVersion: 1,
    status: passed ? 'passed' : 'failed',
    environment: 'staging',
    profile,
    evidenceType: 'authenticated-e2e',
    releaseSha: release.releaseSha,
    imageDigests: release.imageDigests,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    checkedAt: new Date(finishedMs).toISOString(),
    topology,
    metrics: {
      completedJourneys,
      consecutiveRuns: passedRuns,
      skippedTests,
      failedTests,
      flakyTests,
    },
    thresholds: {
      minCompletedJourneys: requiredRuns * REQUIRED_TEST_TAGS.length,
      requiredConsecutiveRuns: requiredRuns,
      maxSkippedTests: 0,
      maxFailedTests: 0,
      maxFlakyTests: 0,
    },
    results: {
      authenticatedJourneyPassed: passed,
      historyVerified: passed,
      friendInviteVerified: passed,
      spectatorHiddenInformationVerified: passed,
      secureCookieVerified: passed,
      httpsTopologyVerified: true,
      zeroConditionalSkips: passed && skippedTests === 0,
    },
    artifacts,
    runs: runRecords,
    ...('provenance' in release
      ? { provenance: release.provenance, source: release.source }
      : { signer: release.signer }),
  };
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`authenticated multiplayer evidence: ${outputPath}`);
  console.log(`authenticated multiplayer gate: ${passed ? 'PASSED' : 'FAILED'} (${passedRuns}/${requiredRuns} runs)`);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
