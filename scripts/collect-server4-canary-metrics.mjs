import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export const SERVER4_CANARY_POLICY = Object.freeze({
  requiredStages: 3,
  stageWeights: Object.freeze([10, 50, 100]),
  maxRollbackSeconds: 300,
  maxRollbackObservationDelaySeconds: 60,
  maxRollbackObservationSeconds: 600,
  minStageDwellSeconds: 300,
  minHttpSamplesPerStage: 1_000,
  minWebsocketSamplesPerStage: 100,
  minReadyReplicaCount: 2,
});

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  values.push(value);
  return values;
}

export function parseHaProxyStatsCsv(contents) {
  if (typeof contents !== 'string' || !contents.trim()) throw new Error('HAProxy stats CSV must not be empty');
  const lines = contents.split(/\r?\n/).filter(Boolean);
  const headerLine = lines.find((line) => line.startsWith('#'));
  if (!headerLine) throw new Error('HAProxy stats CSV is missing its header');
  const headers = parseCsvLine(headerLine.replace(/^#\s*/, ''));
  return lines
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
}

function metricInteger(value, label) {
  if (!/^\d+$/.test(String(value ?? ''))) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function frontendCounters(rows) {
  const frontend = rows.find((row) => row.pxname === 'zutomayo_gateway' && row.svname === 'FRONTEND');
  if (!frontend) throw new Error('HAProxy stats are missing zutomayo_gateway FRONTEND');
  return {
    totalSessions: metricInteger(frontend.stot, 'frontend stot'),
    websocketUpgrades: metricInteger(frontend.hrsp_1xx || '0', 'frontend hrsp_1xx'),
  };
}

function slotTrafficCounters(rows, slot) {
  const backendNames = [
    `be_game_${slot}`,
    `be_api_${slot}`,
    `be_platform_${slot}`,
    `be_platform_${slot}_p1`,
    `be_platform_${slot}_p2`,
  ];
  const counters = backendNames.map((backend) => {
    const row = rows.find((candidate) => candidate.pxname === backend && candidate.svname === 'BACKEND');
    if (!row) throw new Error(`HAProxy stats are missing ${backend} BACKEND`);
    return {
      totalSessions: metricInteger(row.stot, `${backend} stot`),
      websocketUpgrades: metricInteger(row.hrsp_1xx || '0', `${backend} hrsp_1xx`),
    };
  });
  return counters.reduce(
    (total, counter) => ({
      totalSessions: total.totalSessions + counter.totalSessions,
      websocketUpgrades: total.websocketUpgrades + counter.websocketUpgrades,
    }),
    { totalSessions: 0, websocketUpgrades: 0 },
  );
}

function readyReplicaCount(rows, slot) {
  const backendNames = [`be_game_${slot}`, `be_api_${slot}`, `be_platform_${slot}`];
  const counts = backendNames.map(
    (backend) =>
      rows.filter((row) => row.pxname === backend && row.svname !== 'BACKEND' && /^UP(?:\s|$)/.test(row.status || ''))
        .length,
  );
  return Math.min(...counts);
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function rollbackDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== 'string' || typeof finishedAt !== 'string') {
    throw new Error('rollback metrics require rollbackStartedAt and rollbackFinishedAt ISO timestamps');
  }
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    throw new Error('rollbackStartedAt and rollbackFinishedAt must be ISO timestamps');
  }
  if (finished <= started) throw new Error('rollbackFinishedAt must be after rollbackStartedAt');
  return (finished - started) / 1_000;
}

function observationDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== 'string' || typeof finishedAt !== 'string') {
    throw new Error('rollout policy requires observationStartedAt and observationFinishedAt ISO timestamps');
  }
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    throw new Error('observationStartedAt and observationFinishedAt must be ISO timestamps');
  }
  if (finished <= started) throw new Error('observationFinishedAt must be after observationStartedAt');
  return (finished - started) / 1_000;
}

