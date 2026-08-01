import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TEMPLATE = path.join(ROOT, 'ops/haproxy/server4.cfg.tmpl');
const DEFAULT_CONFIG_OUTPUT = path.join(ROOT, '.release-evidence/server4/haproxy.cfg');
const DEFAULT_ARTIFACT_OUTPUT = path.join(ROOT, '.release-evidence/server4/gateway-config.json');
const SLOT_NAMES = Object.freeze(['blue', 'green']);
const PROCESS_NAMES = Object.freeze(['p1', 'p2']);
const RUNTIME_SERVICES = Object.freeze(['game', 'api', 'platform']);
const ALLOWED_WEIGHTS = new Set([0, 10, 50, 100]);
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/;
const MIGRATION_PATTERN = /^\d{6,}_[a-z0-9_]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[a-f0-9]{64}$/i;
const TEMPLATE_PATTERN = /{{[A-Z0-9_]+}}/g;
const SERVICE_PORTS = Object.freeze({ game: 3000, api: 3001, platform: 3002 });
const RELEASE_MANIFEST_KEYS = Object.freeze([
  'RELEASE_SHA',
  'APP_VERSION',
  'GAME_RULES_VERSION',
  'EXPECTED_SCHEMA_MIGRATION',
  'EXPECTED_SCHEMA_CHECKSUM',
  'GAME_IMAGE',
  'API_IMAGE',
  'PLATFORM_IMAGE',
  'MIGRATE_IMAGE',
  'RETENTION_IMAGE',
  'GATEWAY_IMAGE',
  'OPS_IMAGE',
]);
const LEGACY_RELEASE_MANIFEST_KEYS = Object.freeze(RELEASE_MANIFEST_KEYS.filter((key) => key !== 'OPS_IMAGE'));

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} must contain exactly: ${sortedExpected.join(', ')}`);
  }
}

function imageRepository(reference) {
  return reference.slice(0, reference.toLowerCase().lastIndexOf('@sha256:'));
}

export function parseGatewayReleaseManifest(contents, label = 'release manifest', { allowLegacySix = false } = {}) {
  if (typeof contents !== 'string') throw new Error(`${label} must be text`);
  const values = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    if (!rawLine) continue;
    if (/^\s|\s$/.test(rawLine) || rawLine.startsWith('#')) {
      throw new Error(`${label} line ${index + 1} must be an unquoted KEY=VALUE assignment without whitespace`);
    }
    const separator = rawLine.indexOf('=');
    if (separator < 1) throw new Error(`${label} line ${index + 1} must be KEY=VALUE`);
    const key = rawLine.slice(0, separator);
    const value = rawLine.slice(separator + 1);
    if (!RELEASE_MANIFEST_KEYS.includes(key)) throw new Error(`${label} contains unsupported key ${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`${label} contains duplicate key ${key}`);
    values[key] = value;
  }
  const expectedKeys =
    allowLegacySix && !Object.hasOwn(values, 'OPS_IMAGE') ? LEGACY_RELEASE_MANIFEST_KEYS : RELEASE_MANIFEST_KEYS;
  assertExactKeys(values, expectedKeys, label);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(values, key) || !values[key]) throw new Error(`${label} is missing ${key}`);
  }
  if (!RELEASE_SHA_PATTERN.test(values.RELEASE_SHA)) throw new Error(`${label} RELEASE_SHA must be a full Git SHA`);
  if (!SEMVER_PATTERN.test(values.APP_VERSION)) throw new Error(`${label} APP_VERSION must be release-safe semver`);
  if (!SEMVER_PATTERN.test(values.GAME_RULES_VERSION)) {
    throw new Error(`${label} GAME_RULES_VERSION must be release-safe semver`);
  }
  if (!MIGRATION_PATTERN.test(values.EXPECTED_SCHEMA_MIGRATION)) {
    throw new Error(`${label} EXPECTED_SCHEMA_MIGRATION must be a migration basename`);
  }
  if (!SHA256_PATTERN.test(values.EXPECTED_SCHEMA_CHECKSUM)) {
    throw new Error(`${label} EXPECTED_SCHEMA_CHECKSUM must be a SHA-256 digest`);
  }
  const imageKeys = ['GAME_IMAGE', 'API_IMAGE', 'PLATFORM_IMAGE', 'MIGRATE_IMAGE', 'RETENTION_IMAGE', 'GATEWAY_IMAGE'];
  if (Object.hasOwn(values, 'OPS_IMAGE')) imageKeys.push('OPS_IMAGE');
  for (const key of imageKeys) {
    if (!IMAGE_DIGEST_PATTERN.test(values[key])) {
      throw new Error(`${label} ${key} must be a complete immutable image @sha256 reference`);
    }
  }
  return values;
}

