import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.staging.yml',
  'docker-compose.server4.yml',
  'docker-compose.monitoring.yml',
  'docker-compose.retention.yml',
  'docker-compose.load-test.yml',
  'docker-compose.pgbouncer.yml',
];
const RELEASE_COMPOSE_FILES = ['docker-compose.staging.yml', 'docker-compose.server4.yml'];
const REQUIRED_IMAGES = ['GAME_IMAGE', 'API_IMAGE', 'PLATFORM_IMAGE', 'MIGRATE_IMAGE'];

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing release file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function nonCommentLines(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter(Boolean);
}

function assertNoMutableImageTags(relativePath) {
  const lines = nonCommentLines(read(relativePath));
  const mutable = lines.filter((line) => /\bimage:\s*[^\n]*(?::latest|:staging)(?:\s|$)/i.test(line));
  if (mutable.length > 0) {
    throw new Error(`${relativePath} contains mutable image tags:\n${mutable.join('\n')}`);
  }
}

function assertDigestInputs(relativePath) {
  const lines = nonCommentLines(read(relativePath));
  for (const image of REQUIRED_IMAGES) {
    const matches = lines.filter((line) => line.startsWith('image:') && line.includes(`\${${image}:?`));
    if (matches.length !== 1) throw new Error(`${relativePath} must require exactly one ${image} digest input`);
  }
  const checksumInputs = lines.filter((line) => line.includes('EXPECTED_SCHEMA_CHECKSUM=${EXPECTED_SCHEMA_CHECKSUM:?'));
  if (checksumInputs.length !== 4) {
    throw new Error(`${relativePath} must pass EXPECTED_SCHEMA_CHECKSUM to migrate and all app services`);
  }
  for (const [variable, expectedInput] of [
    ['APP_VERSION', 'APP_VERSION=${APP_VERSION:?'],
    ['APP_BUILD_ID', 'APP_BUILD_ID=${RELEASE_SHA:?'],
    ['GAME_RULES_VERSION', 'GAME_RULES_VERSION=${GAME_RULES_VERSION:?'],
  ]) {
    const matches = lines.filter((line) => line.includes(expectedInput));
    if (matches.length !== 3) {
      throw new Error(`${relativePath} must bind ${variable} to verified release metadata for all app services`);
    }
  }
}

function assertRetentionDigestInput() {
  const lines = nonCommentLines(read('docker-compose.retention.yml'));
  const matches = lines.filter((line) => line.startsWith('image:') && line.includes('${RETENTION_IMAGE:?'));
  if (matches.length !== 1)
    throw new Error('docker-compose.retention.yml must require exactly one RETENTION_IMAGE digest input');
}

function countFragment(relativePath, fragment) {
  return nonCommentLines(read(relativePath)).filter((line) => line.includes(fragment)).length;
}

function serviceBlock(relativePath, serviceName) {
  const lines = read(relativePath).split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start < 0) throw new Error(`${relativePath} is missing service ${serviceName}`);
  const block = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^(?: {2}\S[^:]*:|\S)/.test(lines[index])) break;
    block.push(lines[index]);
  }
  return block.join('\n');
}

const ROLE_PASSWORDS = [
  'PG_MIGRATION_PASSWORD',
  'PG_APP_PASSWORD',
  'PG_API_PASSWORD',
  'PG_GAME_PASSWORD',
  'PG_PLATFORM_PASSWORD',
  'PG_RETENTION_PASSWORD',
  'PG_MONITOR_PASSWORD',
  'PG_BACKUP_PASSWORD',
  'PG_WAL_PASSWORD',
];

function assertRoleEnvFileMasks(relativePath) {
  const serviceRoles = {
    migrate: { user: 'PG_MIGRATION_USER', password: 'PG_MIGRATION_PASSWORD' },
    game: { user: 'PG_GAME_USER', password: 'PG_GAME_PASSWORD' },
    api: { user: 'PG_API_USER', password: 'PG_API_PASSWORD' },
    platform: { user: 'PG_PLATFORM_USER', password: 'PG_PLATFORM_PASSWORD' },
  };
  for (const [serviceName, role] of Object.entries(serviceRoles)) {
    const block = serviceBlock(relativePath, serviceName);
    if (!/\n {4}env_file:\s+\.env(?:\n|$)/.test(`\n${block}\n`)) {
      throw new Error(`${relativePath} ${serviceName} must retain env_file: .env for optional runtime configuration`);
    }
    if (!block.includes(`PG_USER=\${${role.user}:?`)) {
      throw new Error(`${relativePath} ${serviceName} must bind PG_USER to ${role.user}`);
    }
    if (!block.includes(`PG_PASSWORD=\${${role.password}:?`)) {
      throw new Error(`${relativePath} ${serviceName} must bind PG_PASSWORD to ${role.password}`);
    }
    if (!block.includes('DATABASE_URL=')) {
      throw new Error(`${relativePath} ${serviceName} must clear DATABASE_URL`);
    }
    for (const variable of ROLE_PASSWORDS) {
      if (variable === role.password) continue;
      if (!block.includes(`${variable}=`)) {
        throw new Error(`${relativePath} ${serviceName} must explicitly mask ${variable} inherited from env_file`);
      }
    }
  }
}

