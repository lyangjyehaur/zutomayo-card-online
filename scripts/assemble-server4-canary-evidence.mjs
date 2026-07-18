import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVER4_CANARY_POLICY } from './collect-server4-canary-metrics.mjs';
import { inspectStagingGates } from './release-gate.mjs';
import { parseGatewayReleaseManifest } from './render-server4-gateway.mjs';

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const RUN_ID_PATTERN = /^\d+$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PREFIX_PATTERN = /^gateway-([a-f0-9]{12})-(0|10|50|100)-\d{8}T\d{6}Z-\d+-\d+$/;
const RUNTIME_SERVICES = Object.freeze(['game', 'api', 'platform']);
const IMAGE_MANIFEST_KEYS = Object.freeze({
  game: 'GAME_IMAGE',
  api: 'API_IMAGE',
  platform: 'PLATFORM_IMAGE',
  migrate: 'MIGRATE_IMAGE',
  retention: 'RETENTION_IMAGE',
  gateway: 'GATEWAY_IMAGE',
  ops: 'OPS_IMAGE',
});

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function ensureContained(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} must stay inside ${root}`);
  }
}

function readRegularFile(file, label) {
  let metadata;
  try {
    metadata = lstatSync(file);
  } catch {
    fail(`${label} is missing: ${file}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`${label} must be a regular non-symlink file: ${file}`);
  return readFileSync(file);
}

function evidenceSource(evidenceRoot, prefix, suffix, label) {
  const source = path.resolve(evidenceRoot, `${prefix}.${suffix}`);
  ensureContained(evidenceRoot, source, label);
  const contents = readRegularFile(source, label);
  const realSource = realpathSync(source);
  ensureContained(evidenceRoot, realSource, label);
  return { contents, source };
}

