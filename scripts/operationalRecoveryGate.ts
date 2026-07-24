import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const IMAGE_DIGEST_PATTERN = /^\S+@sha256:[a-f0-9]{64}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REQUIRED_ALERT_SCENARIOS = [
  'api-failure',
  'platform-failure',
  'reconnect-spike',
  'database-outage',
  'resource-pressure',
  'outbox-backlog',
] as const;
const IMAGE_NAMES = ['game', 'api', 'platform', 'migrate', 'retention'] as const;

interface RestoreReport {
  schemaVersion?: unknown;
  status?: unknown;
  environment?: unknown;
  releaseSha?: unknown;
  backup?: { artifact?: unknown; sha256?: unknown; completedAt?: unknown };
  incidentAt?: unknown;
  restore?: { startedAt?: unknown; finishedAt?: unknown; imageDigest?: unknown };
  fixtures?: { account?: unknown; deck?: unknown; matchHistory?: unknown; leaderboard?: unknown };
  checks?: { schemaGatePassed?: unknown; legalHoldInvariantPassed?: unknown };
}

interface DeploymentRecoveryReport {
  schemaVersion?: unknown;
  status?: unknown;
  environment?: unknown;
  releaseSha?: unknown;
  targetSha?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  checks?: {
    sourceCheckoutVerified?: unknown;
    schemaCompatible?: unknown;
    healthReady?: unknown;
    smokePassed?: unknown;
  };
}

interface AlertScenarioReceipt {
  scenario?: unknown;
  firingInjectedAt?: unknown;
  firingReceivedAt?: unknown;
  resolvedInjectedAt?: unknown;
  resolvedReceivedAt?: unknown;
  recipient?: unknown;
  receiptUrl?: unknown;
}

interface AlertDeliveryReceipt {
  schemaVersion?: unknown;
  status?: unknown;
  environment?: unknown;
  releaseSha?: unknown;
  alertmanagerUrl?: unknown;
  scenarios?: unknown;
}

export interface OperationalThresholds {
  maxRpoMinutes: number;
  maxRtoMinutes: number;
  maxDeploymentRecoverySeconds: number;
  maxAlertDeliverySeconds: number;
}

function isoMs(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO timestamp`);
  }
  return parsed;
}

function httpsUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an HTTPS URL`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error(`${label} must be an HTTPS URL`);
  return value;
}

