import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER4_COMPOSE = 'docker-compose.server4.yml';
const SERVER4_SERVICES = Object.freeze(['migrate', 'game', 'api', 'platform']);
const SERVER4_RUNTIME_SERVICES = Object.freeze(['game', 'api', 'platform']);

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

export function findUnpinnedWorkflowActions(contents) {
  return nonCommentLines(contents).flatMap((line) => {
    const match = line.match(/^(?:-\s*)?uses:\s*([^\s]+)$/);
    if (!match || match[1].startsWith('./')) return [];
    const actionReference = match[1];
    const separator = actionReference.lastIndexOf('@');
    const ref = separator >= 0 ? actionReference.slice(separator + 1) : '';
    return /^[a-f0-9]{40}$/i.test(ref) ? [] : [actionReference];
  });
}

function assertPinnedWorkflowActions() {
  const workflowDirectory = path.join(ROOT, '.github/workflows');
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
  if (workflowFiles.length === 0) throw new Error('no GitHub workflows found');

  for (const name of workflowFiles) {
    const relativePath = `.github/workflows/${name}`;
    const unpinned = findUnpinnedWorkflowActions(read(relativePath));
    if (unpinned.length > 0) {
      throw new Error(
        `${relativePath} contains actions not pinned to full 40-character commit SHAs:\n${unpinned.join('\n')}`,
      );
    }
  }
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

function server4ServiceNames() {
  const compose = read(SERVER4_COMPOSE);
  const serviceSection = compose.match(/^services:\s*\n([\s\S]*?)(?=^\S|^networks:)/m)?.[1];
  if (!serviceSection) throw new Error(`${SERVER4_COMPOSE} has no services section`);
  return [...serviceSection.matchAll(/^ {2}([A-Za-z0-9_.-]+):\s*$/gm)].map((match) => match[1]);
}

function assertRuntimeEnvironmentInventory() {
  const api = serviceBlock(SERVER4_COMPOSE, 'api');
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
      throw new Error(`${SERVER4_COMPOSE} API runtime must explicitly map ${variable}`);
    }
  }
  for (const serviceName of SERVER4_RUNTIME_SERVICES) {
    const block = serviceBlock(SERVER4_COMPOSE, serviceName);
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
        throw new Error(`${SERVER4_COMPOSE} ${serviceName} must explicitly map ${variable}`);
      }
    }
  }

  const game = serviceBlock(SERVER4_COMPOSE, 'game');
  if (!game.includes('${BATTLE_ASSET_DIR:-./public/battle}:/app/dist/battle:ro')) {
    throw new Error(`${SERVER4_COMPOSE} game must mount private battle assets read-only`);
  }
}

function assertServer4BetaCompose() {
  const compose = read(SERVER4_COMPOSE);
  const services = server4ServiceNames();
  if (JSON.stringify(services) !== JSON.stringify(SERVER4_SERVICES)) {
    throw new Error(`${SERVER4_COMPOSE} beta services must be exactly: ${SERVER4_SERVICES.join(', ')}`);
  }

  const forbiddenMaturityInputs = [
    'PG_API_USER',
    'PG_API_PASSWORD',
    'PG_GAME_USER',
    'PG_GAME_PASSWORD',
    'PG_PLATFORM_USER',
    'PG_PLATFORM_PASSWORD',
    'PG_RETENTION_',
    'PG_MONITOR_',
    'PG_BACKUP_',
    'PG_WAL_',
    'REQUIRE_DISTINCT_DB_ROLES',
    'RETENTION_IMAGE',
    '${GAME_IMAGE:?',
    '${API_IMAGE:?',
    '${PLATFORM_IMAGE:?',
    '${MIGRATE_IMAGE:?',
    '@sha256:',
  ];
  for (const input of forbiddenMaturityInputs) {
    if (compose.includes(input)) throw new Error(`${SERVER4_COMPOSE} beta path must not require ${input}`);
  }

  const migrate = serviceBlock(SERVER4_COMPOSE, 'migrate');
  for (const fragment of [
    'dockerfile: Dockerfile.migrate',
    'PG_USER=${PG_MIGRATION_USER:?',
    'PG_PASSWORD=${PG_MIGRATION_PASSWORD:?',
    'PG_APP_USER=${PG_APP_USER:?',
    'PG_APP_PASSWORD=',
    'REQUIRE_APP_ROLE_GATE=true',
    'REQUIRE_ROLE_MATRIX_GATE=false',
    'DATABASE_URL=',
  ]) {
    if (!migrate.includes(fragment)) throw new Error(`${SERVER4_COMPOSE} migrate is missing ${fragment}`);
  }

  for (const serviceName of SERVER4_RUNTIME_SERVICES) {
    const block = serviceBlock(SERVER4_COMPOSE, serviceName);
    for (const fragment of [
      'build:',
      'APP_VERSION=${APP_VERSION:?',
      'APP_BUILD_ID=${APP_BUILD_ID:?',
      'GAME_RULES_VERSION=${GAME_RULES_VERSION:?',
      'PG_USER=${PG_APP_USER:?',
      'PG_PASSWORD=${PG_APP_PASSWORD:?',
      'PG_MIGRATION_PASSWORD=',
      'DATABASE_URL=',
      'RUNTIME_SCHEMA_DDL=false',
      'REDIS_URL=${REDIS_URL:?',
      'REDIS_DB=${REDIS_DB:-0}',
      'EXPECTED_SCHEMA_MIGRATION=${EXPECTED_SCHEMA_MIGRATION:?',
      'EXPECTED_SCHEMA_CHECKSUM=${EXPECTED_SCHEMA_CHECKSUM:?',
      'depends_on:',
      'condition: service_completed_successfully',
      'healthcheck:',
    ]) {
      if (!block.includes(fragment)) throw new Error(`${SERVER4_COMPOSE} ${serviceName} is missing ${fragment}`);
    }
  }

  for (const [fragment, expectedCount] of [
    ['PGSSLMODE=${PGSSLMODE:?', 4],
    ['PG_SSLROOTCERT=${PG_SSLROOTCERT:?', 4],
    ['PG_CA_FILE:?', 4],
    ['EXPECTED_SCHEMA_MIGRATION=${EXPECTED_SCHEMA_MIGRATION:?', 4],
    ['EXPECTED_SCHEMA_CHECKSUM=${EXPECTED_SCHEMA_CHECKSUM:?', 4],
    ['METRICS_TOKEN=${METRICS_TOKEN:?', 3],
  ]) {
    const actualCount = nonCommentLines(compose).filter((line) => line.includes(fragment)).length;
    if (actualCount !== expectedCount) {
      throw new Error(`${SERVER4_COMPOSE} must contain ${expectedCount} instances of ${fragment}`);
    }
  }
  assertRuntimeEnvironmentInventory();
}