export function collectServer4CanaryMetrics({
  gatewayArtifact,
  activeConfigMarker,
  startStatsCsv,
  endStatsCsv,
  rollbackStartedAt,
  rollbackFinishedAt,
  observationStartedAt,
  observationFinishedAt,
}) {
  const gateway = plainObject(gatewayArtifact, 'gatewayArtifact');
  if (gateway.schemaVersion !== 1 || gateway.artifactType !== 'zutomayo-canary-gateway-config') {
    throw new Error('gatewayArtifact must be a schemaVersion 1 canary gateway config');
  }
  if (gateway.phase !== 'rollout' && gateway.phase !== 'rollback') {
    throw new Error('gatewayArtifact.phase must be rollout or rollback');
  }
  if (!Number.isInteger(gateway.sequence) || gateway.sequence < 1 || gateway.sequence > 4) {
    throw new Error('gatewayArtifact.sequence must be between 1 and 4');
  }
  const traffic = plainObject(gateway.traffic, 'gatewayArtifact.traffic');
  const gatewayRuntime = plainObject(gateway.gateway, 'gatewayArtifact.gateway');
  if (String(activeConfigMarker).trim() !== gatewayRuntime.activeConfigId) {
    throw new Error('active config marker does not match gatewayArtifact.gateway.activeConfigId');
  }
  const startRows = parseHaProxyStatsCsv(startStatsCsv);
  const endRows = parseHaProxyStatsCsv(endStatsCsv);
  const startFrontend = frontendCounters(startRows);
  const endFrontend = frontendCounters(endRows);
  const observedSlot = gateway.phase === 'rollback' ? gatewayRuntime.stableSlot : gatewayRuntime.candidateSlot;
  if (observedSlot !== 'blue' && observedSlot !== 'green') throw new Error('gateway artifact contains an invalid slot');
  const start = slotTrafficCounters(startRows, observedSlot);
  const end = slotTrafficCounters(endRows, observedSlot);
  const httpSamples = end.totalSessions - start.totalSessions;
  const websocketSamples = end.websocketUpgrades - start.websocketUpgrades;
  if (httpSamples < 0 || websocketSamples < 0) {
    throw new Error('HAProxy counters moved backwards; the gateway reloaded during the observation interval');
  }
  const serializedGateway = `${JSON.stringify(gateway, null, 2)}\n`;
  const gatewayConfigSha256 = sha256(serializedGateway);
  if (!SHA256_PATTERN.test(gatewayConfigSha256)) throw new Error('could not hash gateway artifact');

  const metrics = {
    schemaVersion: 1,
    artifactType: 'zutomayo-canary-raw-metrics',
    phase: gateway.phase,
    sequence: gateway.sequence,
    stableWeightPercent: traffic.stableWeightPercent,
    candidateWeightPercent: traffic.candidateWeightPercent,
    httpSamples,
    websocketSamples,
    readyReplicaCount: readyReplicaCount(endRows, observedSlot),
    gatewayConfigSha256,
    source: {
      implementation: 'haproxy-stats-csv-delta',
      activeConfigId: gatewayRuntime.activeConfigId,
      observedSlot,
      startStatsSha256: sha256(startStatsCsv),
      endStatsSha256: sha256(endStatsCsv),
      startCounters: start,
      endCounters: end,
      gatewayFrontendStartCounters: startFrontend,
      gatewayFrontendEndCounters: endFrontend,
    },
  };
  if (gateway.phase === 'rollback') {
    metrics.rollbackSeconds = rollbackDurationSeconds(rollbackStartedAt, rollbackFinishedAt);
    metrics.observation = {
      startedAt: observationStartedAt,
      finishedAt: observationFinishedAt,
      dwellSeconds: observationDurationSeconds(observationStartedAt, observationFinishedAt),
    };
  } else if (rollbackStartedAt !== undefined || rollbackFinishedAt !== undefined) {
    throw new Error('rollback timestamps are only valid for rollback metrics');
  }
  return metrics;
}