export function gatewayInputFromReleaseManifests({
  stableManifest,
  candidateManifest,
  stableSlot,
  candidateSlot,
  candidateWeightPercent,
}) {
  const stable = parseGatewayReleaseManifest(stableManifest, 'stable manifest', { allowLegacySix: true });
  const candidate = parseGatewayReleaseManifest(candidateManifest, 'candidate manifest');
  if (stable.RELEASE_SHA.toLowerCase() === candidate.RELEASE_SHA.toLowerCase()) {
    throw new Error('stable and candidate manifests must use different RELEASE_SHA values');
  }
  return {
    schemaVersion: 1,
    deploymentMode: 'canary',
    stableSlot,
    candidateSlot,
    candidateWeightPercent,
    candidateReleaseSha: candidate.RELEASE_SHA,
    releaseSets: {
      stable: { game: stable.GAME_IMAGE, api: stable.API_IMAGE, platform: stable.PLATFORM_IMAGE },
      candidate: { game: candidate.GAME_IMAGE, api: candidate.API_IMAGE, platform: candidate.PLATFORM_IMAGE },
    },
  };
}

export function gatewayInputFromBootstrapManifest({ manifest, stableSlot }) {
  const release = parseGatewayReleaseManifest(manifest, 'bootstrap manifest');
  const candidateSlot = SLOT_NAMES.find((slot) => slot !== stableSlot);
  return {
    schemaVersion: 1,
    deploymentMode: 'bootstrap',
    stableSlot,
    candidateSlot,
    candidateWeightPercent: 0,
    candidateReleaseSha: release.RELEASE_SHA,
    releaseSets: {
      stable: { game: release.GAME_IMAGE, api: release.API_IMAGE, platform: release.PLATFORM_IMAGE },
      candidate: { game: release.GAME_IMAGE, api: release.API_IMAGE, platform: release.PLATFORM_IMAGE },
    },
  };
}

function validateReleaseSet(value, label) {
  const releaseSet = assertObject(value, label);
  assertExactKeys(releaseSet, RUNTIME_SERVICES, label);
  const normalized = {};
  for (const service of RUNTIME_SERVICES) {
    const reference = releaseSet[service];
    if (typeof reference !== 'string' || !IMAGE_DIGEST_PATTERN.test(reference)) {
      throw new Error(`${label}.${service} must be a complete immutable image @sha256 reference`);
    }
    normalized[service] = reference.toLowerCase();
  }
  return normalized;
}

function canonicalSlotConfig(slot) {
  return {
    gameAlias: `game-${slot}`,
    apiAlias: `api-${slot}`,
    platform: Object.fromEntries(
      PROCESS_NAMES.map((processName) => [
        processName,
        {
          alias: `platform-${slot}-${processName}`,
          publicPath: `/_platform/${slot}/${processName}`,
        },
      ]),
    ),
  };
}