function assertServer4DeployScript() {
  const relativePath = 'scripts/deploy-server4.sh';
  const absolutePath = path.join(ROOT, relativePath);
  const deploy = read(relativePath);
  if ((statSync(absolutePath).mode & 0o111) === 0) throw new Error(`${relativePath} must be executable`);

  const requiredFragments = [
    'origin/master',
    'git reset --hard origin/master',
    "find migrations -maxdepth 1 -type f -name '*.js'",
    'APP_BUILD_ID',
    'APP_VERSION',
    'GAME_RULES_VERSION',
    'EXPECTED_SCHEMA_MIGRATION',
    'EXPECTED_SCHEMA_CHECKSUM',
    'pg_dump',
    '--format=custom',
    'pg_restore --list',
    'sha256sum --check',
    'extract_redis_db',
    'CONFIG GET maxmemory-policy',
    'noeviction',
    'docker compose -f',
    'build --pull migrate game api platform',
    'up -d --wait',
    'deploy-smoke.mjs',
    'battle-assets.sha256',
    'sync_battle_assets',
    'release_official_rulings',
    'release-official-rulings.ts',
    '--translations=-',
  ];
  for (const fragment of requiredFragments) {
    if (!deploy.includes(fragment)) throw new Error(`${relativePath} is missing beta safety step: ${fragment}`);
  }

  for (const forbidden of [
    '--manifest',
    '--sha',
    'cosign',
    'attestation',
    'RETENTION_',
    'PG_API_USER',
    'PG_GAME_USER',
    'PG_PLATFORM_USER',
    'PG_MONITOR_USER',
    'PG_BACKUP_USER',
    'PG_WAL_USER',
    '--rollback',
    'rollback_and_smoke',
    '.env.previous',
    '$COMPOSE_FILE.previous',
    ':rollback',
  ]) {
    if (deploy.includes(forbidden)) throw new Error(`${relativePath} beta path must not require ${forbidden}`);
  }
}

function assertWorkflowContract() {
  const ci = read('.github/workflows/ci.yml');
  for (const fragment of [
    'PG_MIGRATION_USER:',
    'PG_MIGRATION_PASSWORD:',
    'PG_APP_USER:',
    'PG_APP_PASSWORD:',
    'docker compose -f docker-compose.server4.yml config --no-env-resolution --quiet',
    'npm run release:config',
  ]) {
    if (!ci.includes(fragment)) throw new Error(`ci.yml is missing server4 beta contract: ${fragment}`);
  }
  for (const forbidden of [
    'docker-compose.server4.yml config --no-env-resolution --format json | node scripts/verify-compose-role-env.mjs',
    'Fresh PostgreSQL role matrix smoke',
    'docker compose -f docker-compose.retention.yml',
  ]) {
    if (ci.includes(forbidden)) throw new Error(`ci.yml must not block beta on deferred gate: ${forbidden}`);
  }

  const cd = read('.github/workflows/cd.yml');
  for (const fragment of [
    'branches: [codex/deferred-production-hardening]',
    "if: github.ref == 'refs/heads/codex/deferred-production-hardening'",
  ]) {
    if (!cd.includes(fragment)) {
      throw new Error(`cd.yml must restrict deferred immutable release jobs to hardening: ${fragment}`);
    }
  }
}

export function validateReleaseConfig() {
  assertServer4BetaCompose();
  assertServer4DeployScript();
  assertPinnedWorkflowActions();
  assertWorkflowContract();
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