function assertRuntimeEnvironmentInventory(relativePath) {
  const api = serviceBlock(relativePath, 'api');
  const requiredApiVariables = [
    'AUTH_MODE',
    'TURNSTILE_SECRET_KEY',
    'TURNSTILE_REQUIRED',
    'TURNSTILE_SITEVERIFY_URL',
    'OAUTH_TOKEN_ENCRYPTION_KEY',
    'OAUTH_PUBLIC_BASE_URL',
    'ACCESS_TOKEN_TTL_SECONDS',
    'REFRESH_TOKEN_TTL_SECONDS',
    'AUTH_COOKIE_DOMAIN',
    'AUTH_COOKIE_SAMESITE',
    'LOGTO_ENDPOINT',
    'LOGTO_ISSUER',
    'LOGTO_DISCOVERY_URL',
    'LOGTO_APP_ID',
    'LOGTO_APP_SECRET',
    'LOGTO_OAUTH_SCOPE',
    'LOGTO_ACCOUNT_CENTER_URL',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'DISCORD_OAUTH_CLIENT_ID',
    'DISCORD_OAUTH_CLIENT_SECRET',
    'CHAT_BLOCKED_WORDS',
    'CHAT_REVIEW_WORDS',
    'CHAT_TRANSLATION_ENDPOINT',
    'CHAT_TRANSLATION_API_KEY',
    'CHAT_TRANSLATION_PROVIDER',
    'CHAT_TRANSLATION_MODEL',
    'CHAT_TRANSLATION_TIMEOUT_MS',
  ];
  for (const variable of requiredApiVariables) {
    if (!api.includes(`${variable}=\${${variable}`)) {
      throw new Error(`${relativePath} API runtime must explicitly map ${variable}`);
    }
  }
  for (const serviceName of ['game', 'api', 'platform']) {
    const block = serviceBlock(relativePath, serviceName);
    for (const variable of [
      'SENTRY_DSN',
      'SENTRY_ENVIRONMENT',
      'SENTRY_TRACES_SAMPLE_RATE',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'OTEL_SERVICE_NAME',
      'OTEL_RESOURCE_ATTRIBUTES',
      'PG_POOL_MAX',
    ]) {
      if (!block.includes(`${variable}=\${${variable}`)) {
        throw new Error(`${relativePath} ${serviceName} must explicitly map ${variable}`);
      }
    }
  }
}