export function validateGatewayInput(value) {
  const input = assertObject(value, 'input');
  assertExactKeys(
    input,
    [
      'candidateReleaseSha',
      'candidateSlot',
      'candidateWeightPercent',
      'deploymentMode',
      'releaseSets',
      'schemaVersion',
      'stableSlot',
    ],
    'input',
  );
  if (input.schemaVersion !== 1) throw new Error('input.schemaVersion must be exactly 1');
  if (input.deploymentMode !== 'bootstrap' && input.deploymentMode !== 'canary') {
    throw new Error('input.deploymentMode must be bootstrap or canary');
  }
  if (!SLOT_NAMES.includes(input.stableSlot)) throw new Error('input.stableSlot must be blue or green');
  if (!SLOT_NAMES.includes(input.candidateSlot)) throw new Error('input.candidateSlot must be blue or green');
  if (input.stableSlot === input.candidateSlot) {
    throw new Error('input.stableSlot and input.candidateSlot must be different');
  }
  if (!ALLOWED_WEIGHTS.has(input.candidateWeightPercent)) {
    throw new Error('input.candidateWeightPercent must be exactly 0, 10, 50, or 100');
  }
  if (input.deploymentMode === 'bootstrap' && input.candidateWeightPercent !== 0) {
    throw new Error('bootstrap gateway candidateWeightPercent must be exactly 0');
  }
  if (typeof input.candidateReleaseSha !== 'string' || !RELEASE_SHA_PATTERN.test(input.candidateReleaseSha)) {
    throw new Error('input.candidateReleaseSha must be a full 40-character Git SHA');
  }

  const releaseSets = assertObject(input.releaseSets, 'input.releaseSets');
  assertExactKeys(releaseSets, ['candidate', 'stable'], 'input.releaseSets');
  const stableReleaseSet = validateReleaseSet(releaseSets.stable, 'input.releaseSets.stable');
  const candidateReleaseSet = validateReleaseSet(releaseSets.candidate, 'input.releaseSets.candidate');
  for (const service of RUNTIME_SERVICES) {
    if (imageRepository(stableReleaseSet[service]) !== imageRepository(candidateReleaseSet[service])) {
      throw new Error(`input.releaseSets.${service} stable and candidate images must use the same repository`);
    }
    if (input.deploymentMode === 'canary' && stableReleaseSet[service] === candidateReleaseSet[service]) {
      throw new Error(`input.releaseSets.${service} stable and candidate digests must be different`);
    }
  }

  const candidateReleaseSha = input.candidateReleaseSha.toLowerCase();
  const normalizedSlots = Object.fromEntries(SLOT_NAMES.map((slot) => [slot, canonicalSlotConfig(slot)]));

  return {
    schemaVersion: 1,
    deploymentMode: input.deploymentMode,
    stableSlot: input.stableSlot,
    candidateSlot: input.candidateSlot,
    candidateWeightPercent: input.candidateWeightPercent,
    candidateReleaseSha,
    cohortCookieName: `zmc_${candidateReleaseSha.slice(0, 12)}`,
    slotPinCookieName: `zms_${candidateReleaseSha.slice(0, 12)}`,
    releaseSets: { stable: stableReleaseSet, candidate: candidateReleaseSet },
    slots: normalizedSlots,
  };
}

function directPlatformRules(slots) {
  const routeDefinitions = [];
  const rewrites = [];
  const backends = [];
  for (const slot of SLOT_NAMES) {
    for (const processName of PROCESS_NAMES) {
      const publicPath = slots[slot].platform[processName].publicPath;
      const routeName = `${slot}_${processName}`;
      const condition = `{ var(txn.direct_platform) -m str ${routeName} }`;
      routeDefinitions.push(
        `    acl direct_platform_${routeName} path_reg -i ^${publicPath}(/|$)`,
        `    http-request set-var(txn.direct_platform) str(${routeName}) if direct_platform_${routeName}`,
        `    http-request set-var(txn.release_slot) str(${slot}) if direct_platform_${routeName}`,
        `    http-request set-var(txn.set_slot_pin) str(yes) if direct_platform_${routeName} !slot_pin_${slot}`,
      );
      rewrites.push(
        `    http-request replace-path ^${publicPath}$ / if ${condition}`,
        `    http-request replace-path ^${publicPath}/(.*)$ /\\1 if ${condition}`,
      );
      backends.push(`    use_backend be_platform_${routeName} if ${condition}`);
    }
  }
  return {
    requests: [...routeDefinitions, '', ...rewrites].join('\n'),
    backends: backends.join('\n'),
  };
}