function parseJson(contents, label) {
  let value;
  try {
    value = JSON.parse(contents.toString('utf8'));
  } catch (error) {
    fail(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isPlainObject(value)) fail(`${label} must contain a JSON object`);
  return value;
}

function parseTimestamp(contents, label) {
  const text = contents.toString('utf8');
  const value = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (!value || (text !== value && text !== `${value}\n`) || /\s/.test(value)) {
    fail(`${label} must contain exactly one ISO timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(`${label} must contain a canonical ISO timestamp`);
  }
  return { value, milliseconds };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} must be exactly ${JSON.stringify(expected)}`);
}

function assertReleaseSet(actual, expected, label) {
  if (!isPlainObject(actual)) fail(`${label} must be an object`);
  const keys = Object.keys(actual).sort();
  if (
    keys.length !== RUNTIME_SERVICES.length ||
    keys.some((key, index) => key !== [...RUNTIME_SERVICES].sort()[index])
  ) {
    fail(`${label} must contain exactly game, api, and platform`);
  }
  for (const service of RUNTIME_SERVICES) {
    if (typeof actual[service] !== 'string' || actual[service].toLowerCase() !== expected[service].toLowerCase()) {
      fail(`${label}.${service} does not match the release manifest`);
    }
  }
}

function imageRepository(reference) {
  return reference.slice(0, reference.toLowerCase().lastIndexOf('@sha256:'));
}

function validateManifestPair(stable, candidate) {
  if (!RELEASE_SHA_PATTERN.test(stable.RELEASE_SHA) || !RELEASE_SHA_PATTERN.test(candidate.RELEASE_SHA)) {
    fail('release manifests must contain full release SHAs');
  }
  if (stable.RELEASE_SHA.toLowerCase() === candidate.RELEASE_SHA.toLowerCase()) {
    fail('stable and candidate manifests must identify different releases');
  }
  for (const service of RUNTIME_SERVICES) {
    const key = IMAGE_MANIFEST_KEYS[service];
    if (stable[key].toLowerCase() === candidate[key].toLowerCase()) {
      fail(`stable and candidate ${service} image digests must differ`);
    }
    if (imageRepository(stable[key]).toLowerCase() !== imageRepository(candidate[key]).toLowerCase()) {
      fail(`stable and candidate ${service} images must use the same repository`);
    }
  }
}

function validatePrefix(prefix, expectedWeight, candidateReleaseSha) {
  if (typeof prefix !== 'string' || prefix.includes('/') || prefix.includes('\\')) {
    fail(`stage ${expectedWeight} prefix must be a basename`);
  }
  const match = prefix.match(PREFIX_PATTERN);
  if (!match) fail(`stage ${expectedWeight} prefix is not a canonical controller evidence prefix`);
  if (match[1].toLowerCase() !== candidateReleaseSha.slice(0, 12).toLowerCase()) {
    fail(`stage ${expectedWeight} prefix does not match the candidate release SHA`);
  }
  if (Number(match[2]) !== expectedWeight) fail(`stage ${expectedWeight} prefix contains the wrong traffic weight`);
}

function validateGatewayArtifact(artifact, expected, stableReleaseSet, candidateReleaseSet, candidateReleaseSha) {
  const label = expected.label;
  assertEqual(artifact.schemaVersion, 1, `${label}.schemaVersion`);
  assertEqual(artifact.artifactType, 'zutomayo-canary-gateway-config', `${label}.artifactType`);
  assertEqual(artifact.deploymentMode, 'canary', `${label}.deploymentMode`);
  assertEqual(artifact.phase, expected.phase, `${label}.phase`);
  assertEqual(artifact.sequence, expected.sequence, `${label}.sequence`);
  assertEqual(artifact.activeReleaseSet, expected.activeReleaseSet, `${label}.activeReleaseSet`);
  if (
    typeof artifact.candidateReleaseSha !== 'string' ||
    artifact.candidateReleaseSha.toLowerCase() !== candidateReleaseSha
  ) {
    fail(`${label}.candidateReleaseSha does not match the candidate manifest`);
  }
  if (!isPlainObject(artifact.traffic)) fail(`${label}.traffic must be an object`);
  assertEqual(
    artifact.traffic.stableWeightPercent,
    100 - expected.candidateWeightPercent,
    `${label}.traffic.stableWeightPercent`,
  );
  assertEqual(
    artifact.traffic.candidateWeightPercent,
    expected.candidateWeightPercent,
    `${label}.traffic.candidateWeightPercent`,
  );
  if (!isPlainObject(artifact.releaseSets)) fail(`${label}.releaseSets must be an object`);
  assertReleaseSet(artifact.releaseSets.stable, stableReleaseSet, `${label}.releaseSets.stable`);
  assertReleaseSet(artifact.releaseSets.candidate, candidateReleaseSet, `${label}.releaseSets.candidate`);
  if (!isPlainObject(artifact.gateway)) fail(`${label}.gateway must be an object`);
  const { stableSlot, candidateSlot } = artifact.gateway;
  if (
    !['blue', 'green'].includes(stableSlot) ||
    !['blue', 'green'].includes(candidateSlot) ||
    stableSlot === candidateSlot
  ) {
    fail(`${label}.gateway must contain distinct blue/green stable and candidate slots`);
  }
  const expectedConfigId = `canary-${candidateReleaseSha.slice(0, 12)}-${expected.candidateWeightPercent}-${stableSlot}-${candidateSlot}`;
  assertEqual(artifact.gateway.activeConfigId, expectedConfigId, `${label}.gateway.activeConfigId`);
  return { stableSlot, candidateSlot };
}

function assertMinimumInteger(value, minimum, label) {
  if (!Number.isInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}`);
}

function assertPolicySnapshot(policy, label) {
  if (!isPlainObject(policy)) fail(`${label} must be a repository policy snapshot`);
  const expectedKeys = Object.keys(SERVER4_CANARY_POLICY).sort();
  const actualKeys = Object.keys(policy).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail(`${label} must contain exactly the repository canary policy fields`);
  }
  for (const [name, expected] of Object.entries(SERVER4_CANARY_POLICY)) {
    if (Array.isArray(expected)) {
      if (!Array.isArray(policy[name]) || policy[name].length !== expected.length) {
        fail(`${label}.${name} does not match repository policy`);
      }
      for (const [index, value] of expected.entries()) {
        assertEqual(policy[name][index], value, `${label}.${name}[${index}]`);
      }
    } else {
      assertEqual(policy[name], expected, `${label}.${name}`);
    }
  }
}

function validateRawMetrics(metrics, expected, gatewaySha256, startedAt, finishedAt, switchInterval) {
  const label = expected.label;
  assertEqual(metrics.schemaVersion, 1, `${label}.schemaVersion`);
  assertEqual(metrics.artifactType, 'zutomayo-canary-raw-metrics', `${label}.artifactType`);
  assertEqual(metrics.phase, expected.phase, `${label}.phase`);
  assertEqual(metrics.sequence, expected.sequence, `${label}.sequence`);
  assertEqual(metrics.stableWeightPercent, 100 - expected.candidateWeightPercent, `${label}.stableWeightPercent`);
  assertEqual(metrics.candidateWeightPercent, expected.candidateWeightPercent, `${label}.candidateWeightPercent`);
  assertMinimumInteger(metrics.httpSamples, SERVER4_CANARY_POLICY.minHttpSamplesPerStage, `${label}.httpSamples`);
  assertMinimumInteger(
    metrics.websocketSamples,
    SERVER4_CANARY_POLICY.minWebsocketSamplesPerStage,
    `${label}.websocketSamples`,
  );
  assertMinimumInteger(
    metrics.readyReplicaCount,
    SERVER4_CANARY_POLICY.minReadyReplicaCount,
    `${label}.readyReplicaCount`,
  );
  assertEqual(metrics.gatewayConfigSha256, gatewaySha256, `${label}.gatewayConfigSha256`);
  const durationSeconds = (finishedAt.milliseconds - startedAt.milliseconds) / 1_000;
  if (durationSeconds <= 0) fail(`${label} finished timestamp must be after its started timestamp`);
  if (!isPlainObject(metrics.observation)) fail(`${label}.observation must come from the collector`);
  assertEqual(metrics.observation.startedAt, startedAt.value, `${label}.observation.startedAt`);
  assertEqual(metrics.observation.finishedAt, finishedAt.value, `${label}.observation.finishedAt`);
  assertEqual(metrics.observation.dwellSeconds, durationSeconds, `${label}.observation.dwellSeconds`);
  if (expected.phase === 'rollout') {
    if (durationSeconds < SERVER4_CANARY_POLICY.minStageDwellSeconds) {
      fail(`${label} dwell must be >= ${SERVER4_CANARY_POLICY.minStageDwellSeconds} seconds`);
    }
    assertPolicySnapshot(metrics.policy, `${label}.policy`);
    assertEqual(metrics.policyPassed, true, `${label}.policyPassed`);
  } else {
    if (!switchInterval) fail(`${label} switch interval is required`);
    const rollbackSeconds = (switchInterval.finishedAt.milliseconds - switchInterval.startedAt.milliseconds) / 1_000;
    if (rollbackSeconds <= 0 || rollbackSeconds > SERVER4_CANARY_POLICY.maxRollbackSeconds) {
      fail(`${label} duration must be <= ${SERVER4_CANARY_POLICY.maxRollbackSeconds} seconds`);
    }
    if (startedAt.milliseconds < switchInterval.finishedAt.milliseconds) {
      fail(`${label} observation must start after the rollback switch finished`);
    }
    const observationDelaySeconds = (startedAt.milliseconds - switchInterval.finishedAt.milliseconds) / 1_000;
    if (observationDelaySeconds > SERVER4_CANARY_POLICY.maxRollbackObservationDelaySeconds) {
      fail(
        `${label} observation must start within ${SERVER4_CANARY_POLICY.maxRollbackObservationDelaySeconds} seconds of the rollback switch`,
      );
    }
    if (durationSeconds > SERVER4_CANARY_POLICY.maxRollbackObservationSeconds) {
      fail(`${label} observation duration must be <= ${SERVER4_CANARY_POLICY.maxRollbackObservationSeconds} seconds`);
    }
    assertEqual(metrics.rollbackSeconds, rollbackSeconds, `${label}.rollbackSeconds`);
    return {
      observationDelaySeconds,
      observationDurationSeconds: durationSeconds,
      rollbackSeconds,
    };
  }
  return { observationDurationSeconds: durationSeconds };
}

function normalizedCheckedAt(value) {
  const checkedAt = value instanceof Date ? value.toISOString() : (value ?? new Date().toISOString());
  const milliseconds = Date.parse(checkedAt);
  if (
    typeof checkedAt !== 'string' ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== checkedAt
  ) {
    fail('checkedAt must be a canonical ISO timestamp');
  }
  return { value: checkedAt, milliseconds };
}

function validateRunProvenance(repository, runId, runUrl) {
  if (!REPOSITORY_PATTERN.test(repository)) fail('repository must be an owner/name GitHub repository');
  if (!RUN_ID_PATTERN.test(runId)) fail('runId must contain digits only');
  let parsed;
  try {
    parsed = new URL(runUrl);
  } catch {
    fail('runUrl must be a valid URL');
  }
  const expectedPath = `/${repository}/actions/runs/${runId}`;
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== expectedPath ||
    parsed.search ||
    parsed.hash
  ) {
    fail(`runUrl must be exactly https://github.com/${repository}/actions/runs/${runId}`);
  }
}

function copyArtifacts(outputRoot, plans) {
  const copied = new Map();
  const destinations = new Set();
  for (const plan of plans) {
    if (destinations.has(plan.path)) fail(`duplicate output artifact path: ${plan.path}`);
    destinations.add(plan.path);
    const destination = path.resolve(outputRoot, ...plan.path.split('/'));
    ensureContained(outputRoot, destination, `output artifact ${plan.path}`);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    const realParent = realpathSync(path.dirname(destination));
    ensureContained(outputRoot, realParent, `output artifact ${plan.path}`);
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
      fail(`output artifact must not replace a symlink: ${plan.path}`);
    }
    writeFileSync(destination, plan.contents, { mode: 0o644 });
    const copiedContents = readRegularFile(destination, `copied artifact ${plan.path}`);
    if (!copiedContents.equals(plan.contents)) fail(`copied artifact contents changed: ${plan.path}`);
    copied.set(plan.id, { path: plan.path, sha256: sha256(copiedContents) });
  }
  return copied;
}