function assertProductionRuntimeInputs() {
  const roleUserInputs = [
    'PG_API_USER',
    'PG_GAME_USER',
    'PG_PLATFORM_USER',
    'PG_RETENTION_USER',
    'PG_MONITOR_USER',
    'PG_BACKUP_USER',
    'PG_WAL_USER',
  ];
  for (const relativePath of ['docker-compose.yml', ...RELEASE_COMPOSE_FILES]) {
    if (countFragment(relativePath, 'METRICS_TOKEN=${METRICS_TOKEN:?') !== 3) {
      throw new Error(`${relativePath} must require METRICS_TOKEN for all three runtime services`);
    }
    if (countFragment(relativePath, 'REQUIRE_APP_ROLE_GATE=true') !== 1) {
      throw new Error(`${relativePath} must fail deployment when the post-migrate app role gate fails`);
    }
  }

  for (const relativePath of RELEASE_COMPOSE_FILES) {
    assertRoleEnvFileMasks(relativePath);
    assertRuntimeEnvironmentInventory(relativePath);
    for (const variable of roleUserInputs) {
      if (countFragment(relativePath, `${variable}=\${${variable}:?`) < 1) {
        throw new Error(`${relativePath} must require an explicit ${variable} role in production/staging`);
      }
    }
    if (!read(relativePath).includes('REQUIRE_ROLE_MATRIX_GATE=true')) {
      throw new Error(`${relativePath} must enable the complete PostgreSQL role matrix gate`);
    }
    if (!read(relativePath).includes('REQUIRE_DISTINCT_DB_ROLES=true')) {
      throw new Error(`${relativePath} must reject aliased PostgreSQL roles in production/staging`);
    }
  }

  const rolePasswordInputs = [
    'PG_API_PASSWORD',
    'PG_GAME_PASSWORD',
    'PG_PLATFORM_PASSWORD',
    'PG_RETENTION_PASSWORD',
    'PG_MONITOR_PASSWORD',
    'PG_BACKUP_PASSWORD',
    'PG_WAL_PASSWORD',
  ];
  const configuredPasswords = rolePasswordInputs.map((name) => process.env[name]?.trim()).filter(Boolean);
  if (
    configuredPasswords.length === rolePasswordInputs.length &&
    new Set(configuredPasswords).size !== configuredPasswords.length
  ) {
    throw new Error('production PostgreSQL role passwords must be pairwise distinct');
  }

  if (countFragment('docker-compose.server4.yml', 'PGSSLMODE=${PGSSLMODE:?') !== 4) {
    throw new Error('docker-compose.server4.yml must require an explicit PostgreSQL TLS mode for every DB client');
  }
  if (countFragment('docker-compose.staging.yml', 'PGSSLMODE=${PGSSLMODE:?') !== 4) {
    throw new Error('docker-compose.staging.yml must require an explicit PostgreSQL TLS mode for every DB client');
  }
  if (read('docker-compose.staging.yml').includes('PGSSLMODE=disable')) {
    throw new Error('docker-compose.staging.yml must not force plaintext PostgreSQL');
  }
  const staging = read('docker-compose.staging.yml');
  if (/^ {2}(?:postgres|redis):$/m.test(staging)) {
    throw new Error(
      'docker-compose.staging.yml must use external PostgreSQL/Redis instead of bundled plaintext services',
    );
  }
  if (countFragment('docker-compose.staging.yml', 'REDIS_URL=${REDIS_URL:?Set REDIS_URL=rediss://') !== 3) {
    throw new Error('docker-compose.staging.yml must require rediss:// for every Redis client');
  }
  if (countFragment('docker-compose.staging.yml', 'PGSSLROOTCERT=/run/secrets/postgres_ca') !== 4) {
    throw new Error('docker-compose.staging.yml must mount the external PostgreSQL CA into every DB client');
  }
  if (!staging.includes('PG_CA_SECRET_NAME:?Set PG_CA_SECRET_NAME')) {
    throw new Error('docker-compose.staging.yml must require an external PostgreSQL CA secret');
  }
  const monitoring = read('docker-compose.monitoring.yml');
  if (!monitoring.includes('sslmode=${PG_MONITOR_SSLMODE:?') || monitoring.includes('sslmode=disable')) {
    throw new Error('monitoring PostgreSQL TLS mode must be explicit and must not default to disabled');
  }
  if (!monitoring.includes("content: '${METRICS_TOKEN:?")) {
    throw new Error('monitoring Compose must require the shared metrics token');
  }

  for (const relativePath of ['docker-compose.yml', ...RELEASE_COMPOSE_FILES]) {
    for (const variable of [
      'LOGTO_M2M_APP_ID',
      'LOGTO_M2M_APP_SECRET',
      'LOGTO_MANAGEMENT_RESOURCE',
      'LOGTO_MANAGEMENT_SCOPE',
      'ACCOUNT_DELETION_RECOVERY_INTERVAL_MS',
      'ACCOUNT_EXPORT_MAX_BYTES',
    ]) {
      if (countFragment(relativePath, `${variable}=\${${variable}`) !== 1) {
        throw new Error(`${relativePath} must pass ${variable} exactly once to the API runtime`);
      }
    }
  }
  for (const dockerfile of ['Dockerfile', 'Dockerfile.migrate', 'api/Dockerfile']) {
    if (read(dockerfile).includes('LOGTO_M2M_APP_SECRET')) {
      throw new Error(`${dockerfile} must not bake LOGTO_M2M_APP_SECRET into an image`);
    }
  }
  if (!read('.env.example').includes('LOGTO_MANAGEMENT_SCOPE=delete:users')) {
    throw new Error('.env.example must document the least-privilege Logto account deletion scope');
  }
  const retention = read('docker-compose.retention.yml');
  if (!retention.includes('PGSSLMODE: ${PG_RETENTION_SSLMODE:?')) {
    throw new Error('retention worker must require an explicit PostgreSQL TLS mode');
  }
  if (!retention.includes('RETENTION_METRICS_GID:?')) {
    throw new Error('retention worker must declare its metrics group contract');
  }
}