function cohortRoutingRules({ stableSlot, candidateSlot, candidateWeightPercent }) {
  const requests = [];
  requests.push(
    `    http-request set-var(txn.release_slot) str(${stableSlot}) if slot_pin_${stableSlot} !release_slot_selected`,
  );
  if (candidateWeightPercent > 0) {
    requests.push(
      `    http-request set-var(txn.release_slot) str(${candidateSlot}) if slot_pin_${candidateSlot} !release_slot_selected`,
      `    http-request set-var(txn.release_slot) str(${candidateSlot}) if candidate_cohort !release_slot_selected`,
      '    http-request set-var(txn.set_slot_pin) str(yes) unless slot_pin_valid',
    );
  } else {
    requests.push(`    http-request set-var(txn.set_slot_pin) str(yes) unless slot_pin_${stableSlot}`);
  }
  requests.push(
    `    http-request set-var(txn.release_slot) str(${stableSlot}) unless { var(txn.release_slot) -m found }`,
    `    acl release_slot_candidate var(txn.release_slot) -m str ${candidateSlot}`,
  );
  return {
    requests: requests.join('\n'),
    backends: [
      `    use_backend be_platform_${candidateSlot} if is_matchmake release_slot_candidate`,
      `    use_backend be_platform_${stableSlot} if is_matchmake`,
      `    use_backend be_game_${candidateSlot} if release_slot_candidate`,
      `    default_backend be_game_${stableSlot}`,
    ].join('\n'),
  };
}

function gatewayReadinessRules(input) {
  const checks = [];
  // A rollback must remain executable when the candidate is the dependency
  // that failed. Mixed/100% canary stages keep both slots warm; bootstrap and
  // rollback only gate ingress readiness on the stable slot.
  const requiredSlots =
    input.deploymentMode === 'bootstrap' || input.candidateWeightPercent === 0 ? [input.stableSlot] : SLOT_NAMES;
  for (const slot of requiredSlots) {
    checks.push(
      [`game_${slot}_ready`, `nbsrv(be_game_${slot}) ge 2`],
      [`api_${slot}_ready`, `nbsrv(be_api_${slot}) ge 2`],
      [`platform_${slot}_ready`, `nbsrv(be_platform_${slot}) ge 2`],
    );
  }
  const names = checks.map(([name]) => name).join(' ');
  return [
    ...checks.map(([name, expression]) => `    acl ${name} ${expression}`),
    `    http-request return status 200 content-type text/plain string ready if is_readiness ${names}`,
    '    http-request return status 503 content-type text/plain string unavailable if is_readiness',
  ].join('\n');
}

function healthCheckLines(host) {
  return [`    http-check send meth GET uri /ready ver HTTP/1.1 hdr Host ${host}`, '    http-check expect status 200'];
}

function serverLine(name, host, port) {
  return `    server ${name} ${host}:${port} check inter 2s fall 3 rise 2 resolvers docker resolve-prefer ipv4 init-addr libc,none`;
}

function serverTemplateLine(prefix, count, host, port) {
  return `    server-template ${prefix} 1-${count} ${host}:${port} check inter 2s fall 3 rise 2 resolvers docker resolve-prefer ipv4 init-addr libc,none`;
}

function backendBlock(name, host, servers, balance) {
  return [
    `backend ${name}`,
    '    option httpchk',
    ...(balance ? [`    balance ${balance}`] : []),
    ...healthCheckLines(host),
    ...servers,
  ].join('\n');
}

function renderBackends(slots) {
  const blocks = [];
  for (const slot of SLOT_NAMES) {
    const slotConfig = slots[slot];
    blocks.push(
      backendBlock(`be_game_${slot}`, slotConfig.gameAlias, [
        serverTemplateLine(`game_${slot}`, 2, slotConfig.gameAlias, SERVICE_PORTS.game),
      ]),
      backendBlock(`be_api_${slot}`, slotConfig.apiAlias, [
        serverTemplateLine(`api_${slot}`, 2, slotConfig.apiAlias, SERVICE_PORTS.api),
      ]),
    );
    const platformServers = PROCESS_NAMES.map((processName) =>
      serverLine(`platform_${slot}_${processName}`, slotConfig.platform[processName].alias, SERVICE_PORTS.platform),
    );
    blocks.push(backendBlock(`be_platform_${slot}`, slotConfig.platform.p1.alias, platformServers, 'roundrobin'));
    for (const processName of PROCESS_NAMES) {
      const process = slotConfig.platform[processName];
      blocks.push(
        backendBlock(`be_platform_${slot}_${processName}`, process.alias, [
          serverLine(`platform_${slot}_${processName}`, process.alias, SERVICE_PORTS.platform),
        ]),
      );
    }
  }
  return blocks.join('\n\n');
}