function assertBaseReport(
  report: { schemaVersion?: unknown; status?: unknown; environment?: unknown; releaseSha?: unknown },
  releaseSha: string,
  label: string,
): void {
  if (report.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if (report.status !== 'passed') throw new Error(`${label}.status must be passed`);
  if (report.environment !== 'staging') throw new Error(`${label}.environment must be staging`);
  if (report.releaseSha !== releaseSha) throw new Error(`${label}.releaseSha must match ${releaseSha}`);
}

export function evaluateRestore(restore: RestoreReport, releaseSha: string, thresholds: OperationalThresholds) {
  assertBaseReport(restore, releaseSha, 'restore');
  if (!restore.backup || typeof restore.backup.artifact !== 'string' || !restore.backup.artifact.trim()) {
    throw new Error('restore.backup.artifact is required');
  }
  if (!SHA256_PATTERN.test(String(restore.backup.sha256 ?? ''))) throw new Error('restore.backup.sha256 is invalid');
  if (!IMAGE_DIGEST_PATTERN.test(String(restore.restore?.imageDigest ?? ''))) {
    throw new Error('restore.restore.imageDigest must be immutable');
  }
  const backupCompletedAt = isoMs(restore.backup.completedAt, 'restore.backup.completedAt');
  const incidentAt = isoMs(restore.incidentAt, 'restore.incidentAt');
  const restoreStartedAt = isoMs(restore.restore?.startedAt, 'restore.restore.startedAt');
  const restoreFinishedAt = isoMs(restore.restore?.finishedAt, 'restore.restore.finishedAt');
  if (incidentAt < backupCompletedAt) throw new Error('restore.incidentAt must not predate the backup');
  if (restoreStartedAt < incidentAt) throw new Error('restore.restore.startedAt must not predate the incident');
  if (restoreFinishedAt <= restoreStartedAt) throw new Error('restore.restore.finishedAt must follow startedAt');
  const fixtureRoundTripPassed =
    restore.fixtures?.account === true &&
    restore.fixtures.deck === true &&
    restore.fixtures.matchHistory === true &&
    restore.fixtures.leaderboard === true;
  if (!fixtureRoundTripPassed)
    throw new Error('restore must verify account, deck, matchHistory, and leaderboard fixtures');
  if (restore.checks?.schemaGatePassed !== true) throw new Error('restore schema gate did not pass');
  if (restore.checks?.legalHoldInvariantPassed !== true) throw new Error('restore legal-hold invariant did not pass');

  const rpoMinutes = (incidentAt - backupCompletedAt) / 60_000;
  const rtoMinutes = (restoreFinishedAt - restoreStartedAt) / 60_000;
  return {
    metrics: { rpoMinutes, rtoMinutes },
    results: {
      schemaGatePassed: true,
      fixtureRoundTripPassed,
      legalHoldInvariantPassed: true,
    },
    passed: rpoMinutes <= thresholds.maxRpoMinutes && rtoMinutes <= thresholds.maxRtoMinutes,
  };
}

export function evaluateRestoreAndDeployment(
  restore: RestoreReport,
  deployment: DeploymentRecoveryReport,
  releaseSha: string,
  thresholds: OperationalThresholds,
) {
  const restoreResult = evaluateRestore(restore, releaseSha, thresholds);
  assertBaseReport(deployment, releaseSha, 'deployment');
  if (!RELEASE_SHA_PATTERN.test(String(deployment.targetSha ?? '')) || deployment.targetSha !== releaseSha) {
    throw new Error('deployment.targetSha must match the release candidate');
  }
  const deploymentStartedAt = isoMs(deployment.startedAt, 'deployment.startedAt');
  const deploymentFinishedAt = isoMs(deployment.finishedAt, 'deployment.finishedAt');
  if (deploymentFinishedAt <= deploymentStartedAt) throw new Error('deployment.finishedAt must follow startedAt');
  const deploymentRecoveryPassed =
    deployment.checks?.sourceCheckoutVerified === true &&
    deployment.checks.schemaCompatible === true &&
    deployment.checks.healthReady === true &&
    deployment.checks.smokePassed === true;
  if (!deploymentRecoveryPassed) throw new Error('deployment recovery checks did not all pass');
  const deploymentRecoverySeconds = (deploymentFinishedAt - deploymentStartedAt) / 1_000;
  return {
    metrics: { ...restoreResult.metrics, deploymentRecoverySeconds },
    results: { ...restoreResult.results, deploymentRecoveryPassed },
    passed: restoreResult.passed && deploymentRecoverySeconds <= thresholds.maxDeploymentRecoverySeconds,
  };
}

export function evaluateAlertDelivery(
  receipt: AlertDeliveryReceipt,
  releaseSha: string,
  thresholds: OperationalThresholds,
) {
  assertBaseReport(receipt, releaseSha, 'alerts');
  httpsUrl(receipt.alertmanagerUrl, 'alerts.alertmanagerUrl');
  if (!Array.isArray(receipt.scenarios)) throw new Error('alerts.scenarios must be an array');
  const scenarios = receipt.scenarios as AlertScenarioReceipt[];
  const byScenario = new Map(scenarios.map((entry) => [entry.scenario, entry]));
  const firingLatencies: number[] = [];
  const resolvedLatencies: number[] = [];
  const results: Record<string, true> = {};
  for (const scenario of REQUIRED_ALERT_SCENARIOS) {
    const entry = byScenario.get(scenario);
    if (!entry) throw new Error(`missing alert delivery scenario: ${scenario}`);
    if (typeof entry.recipient !== 'string' || !entry.recipient.trim()) {
      throw new Error(`${scenario}.recipient is required`);
    }
    httpsUrl(entry.receiptUrl, `${scenario}.receiptUrl`);
    const firingInjectedAt = isoMs(entry.firingInjectedAt, `${scenario}.firingInjectedAt`);
    const firingReceivedAt = isoMs(entry.firingReceivedAt, `${scenario}.firingReceivedAt`);
    const resolvedInjectedAt = isoMs(entry.resolvedInjectedAt, `${scenario}.resolvedInjectedAt`);
    const resolvedReceivedAt = isoMs(entry.resolvedReceivedAt, `${scenario}.resolvedReceivedAt`);
    if (firingReceivedAt < firingInjectedAt) throw new Error(`${scenario} firing receipt predates injection`);
    if (resolvedInjectedAt < firingReceivedAt) throw new Error(`${scenario} resolution predates firing receipt`);
    if (resolvedReceivedAt < resolvedInjectedAt) throw new Error(`${scenario} resolved receipt predates injection`);
    firingLatencies.push((firingReceivedAt - firingInjectedAt) / 1_000);
    resolvedLatencies.push((resolvedReceivedAt - resolvedInjectedAt) / 1_000);
    results[
      (
        {
          'api-failure': 'apiFailureDelivered',
          'platform-failure': 'platformFailureDelivered',
          'reconnect-spike': 'reconnectSpikeDelivered',
          'database-outage': 'databaseOutageDelivered',
          'resource-pressure': 'resourcePressureDelivered',
          'outbox-backlog': 'outboxBacklogDelivered',
        } as const
      )[scenario]
    ] = true;
  }
  const firingDeliverySeconds = Math.max(...firingLatencies);
  const resolvedDeliverySeconds = Math.max(...resolvedLatencies);
  return {
    metrics: {
      firingDeliverySeconds,
      resolvedDeliverySeconds,
      scenariosDelivered: REQUIRED_ALERT_SCENARIOS.length,
      failedScenarios: 0,
    },
    results: { firingDelivered: true, resolvedDelivered: true, ...results },
    passed:
      firingDeliverySeconds <= thresholds.maxAlertDeliverySeconds &&
      resolvedDeliverySeconds <= thresholds.maxAlertDeliverySeconds,
  };
}

function releaseMetadata(env: NodeJS.ProcessEnv) {
  if (env.RELEASE_ENVIRONMENT !== 'staging') throw new Error('RELEASE_ENVIRONMENT=staging is required');
  const releaseSha = env.RELEASE_SHA?.trim().toLowerCase() || '';
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) throw new Error('RELEASE_SHA must be a full commit SHA');
  const imageDigests = Object.fromEntries(
    IMAGE_NAMES.map((name) => {
      const value = env[`${name.toUpperCase()}_IMAGE`]?.trim() || '';
      if (!IMAGE_DIGEST_PATTERN.test(value)) throw new Error(`${name.toUpperCase()}_IMAGE must be immutable`);
      return [name, value];
    }),
  );
  const runId = env.GITHUB_RUN_ID?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  const serverUrl = env.GITHUB_SERVER_URL?.trim();
  if (runId && repository && serverUrl) {
    const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
    httpsUrl(runUrl, 'provenance.runUrl');
    return { releaseSha, imageDigests, provenance: { runId, repository, runUrl }, source: runUrl };
  }
  const signer = httpsUrl(env.OPERATIONAL_EVIDENCE_SIGNER_URL, 'OPERATIONAL_EVIDENCE_SIGNER_URL');
  return { releaseSha, imageDigests, signer };
}

function numericEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !['--profile', '--restore-report', '--deployment-report', '--alert-receipt', '--output-dir'].includes(key) ||
      !value
    ) {
      throw new Error(
        'usage: npm run release:operational-evidence -- [--profile beta|production-hardening] --restore-report <json> [--deployment-report <json> --alert-receipt <json>] --output-dir <dir>',
      );
    }
    values.set(key, value);
  }
  for (const key of ['--restore-report', '--output-dir']) {
    if (!values.has(key)) throw new Error(`${key} is required`);
  }
  const profile = values.get('--profile') ?? 'beta';
  if (profile !== 'beta' && profile !== 'production-hardening') {
    throw new Error('--profile must be beta or production-hardening');
  }
  if (profile === 'production-hardening') {
    for (const key of ['--deployment-report', '--alert-receipt']) {
      if (!values.has(key)) throw new Error(`${key} is required for production-hardening`);
    }
  }
  return {
    profile,
    restorePath: path.resolve(process.cwd(), values.get('--restore-report')!),
    deploymentPath: values.has('--deployment-report')
      ? path.resolve(process.cwd(), values.get('--deployment-report')!)
      : undefined,
    alertPath: values.has('--alert-receipt') ? path.resolve(process.cwd(), values.get('--alert-receipt')!) : undefined,
    outputDir: path.resolve(process.cwd(), values.get('--output-dir')!),
  };
}