export function verifyServer4CanaryStage({ observationStartedAt, observationFinishedAt, ...input }) {
  const metrics = collectServer4CanaryMetrics(input);
  const stageIndex = SERVER4_CANARY_POLICY.stageWeights.indexOf(metrics.candidateWeightPercent);
  if (metrics.phase !== 'rollout' || stageIndex === -1) {
    throw new Error('rollout policy can only verify a 10%, 50%, or 100% rollout stage');
  }
  if (metrics.sequence !== stageIndex + 1 || metrics.stableWeightPercent !== 100 - metrics.candidateWeightPercent) {
    throw new Error('rollout policy requires the canonical stage sequence and stable/candidate weights');
  }
  const dwellSeconds = observationDurationSeconds(observationStartedAt, observationFinishedAt);
  const failures = [];
  if (dwellSeconds < SERVER4_CANARY_POLICY.minStageDwellSeconds) {
    failures.push(`dwell ${dwellSeconds}s < ${SERVER4_CANARY_POLICY.minStageDwellSeconds}s`);
  }
  if (metrics.httpSamples < SERVER4_CANARY_POLICY.minHttpSamplesPerStage) {
    failures.push(`HTTP samples ${metrics.httpSamples} < ${SERVER4_CANARY_POLICY.minHttpSamplesPerStage}`);
  }
  if (metrics.websocketSamples < SERVER4_CANARY_POLICY.minWebsocketSamplesPerStage) {
    failures.push(
      `WebSocket samples ${metrics.websocketSamples} < ${SERVER4_CANARY_POLICY.minWebsocketSamplesPerStage}`,
    );
  }
  if (metrics.readyReplicaCount < SERVER4_CANARY_POLICY.minReadyReplicaCount) {
    failures.push(`ready replicas ${metrics.readyReplicaCount} < ${SERVER4_CANARY_POLICY.minReadyReplicaCount}`);
  }
  if (failures.length > 0) throw new Error(`canary stage policy failed: ${failures.join('; ')}`);
  return {
    ...metrics,
    observation: {
      startedAt: observationStartedAt,
      finishedAt: observationFinishedAt,
      dwellSeconds,
    },
    policy: SERVER4_CANARY_POLICY,
    policyPassed: true,
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (argument === '--enforce-rollout-policy') {
      options.enforceRolloutPolicy = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--gateway-artifact') options.gatewayArtifact = path.resolve(process.cwd(), value);
    else if (argument === '--active-marker') options.activeMarker = path.resolve(process.cwd(), value);
    else if (argument === '--start-stats') options.startStats = path.resolve(process.cwd(), value);
    else if (argument === '--end-stats') options.endStats = path.resolve(process.cwd(), value);
    else if (argument === '--output') options.output = path.resolve(process.cwd(), value);
    else if (argument === '--rollback-started-at') options.rollbackStartedAt = value;
    else if (argument === '--rollback-finished-at') options.rollbackFinishedAt = value;
    else if (argument === '--observation-started-at-file') {
      options.observationStartedAtFile = path.resolve(process.cwd(), value);
    } else if (argument === '--observation-finished-at-file') {
      options.observationFinishedAtFile = path.resolve(process.cwd(), value);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  for (const name of ['gatewayArtifact', 'activeMarker', 'startStats', 'endStats', 'output']) {
    if (!options[name])
      throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (options.enforceRolloutPolicy && (!options.observationStartedAtFile || !options.observationFinishedAtFile)) {
    throw new Error(
      '--enforce-rollout-policy requires --observation-started-at-file and --observation-finished-at-file',
    );
  }
  if (Boolean(options.observationStartedAtFile) !== Boolean(options.observationFinishedAtFile)) {
    throw new Error('--observation-started-at-file and --observation-finished-at-file must be provided together');
  }
  return options;
}

function usage() {
  return 'Usage: node scripts/collect-server4-canary-metrics.mjs --gateway-artifact FILE --active-marker FILE --start-stats FILE --end-stats FILE --output FILE [--rollback-started-at ISO --rollback-finished-at ISO] [--enforce-rollout-policy --observation-started-at-file FILE --observation-finished-at-file FILE]';
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const gatewayArtifactContents = readFileSync(options.gatewayArtifact, 'utf8');
  const input = {
    gatewayArtifact: JSON.parse(gatewayArtifactContents),
    activeConfigMarker: readFileSync(options.activeMarker, 'utf8'),
    startStatsCsv: readFileSync(options.startStats, 'utf8'),
    endStatsCsv: readFileSync(options.endStats, 'utf8'),
    rollbackStartedAt: options.rollbackStartedAt,
    rollbackFinishedAt: options.rollbackFinishedAt,
    observationStartedAt: options.observationStartedAtFile
      ? readFileSync(options.observationStartedAtFile, 'utf8').trim()
      : undefined,
    observationFinishedAt: options.observationFinishedAtFile
      ? readFileSync(options.observationFinishedAtFile, 'utf8').trim()
      : undefined,
  };
  const artifact = options.enforceRolloutPolicy
    ? verifyServer4CanaryStage({
        ...input,
        observationStartedAt: input.observationStartedAt,
        observationFinishedAt: input.observationFinishedAt,
      })
    : collectServer4CanaryMetrics(input);
  // Hash the exact on-disk artifact bytes expected by release-gate rather than
  // relying on JSON key ordering chosen by an upstream producer.
  artifact.gatewayConfigSha256 = sha256(gatewayArtifactContents);
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  process.stdout.write(`${JSON.stringify(artifact)}\n`);
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `server4 canary metrics collection failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