function assertWorkflowContract() {
  const workflow = read('.github/workflows/cd.yml');
  const requiredFragments = [
    'workflow_dispatch:',
    'release_ref:',
    'npm run verify',
    'gh run list --workflow ci.yml --commit',
    'sha256sum',
    'EXPECTED_SCHEMA_CHECKSUM',
    'trivy',
    'cosign verify',
    'gh attestation verify',
    'attest-build-provenance@v2',
    'docker/build-push-action@v6',
    'Dockerfile.retention',
    'RETENTION_IMAGE',
    '@sha256:',
    'verify-compose-role-env.mjs --require-pgsslmode=verify-full --require-rediss',
  ];
  for (const fragment of requiredFragments) {
    if (!workflow.includes(fragment)) throw new Error(`cd.yml is missing release gate: ${fragment}`);
  }
  if (/\bTAG\b/.test(workflow) || /:latest|:staging/.test(workflow)) {
    throw new Error('cd.yml must not deploy mutable TAG/latest/staging references');
  }
  if (
    !read('.github/workflows/ci.yml').includes(
      'verify-compose-role-env.mjs --require-pgsslmode=verify-full --require-rediss',
    )
  ) {
    throw new Error('ci.yml must validate the rendered staging TLS/role environment');
  }
}

function assertReleaseManifestContract() {
  const resolver = read('scripts/resolve-release-manifest.sh');
  const deploy = read('scripts/deploy-server4.sh');
  for (const key of ['RELEASE_SHA', 'APP_VERSION', 'GAME_RULES_VERSION']) {
    if (!resolver.includes(`printf '${key}=%s\\n'`)) {
      throw new Error(`release manifest resolver must emit ${key}`);
    }
    if (!deploy.includes(key)) throw new Error(`deployment manifest validator must require ${key}`);
  }
  if (!deploy.includes('verify-compose-role-env.mjs $ROLE_ENV_VALIDATOR_ARGS')) {
    throw new Error('deployment must validate the rendered PostgreSQL role/TLS environment before migration');
  }
  if (!read('Dockerfile.migrate').includes('COPY scripts/verify-compose-role-env.mjs')) {
    throw new Error('migration image must contain the rendered role environment validator');
  }
}

function assertCosignIdentityPolicy() {
  for (const relativePath of [
    '.github/workflows/cd.yml',
    'scripts/resolve-release-manifest.sh',
    'scripts/deploy-server4.sh',
  ]) {
    const contents = read(relativePath);
    if (!contents.includes('refs/(heads/master|tags/v[0-9]+')) {
      throw new Error(`${relativePath} must trust only master and semver-tag CD identities`);
    }
    if (contents.includes('@refs/.*')) throw new Error(`${relativePath} contains an over-broad Cosign identity policy`);
  }
}

function assertScripts() {
  for (const relativePath of ['scripts/resolve-release-manifest.sh', 'scripts/postgres-init-roles.sh']) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!existsSync(absolutePath)) throw new Error(`missing release script: ${relativePath}`);
    if ((statSync(absolutePath).mode & 0o111) === 0) throw new Error(`${relativePath} must be executable`);
  }
  for (const relativePath of ['ops/systemd/zutomayo-retention.service', 'ops/systemd/zutomayo-retention.timer']) {
    if (!existsSync(path.join(ROOT, relativePath))) throw new Error(`missing release unit: ${relativePath}`);
  }
  if (!existsSync(path.join(ROOT, 'scripts/verify-compose-role-env.mjs'))) {
    throw new Error('missing rendered Compose role environment validator');
  }
  if (!existsSync(path.join(ROOT, 'Dockerfile.retention'))) throw new Error('missing retention worker Dockerfile');
}

export function validateReleaseConfig() {
  for (const relativePath of COMPOSE_FILES) assertNoMutableImageTags(relativePath);
  for (const relativePath of RELEASE_COMPOSE_FILES) assertDigestInputs(relativePath);
  assertRetentionDigestInput();
  assertProductionRuntimeInputs();
  assertWorkflowContract();
  assertReleaseManifestContract();
  assertCosignIdentityPolicy();
  assertScripts();
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateReleaseConfig();
    console.log('release config: valid');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