function replaceTemplate(template, replacements) {
  const present = new Set(template.match(TEMPLATE_PATTERN) ?? []);
  const expected = new Set(Object.keys(replacements).map((key) => `{{${key}}}`));
  for (const placeholder of expected) {
    if (!present.has(placeholder)) throw new Error(`HAProxy template is missing required placeholder ${placeholder}`);
  }
  for (const placeholder of present) {
    if (!expected.has(placeholder)) throw new Error(`HAProxy template contains unknown placeholder ${placeholder}`);
  }
  const rendered = template.replace(TEMPLATE_PATTERN, (placeholder) => {
    const key = placeholder.slice(2, -2);
    return replacements[key];
  });
  if (TEMPLATE_PATTERN.test(rendered)) throw new Error('HAProxy template contains unresolved placeholders');
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`;
}

function rolloutMetadata(input) {
  if (input.deploymentMode === 'bootstrap') {
    return { phase: 'bootstrap', sequence: 0, activeReleaseSet: 'stable' };
  }
  const { candidateWeightPercent } = input;
  if (candidateWeightPercent === 0) return { phase: 'rollback', sequence: 4, activeReleaseSet: 'stable' };
  if (candidateWeightPercent === 10) return { phase: 'rollout', sequence: 1, activeReleaseSet: 'mixed' };
  if (candidateWeightPercent === 50) return { phase: 'rollout', sequence: 2, activeReleaseSet: 'mixed' };
  return { phase: 'rollout', sequence: 3, activeReleaseSet: 'candidate' };
}

export function renderServer4Gateway(value, template) {
  const input = validateGatewayInput(value);
  if (typeof template !== 'string' || template.trim() === '') throw new Error('HAProxy template must not be empty');
  const stableWeightPercent = 100 - input.candidateWeightPercent;
  const activeConfigId = `${input.deploymentMode}-${input.candidateReleaseSha.slice(0, 12)}-${input.candidateWeightPercent}-${input.stableSlot}-${input.candidateSlot}`;
  const directPlatform = directPlatformRules(input.slots);
  const cohortRouting = cohortRoutingRules(input);
  const config = replaceTemplate(template, {
    ACTIVE_CONFIG_ID: activeConfigId,
    BACKENDS: renderBackends(input.slots),
    CANDIDATE_RELEASE_SHA: input.candidateReleaseSha,
    CANDIDATE_WEIGHT_PERCENT: String(input.candidateWeightPercent),
    COHORT_COOKIE_NAME: input.cohortCookieName,
    COHORT_BACKEND_RULES: cohortRouting.backends,
    COHORT_SELECTION_RULES: cohortRouting.requests,
    DIRECT_PLATFORM_BACKEND_RULES: directPlatform.backends,
    DIRECT_PLATFORM_REQUEST_RULES: directPlatform.requests,
    GATEWAY_READINESS_RULES: gatewayReadinessRules(input),
    SLOT_PIN_COOKIE_NAME: input.slotPinCookieName,
    STABLE_WEIGHT_PERCENT: String(stableWeightPercent),
  });
  const rollout = rolloutMetadata(input);
  const artifact = {
    schemaVersion: 1,
    artifactType:
      input.deploymentMode === 'bootstrap' ? 'zutomayo-bootstrap-gateway-config' : 'zutomayo-canary-gateway-config',
    phase: rollout.phase,
    sequence: rollout.sequence,
    activeReleaseSet: rollout.activeReleaseSet,
    traffic: {
      stableWeightPercent,
      candidateWeightPercent: input.candidateWeightPercent,
    },
    releaseSets: input.releaseSets,
    candidateReleaseSha: input.candidateReleaseSha,
    deploymentMode: input.deploymentMode,
    gateway: {
      implementation: 'haproxy',
      renderedConfigSha256: createHash('sha256').update(config).digest('hex'),
      stableSlot: input.stableSlot,
      candidateSlot: input.candidateSlot,
      listenerPort: 8080,
      activeConfigId,
      cohort: {
        cookieName: input.cohortCookieName,
        bucketCount: 100,
        candidateBucketUpperExclusive: input.candidateWeightPercent,
        scope: 'unpinned-new-sessions',
        slotPinCookieName: input.slotPinCookieName,
        slotPinMaxAgeSeconds: 7_200,
      },
      slots: input.slots,
    },
  };
  return { config, artifact, artifactJson: `${JSON.stringify(artifact, null, 2)}\n` };
}

function parseArguments(argv) {
  const options = {
    template: DEFAULT_TEMPLATE,
    configOutput: DEFAULT_CONFIG_OUTPUT,
    artifactOutput: DEFAULT_ARTIFACT_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--input') options.input = path.resolve(process.cwd(), value);
    else if (argument === '--bootstrap-manifest') options.bootstrapManifest = path.resolve(process.cwd(), value);
    else if (argument === '--stable-manifest') options.stableManifest = path.resolve(process.cwd(), value);
    else if (argument === '--candidate-manifest') options.candidateManifest = path.resolve(process.cwd(), value);
    else if (argument === '--stable-slot') options.stableSlot = value;
    else if (argument === '--candidate-slot') options.candidateSlot = value;
    else if (argument === '--weight') options.candidateWeightPercent = Number(value);
    else if (argument === '--template') options.template = path.resolve(process.cwd(), value);
    else if (argument === '--config-out') options.configOutput = path.resolve(process.cwd(), value);
    else if (argument === '--artifact-out') options.artifactOutput = path.resolve(process.cwd(), value);
    else throw new Error(`unknown argument: ${argument}`);
  }
  const manifestMode =
    options.bootstrapManifest ||
    options.stableManifest ||
    options.candidateManifest ||
    options.stableSlot ||
    options.candidateSlot ||
    options.candidateWeightPercent !== undefined;
  if (options.input && manifestMode) throw new Error('--input cannot be combined with manifest mode options');
  if (!options.input) {
    if (options.bootstrapManifest) {
      if (
        options.stableManifest ||
        options.candidateManifest ||
        options.candidateSlot ||
        options.candidateWeightPercent !== undefined
      ) {
        throw new Error('--bootstrap-manifest cannot be combined with canary manifest options');
      }
      if (!options.stableSlot) throw new Error('--stable-slot is required');
    } else {
      for (const option of ['stableManifest', 'candidateManifest', 'stableSlot', 'candidateSlot']) {
        if (!options[option]) {
          throw new Error(`--${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
        }
      }
      if (options.candidateWeightPercent === undefined) throw new Error('--weight is required');
    }
  }
  if (options.configOutput === options.artifactOutput) {
    throw new Error('--config-out and --artifact-out must be different files');
  }
  return options;
}