function artifact(root: string, filePath: string) {
  return {
    path: path.relative(root, filePath),
    sha256: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = releaseMetadata(process.env);
  const thresholds: OperationalThresholds = {
    maxRpoMinutes: numericEnv('MAX_RPO_MINUTES', 15),
    maxRtoMinutes: numericEnv('MAX_RTO_MINUTES', 30),
    maxDeploymentRecoverySeconds: numericEnv('MAX_DEPLOYMENT_RECOVERY_SECONDS', 1_800),
    maxAlertDeliverySeconds: numericEnv('MAX_ALERT_DELIVERY_SECONDS', 300),
  };
  const restore = JSON.parse(readFileSync(args.restorePath, 'utf8')) as RestoreReport;
  const deployment = args.deploymentPath
    ? (JSON.parse(readFileSync(args.deploymentPath, 'utf8')) as DeploymentRecoveryReport)
    : undefined;
  const alerts = args.alertPath
    ? (JSON.parse(readFileSync(args.alertPath, 'utf8')) as AlertDeliveryReceipt)
    : undefined;
  const restoreResult = deployment
    ? evaluateRestoreAndDeployment(restore, deployment, release.releaseSha, thresholds)
    : evaluateRestore(restore, release.releaseSha, thresholds);
  const alertResult = alerts ? evaluateAlertDelivery(alerts, release.releaseSha, thresholds) : undefined;
  const startedAt = new Date(
    Math.min(
      isoMs(restore.restore?.startedAt, 'restore.restore.startedAt'),
      ...(deployment ? [isoMs(deployment.startedAt, 'deployment.startedAt')] : []),
    ),
  );
  const finishedAt = new Date(
    Math.max(
      isoMs(restore.restore?.finishedAt, 'restore.restore.finishedAt'),
      ...(deployment ? [isoMs(deployment.finishedAt, 'deployment.finishedAt')] : []),
      ...(alerts
        ? (alerts.scenarios as AlertScenarioReceipt[]).map((entry) =>
            isoMs(entry.resolvedReceivedAt, 'resolvedReceivedAt'),
          )
        : []),
    ),
  );
  const evidenceRoot = path.basename(args.outputDir) === 'staging' ? path.dirname(args.outputDir) : args.outputDir;
  mkdirSync(args.outputDir, { recursive: true });
  const archivedRestorePath = path.join(args.outputDir, 'restore-drill-raw.json');
  copyFileSync(args.restorePath, archivedRestorePath);
  const archivedDeploymentPath = args.deploymentPath
    ? path.join(args.outputDir, 'deployment-recovery-raw.json')
    : undefined;
  const archivedAlertPath = args.alertPath ? path.join(args.outputDir, 'alert-delivery-receipt-raw.json') : undefined;
  if (args.deploymentPath && archivedDeploymentPath) copyFileSync(args.deploymentPath, archivedDeploymentPath);
  if (args.alertPath && archivedAlertPath) copyFileSync(args.alertPath, archivedAlertPath);
  const common = {
    schemaVersion: 1,
    environment: 'staging',
    profile: args.profile,
    releaseSha: release.releaseSha,
    imageDigests: release.imageDigests,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    checkedAt: finishedAt.toISOString(),
    ...('provenance' in release
      ? { provenance: release.provenance, source: release.source }
      : { signer: release.signer }),
  };
  const restoreEvidence = {
    ...common,
    status: restoreResult.passed ? 'passed' : 'failed',
    evidenceType: 'restore-drill',
    metrics: restoreResult.metrics,
    thresholds: {
      maxRpoMinutes: thresholds.maxRpoMinutes,
      maxRtoMinutes: thresholds.maxRtoMinutes,
      ...(deployment ? { maxDeploymentRecoverySeconds: thresholds.maxDeploymentRecoverySeconds } : {}),
    },
    results: restoreResult.results,
    artifacts: [
      artifact(evidenceRoot, archivedRestorePath),
      ...(archivedDeploymentPath ? [artifact(evidenceRoot, archivedDeploymentPath)] : []),
    ],
  };
  const alertEvidence =
    alertResult && archivedAlertPath
      ? {
          ...common,
          status: alertResult.passed ? 'passed' : 'failed',
          evidenceType: 'alertmanager-delivery',
          metrics: alertResult.metrics,
          thresholds: {
            maxFiringDeliverySeconds: thresholds.maxAlertDeliverySeconds,
            maxResolvedDeliverySeconds: thresholds.maxAlertDeliverySeconds,
            minScenariosDelivered: REQUIRED_ALERT_SCENARIOS.length,
            maxFailedScenarios: 0,
          },
          results: alertResult.results,
          artifacts: [artifact(evidenceRoot, archivedAlertPath)],
        }
      : undefined;
  writeFileSync(path.join(args.outputDir, 'restore-drill.json'), `${JSON.stringify(restoreEvidence, null, 2)}\n`);
  if (alertEvidence) {
    writeFileSync(
      path.join(args.outputDir, 'alertmanager-delivery.json'),
      `${JSON.stringify(alertEvidence, null, 2)}\n`,
    );
  }
  if (!restoreResult.passed || (alertResult && !alertResult.passed)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