function artifact(copied, id) {
  const reference = copied.get(id);
  if (!reference) fail(`internal error: missing copied artifact ${id}`);
  return reference;
}

function promoteAssembly(assemblyRoot, outputRoot) {
  const stagingDirectory = path.join(outputRoot, 'staging');
  if (
    existsSync(stagingDirectory) &&
    (lstatSync(stagingDirectory).isSymbolicLink() || !statSync(stagingDirectory).isDirectory())
  ) {
    fail('output staging path must be a regular directory');
  }
  mkdirSync(stagingDirectory, { recursive: true, mode: 0o755 });
  const sourceCanary = path.join(assemblyRoot, 'staging', 'canary');
  const sourceSummary = path.join(assemblyRoot, 'staging', 'canary-rollback.json');
  const destinationCanary = path.join(stagingDirectory, 'canary');
  const destinationSummary = path.join(stagingDirectory, 'canary-rollback.json');
  for (const [target, label, directory] of [
    [destinationCanary, 'canary artifact directory', true],
    [destinationSummary, 'canary evidence summary', false],
  ]) {
    if (!existsSync(target)) continue;
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile())) {
      fail(`existing ${label} has an unsafe file type`);
    }
  }
  const token = `${process.pid}-${Date.now()}`;
  const backupCanary = path.join(stagingDirectory, `.canary.backup-${token}`);
  const backupSummary = path.join(stagingDirectory, `.canary-rollback.backup-${token}.json`);
  if (existsSync(backupCanary) || existsSync(backupSummary)) fail('canary evidence backup path collision');
  let backedUpCanary = false;
  let backedUpSummary = false;
  let promotedCanary = false;
  let promotedSummary = false;
  try {
    if (existsSync(destinationSummary)) {
      renameSync(destinationSummary, backupSummary);
      backedUpSummary = true;
    }
    if (existsSync(destinationCanary)) {
      renameSync(destinationCanary, backupCanary);
      backedUpCanary = true;
    }
    renameSync(sourceCanary, destinationCanary);
    promotedCanary = true;
    renameSync(sourceSummary, destinationSummary);
    promotedSummary = true;
  } catch (error) {
    if (promotedSummary) rmSync(destinationSummary, { force: true });
    if (promotedCanary) rmSync(destinationCanary, { recursive: true, force: true });
    if (backedUpCanary && existsSync(backupCanary)) renameSync(backupCanary, destinationCanary);
    if (backedUpSummary && existsSync(backupSummary)) renameSync(backupSummary, destinationSummary);
    throw error;
  }
  try {
    if (backedUpCanary) rmSync(backupCanary, { recursive: true, force: true });
    if (backedUpSummary) rmSync(backupSummary, { force: true });
  } catch {
    // The promoted evidence is complete; a hidden previous-version backup is safer than rolling it back now.
  }
  return destinationSummary;
}