function writeOutput(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o644 });
}

function usage() {
  return [
    'Usage: node scripts/render-server4-gateway.mjs --input FILE [options]',
    '   or: node scripts/render-server4-gateway.mjs --bootstrap-manifest FILE --stable-slot SLOT [options]',
    '   or: node scripts/render-server4-gateway.mjs --stable-manifest FILE --candidate-manifest FILE --stable-slot SLOT --candidate-slot SLOT --weight N [options]',
    '',
    'Options:',
    '  --template FILE      HAProxy template (default: ops/haproxy/server4.cfg.tmpl)',
    '  --config-out FILE    Rendered HAProxy config (default: .release-evidence/server4/haproxy.cfg)',
    '  --artifact-out FILE  Canary JSON artifact (default: .release-evidence/server4/gateway-config.json)',
    '  --help               Show this help',
  ].join('\n');
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const input = options.input
    ? JSON.parse(readFileSync(options.input, 'utf8'))
    : options.bootstrapManifest
      ? gatewayInputFromBootstrapManifest({
          manifest: readFileSync(options.bootstrapManifest, 'utf8'),
          stableSlot: options.stableSlot,
        })
      : gatewayInputFromReleaseManifests({
          stableManifest: readFileSync(options.stableManifest, 'utf8'),
          candidateManifest: readFileSync(options.candidateManifest, 'utf8'),
          stableSlot: options.stableSlot,
          candidateSlot: options.candidateSlot,
          candidateWeightPercent: options.candidateWeightPercent,
        });
  const template = readFileSync(options.template, 'utf8');
  const rendered = renderServer4Gateway(input, template);
  writeOutput(options.configOutput, rendered.config);
  writeOutput(options.artifactOutput, rendered.artifactJson);
  process.stdout.write(
    `${JSON.stringify({ config: options.configOutput, artifact: options.artifactOutput, artifactType: rendered.artifact.artifactType })}\n`,
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`server4 gateway render failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