function acquireOutputLock(outputRoot) {
  const lockPath = path.join(outputRoot, '.canary-evidence.lock');
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      fail(`another canary evidence assembler owns ${lockPath}`);
    }
    throw error;
  }
  try {
    writeFileSync(
      path.join(lockPath, 'owner.json'),
      `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
  return () => rmSync(lockPath, { recursive: true, force: true });
}

export function assembleServer4CanaryEvidence(options) {
  const evidenceDirectory = path.resolve(options.evidenceDir);
  if (!existsSync(evidenceDirectory) || !statSync(evidenceDirectory).isDirectory()) {
    fail(`evidence directory is missing: ${evidenceDirectory}`);
  }
  const evidenceRoot = realpathSync(evidenceDirectory);
  const outputDirectory = path.resolve(options.outputDir);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
  const outputRoot = realpathSync(outputDirectory);
  validateRunProvenance(String(options.repository ?? ''), String(options.runId ?? ''), String(options.runUrl ?? ''));

  const stableManifestPath = path.resolve(options.stableManifest);
  const candidateManifestPath = path.resolve(options.candidateManifest);
  const stableManifestContents = readRegularFile(stableManifestPath, 'stable release manifest');
  const candidateManifestContents = readRegularFile(candidateManifestPath, 'candidate release manifest');
  const stableManifest = parseGatewayReleaseManifest(stableManifestContents.toString('utf8'), 'stable manifest', {
    allowLegacySix: true,
  });
  const candidateManifest = parseGatewayReleaseManifest(
    candidateManifestContents.toString('utf8'),
    'candidate manifest',
  );
  validateManifestPair(stableManifest, candidateManifest);
  const releaseSha = candidateManifest.RELEASE_SHA.toLowerCase();
  const stableReleaseSha = stableManifest.RELEASE_SHA.toLowerCase();
  const stableReleaseSet = Object.fromEntries(
    RUNTIME_SERVICES.map((service) => [service, stableManifest[IMAGE_MANIFEST_KEYS[service]]]),
  );
  const candidateReleaseSet = Object.fromEntries(
    RUNTIME_SERVICES.map((service) => [service, candidateManifest[IMAGE_MANIFEST_KEYS[service]]]),
  );
  const imageDigests = Object.fromEntries(
    Object.entries(IMAGE_MANIFEST_KEYS).map(([service, key]) => [service, candidateManifest[key]]),
  );

  const inputs = [
    { key: 'stage10Prefix', weight: 10, phase: 'rollout', sequence: 1, activeReleaseSet: 'mixed' },
    { key: 'stage50Prefix', weight: 50, phase: 'rollout', sequence: 2, activeReleaseSet: 'mixed' },
    { key: 'stage100Prefix', weight: 100, phase: 'rollout', sequence: 3, activeReleaseSet: 'candidate' },
    { key: 'rollbackPrefix', weight: 0, phase: 'rollback', sequence: 4, activeReleaseSet: 'stable' },
  ];
  const prefixes = inputs.map((input) => options[input.key]);
  if (new Set(prefixes).size !== inputs.length) fail('stage evidence prefixes must be unique');
  const plans = [
    { id: 'stable-manifest', path: 'staging/canary/stable-release.env', contents: stableManifestContents },
    { id: 'candidate-manifest', path: 'staging/canary/candidate-release.env', contents: candidateManifestContents },
  ];
  const records = [];
  let expectedStableSlot;
  let expectedCandidateSlot;
  let previousFinishedAt;

  for (const input of inputs) {
    const prefix = options[input.key];
    validatePrefix(prefix, input.weight, releaseSha);
    const label = input.phase === 'rollback' ? 'rollback raw metrics' : `${input.weight}% rollout raw metrics`;
    const gatewaySource = evidenceSource(evidenceRoot, prefix, 'json', `${input.weight}% gateway artifact`);
    const metricsSource = evidenceSource(evidenceRoot, prefix, 'raw-metrics.json', label);
    const startedSuffix = 'applied-at';
    const finishedSuffix = 'finished-at';
    const startedSource = evidenceSource(evidenceRoot, prefix, startedSuffix, `${input.weight}% started timestamp`);
    const finishedSource = evidenceSource(evidenceRoot, prefix, finishedSuffix, `${input.weight}% finished timestamp`);
    const startedAt = parseTimestamp(startedSource.contents, `${input.weight}% started timestamp`);
    const finishedAt = parseTimestamp(finishedSource.contents, `${input.weight}% finished timestamp`);
    let switchInterval;
    let switchSources;
    if (input.phase === 'rollback') {
      const switchStartedSource = evidenceSource(
        evidenceRoot,
        prefix,
        'rollback-started-at',
        'rollback switch started timestamp',
      );
      const switchFinishedSource = evidenceSource(
        evidenceRoot,
        prefix,
        'rollback-finished-at',
        'rollback switch finished timestamp',
      );
      switchInterval = {
        startedAt: parseTimestamp(switchStartedSource.contents, 'rollback switch started timestamp'),
        finishedAt: parseTimestamp(switchFinishedSource.contents, 'rollback switch finished timestamp'),
      };
      switchSources = { started: switchStartedSource, finished: switchFinishedSource };
    }
    const chronologicalStart = switchInterval?.startedAt ?? startedAt;
    if (previousFinishedAt !== undefined && chronologicalStart.milliseconds < previousFinishedAt) {
      fail(`${input.weight}% stage starts before the previous stage finished`);
    }
    previousFinishedAt = finishedAt.milliseconds;
    const gatewayConfig = parseJson(gatewaySource.contents, `${input.weight}% gateway artifact`);
    const slots = validateGatewayArtifact(
      gatewayConfig,
      {
        label: `${input.weight}% gateway artifact`,
        phase: input.phase,
        sequence: input.sequence,
        activeReleaseSet: input.activeReleaseSet,
        candidateWeightPercent: input.weight,
      },
      stableReleaseSet,
      candidateReleaseSet,
      releaseSha,
    );
    if (expectedStableSlot === undefined) {
      expectedStableSlot = slots.stableSlot;
      expectedCandidateSlot = slots.candidateSlot;
    } else if (slots.stableSlot !== expectedStableSlot || slots.candidateSlot !== expectedCandidateSlot) {
      fail(`${input.weight}% gateway artifact changed stable/candidate slot roles during the rollout`);
    }
    const gatewaySha256 = sha256(gatewaySource.contents);
    const rawMetrics = parseJson(metricsSource.contents, label);
    const durations = validateRawMetrics(
      rawMetrics,
      {
        label,
        phase: input.phase,
        sequence: input.sequence,
        candidateWeightPercent: input.weight,
      },
      gatewaySha256,
      startedAt,
      finishedAt,
      switchInterval,
    );
    const destination = input.phase === 'rollback' ? 'rollback' : `stage-${input.weight}`;
    plans.push(
      {
        id: `${destination}-gateway`,
        path: `staging/canary/${destination}/gateway-config.json`,
        contents: gatewaySource.contents,
      },
      {
        id: `${destination}-metrics`,
        path: `staging/canary/${destination}/raw-metrics.json`,
        contents: metricsSource.contents,
      },
      {
        id: `${destination}-started`,
        path: `staging/canary/${destination}/${startedSuffix}`,
        contents: startedSource.contents,
      },
      {
        id: `${destination}-finished`,
        path: `staging/canary/${destination}/${finishedSuffix}`,
        contents: finishedSource.contents,
      },
    );
    if (switchSources) {
      plans.push(
        {
          id: `${destination}-switch-started`,
          path: `staging/canary/${destination}/rollback-started-at`,
          contents: switchSources.started.contents,
        },
        {
          id: `${destination}-switch-finished`,
          path: `staging/canary/${destination}/rollback-finished-at`,
          contents: switchSources.finished.contents,
        },
      );
    }
    records.push({
      ...input,
      destination,
      startedAt,
      finishedAt,
      ...durations,
      switchInterval,
      gatewaySha256,
      rawMetrics,
    });
  }

  const checkedAt = normalizedCheckedAt(options.checkedAt);
  const firstStage = records[0];
  const rollback = records[records.length - 1];
  if (checkedAt.milliseconds < rollback.finishedAt.milliseconds) {
    fail('checkedAt must be no earlier than rollback completion');
  }
  const releaseOutputLock = acquireOutputLock(outputRoot);
  try {
    const assemblyRoot = path.join(outputRoot, `.canary-assembly-${process.pid}-${Date.now()}`);
    if (existsSync(assemblyRoot)) fail('canary evidence temporary path collision');
    mkdirSync(assemblyRoot, { mode: 0o700 });
    try {
      const copied = copyArtifacts(assemblyRoot, plans);
      const artifacts = plans.map((plan) => artifact(copied, plan.id));
      const stages = records.slice(0, 3).map((record) => ({
        sequence: record.sequence,
        weightPercent: record.weight,
        startedAt: record.startedAt.value,
        finishedAt: record.finishedAt.value,
        httpSamples: record.rawMetrics.httpSamples,
        websocketSamples: record.rawMetrics.websocketSamples,
        readyReplicaCount: record.rawMetrics.readyReplicaCount,
        gatewayConfigSha256: artifact(copied, `${record.destination}-gateway`).sha256,
        gatewayConfigArtifact: artifact(copied, `${record.destination}-gateway`),
        rawMetricsArtifact: artifact(copied, `${record.destination}-metrics`),
        appliedAtArtifact: artifact(copied, `${record.destination}-started`),
        finishedAtArtifact: artifact(copied, `${record.destination}-finished`),
      }));
      const rollbackSeconds = rollback.rollbackSeconds;
      const evidence = {
        schemaVersion: 1,
        status: 'passed',
        environment: 'staging',
        evidenceType: 'canary-rollback',
        releaseSha,
        imageDigests,
        startedAt: firstStage.startedAt.value,
        finishedAt: rollback.finishedAt.value,
        durationMs: rollback.finishedAt.milliseconds - firstStage.startedAt.milliseconds,
        checkedAt: checkedAt.value,
        metrics: {
          rollbackSeconds,
          rollbackObservationDelaySeconds: rollback.observationDelaySeconds,
          rollbackObservationSeconds: rollback.observationDurationSeconds,
          stagesCompleted: SERVER4_CANARY_POLICY.requiredStages,
        },
        thresholds: {
          maxRollbackSeconds: SERVER4_CANARY_POLICY.maxRollbackSeconds,
          maxRollbackObservationDelaySeconds: SERVER4_CANARY_POLICY.maxRollbackObservationDelaySeconds,
          maxRollbackObservationSeconds: SERVER4_CANARY_POLICY.maxRollbackObservationSeconds,
          requiredStages: SERVER4_CANARY_POLICY.requiredStages,
          minStageDwellSeconds: SERVER4_CANARY_POLICY.minStageDwellSeconds,
          minHttpSamplesPerStage: SERVER4_CANARY_POLICY.minHttpSamplesPerStage,
          minWebsocketSamplesPerStage: SERVER4_CANARY_POLICY.minWebsocketSamplesPerStage,
          minReadyReplicaCount: SERVER4_CANARY_POLICY.minReadyReplicaCount,
        },
        results: {
          tenPercentPassed: true,
          fiftyPercentPassed: true,
          fullPassed: true,
          rollbackPassed: true,
        },
        artifacts,
        provenance: {
          runId: String(options.runId),
          repository: String(options.repository),
          runUrl: String(options.runUrl),
        },
        source: String(options.runUrl),
        rollout: {
          stableReleaseSha,
          stableManifestArtifact: artifact(copied, 'stable-manifest'),
          candidateManifestArtifact: artifact(copied, 'candidate-manifest'),
          stableReleaseSet,
          candidateReleaseSet,
          stages,
          rollback: {
            fromReleaseSet: { ...candidateReleaseSet },
            toReleaseSet: { ...stableReleaseSet },
            startedAt: rollback.switchInterval.startedAt.value,
            finishedAt: rollback.switchInterval.finishedAt.value,
            observationStartedAt: rollback.startedAt.value,
            observationFinishedAt: rollback.finishedAt.value,
            httpSamples: rollback.rawMetrics.httpSamples,
            websocketSamples: rollback.rawMetrics.websocketSamples,
            readyReplicaCount: rollback.rawMetrics.readyReplicaCount,
            gatewayConfigSha256: artifact(copied, 'rollback-gateway').sha256,
            gatewayConfigArtifact: artifact(copied, 'rollback-gateway'),
            rawMetricsArtifact: artifact(copied, 'rollback-metrics'),
            observationStartedAtArtifact: artifact(copied, 'rollback-started'),
            observationFinishedAtArtifact: artifact(copied, 'rollback-finished'),
            startedAtArtifact: artifact(copied, 'rollback-switch-started'),
            finishedAtArtifact: artifact(copied, 'rollback-switch-finished'),
          },
        },
      };

      const temporaryOutputPath = path.join(assemblyRoot, 'staging', 'canary-rollback.json');
      writeFileSync(temporaryOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
      const canaryGate = inspectStagingGates(assemblyRoot, {
        releaseSha,
        imageDigests,
        evidenceRunId: String(options.runId),
        nowMs: checkedAt.milliseconds,
      }).find((check) => check.id === 'staging-canary');
      if (canaryGate?.status !== 'passed') {
        fail(`assembled evidence failed the repository canary gate: ${canaryGate?.reason ?? 'gate result missing'}`);
      }
      const evidenceSha256 = sha256(readFileSync(temporaryOutputPath));
      const outputPath = promoteAssembly(assemblyRoot, outputRoot);
      return { evidence, outputPath, sha256: evidenceSha256 };
    } finally {
      rmSync(assemblyRoot, { recursive: true, force: true });
    }
  } finally {
    releaseOutputLock();
  }
}

function parseArguments(argv) {
  const optionNames = new Map([
    ['--evidence-dir', 'evidenceDir'],
    ['--stable-manifest', 'stableManifest'],
    ['--candidate-manifest', 'candidateManifest'],
    ['--stage-10-prefix', 'stage10Prefix'],
    ['--stage-50-prefix', 'stage50Prefix'],
    ['--stage-100-prefix', 'stage100Prefix'],
    ['--rollback-prefix', 'rollbackPrefix'],
    ['--output-dir', 'outputDir'],
    ['--run-id', 'runId'],
    ['--repository', 'repository'],
    ['--run-url', 'runUrl'],
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    const key = optionNames.get(argument);
    if (!key) fail(`unknown argument: ${argument}`);
    if (Object.hasOwn(options, key)) fail(`duplicate argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
    options[key] = value;
    index += 1;
  }
  for (const [argument, key] of optionNames) {
    if (!Object.hasOwn(options, key)) fail(`${argument} is required`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/assemble-server4-canary-evidence.mjs \\',
    '  --evidence-dir DIR --stable-manifest FILE --candidate-manifest FILE \\',
    '  --stage-10-prefix PREFIX --stage-50-prefix PREFIX --stage-100-prefix PREFIX \\',
    '  --rollback-prefix PREFIX --output-dir DIR --run-id ID \\',
    '  --repository OWNER/REPO --run-url HTTPS_URL',
  ].join('\n');
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = assembleServer4CanaryEvidence(options);
  process.stdout.write(`${JSON.stringify({ output: result.outputPath, sha256: result.sha256 })}\n`);
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `server4 canary evidence assembly failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
