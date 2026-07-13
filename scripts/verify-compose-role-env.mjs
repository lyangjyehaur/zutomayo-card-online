import { readFileSync } from 'node:fs';

const SERVICE_ROLES = Object.freeze({
  migrate: { user: 'PG_MIGRATION_USER', password: 'PG_MIGRATION_PASSWORD' },
  game: { user: 'PG_GAME_USER', password: 'PG_GAME_PASSWORD' },
  api: { user: 'PG_API_USER', password: 'PG_API_PASSWORD' },
  platform: { user: 'PG_PLATFORM_USER', password: 'PG_PLATFORM_PASSWORD' },
});

const ROLE_PASSWORDS = Object.freeze([
  'PG_MIGRATION_PASSWORD',
  'PG_APP_PASSWORD',
  'PG_API_PASSWORD',
  'PG_GAME_PASSWORD',
  'PG_PLATFORM_PASSWORD',
  'PG_RETENTION_PASSWORD',
  'PG_MONITOR_PASSWORD',
  'PG_BACKUP_PASSWORD',
  'PG_WAL_PASSWORD',
]);

function parseArguments(argv) {
  let inputPath = '';
  let requiredPgSslMode = '';
  let requireRediss = false;
  for (const argument of argv) {
    if (argument.startsWith('--input=')) inputPath = argument.slice('--input='.length);
    else if (argument.startsWith('--require-pgsslmode=')) {
      requiredPgSslMode = argument.slice('--require-pgsslmode='.length);
    } else if (argument === '--require-rediss') {
      requireRediss = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { inputPath, requiredPgSslMode, requireRediss };
}

function normalizedEnvironment(serviceName, service) {
  if (!service || typeof service !== 'object') throw new Error(`rendered Compose is missing service: ${serviceName}`);
  const environment = service.environment;
  if (!environment || Array.isArray(environment) || typeof environment !== 'object') {
    throw new Error(`rendered Compose service ${serviceName} must have a mapping environment`);
  }
  return environment;
}

export function validateRenderedRoleEnvironment(composeConfig, { requiredPgSslMode = '', requireRediss = false } = {}) {
  const config = typeof composeConfig === 'string' ? JSON.parse(composeConfig) : composeConfig;
  if (!config || typeof config !== 'object' || !config.services || typeof config.services !== 'object') {
    throw new Error('rendered Compose JSON must contain services');
  }

  const canonicalUsers = [];
  const canonicalPasswords = [];
  for (const [serviceName, role] of Object.entries(SERVICE_ROLES)) {
    const environment = normalizedEnvironment(serviceName, config.services[serviceName]);
    const canonicalUser = String(environment.PG_USER || '');
    const canonicalPassword = String(environment.PG_PASSWORD || '');
    if (!canonicalUser) throw new Error(`${serviceName} must have a non-empty PG_USER`);
    if (!canonicalPassword) throw new Error(`${serviceName} must have a non-empty PG_PASSWORD`);
    if (environment.DATABASE_URL !== '') {
      throw new Error(`${serviceName} must clear DATABASE_URL so it cannot bypass the role-bound PG_* credentials`);
    }
    if (requireRediss && serviceName !== 'migrate' && !String(environment.REDIS_URL || '').startsWith('rediss://')) {
      throw new Error(`${serviceName} must use an authenticated TLS Redis URL (rediss://)`);
    }

    const namedUser = String(environment[role.user] || '');
    if (!namedUser) throw new Error(`${serviceName} must have a non-empty ${role.user}`);
    if (namedUser !== canonicalUser) {
      throw new Error(`${serviceName} PG_USER must match ${role.user}`);
    }
    const namedPassword = environment[role.password];
    if (namedPassword !== undefined && namedPassword !== '' && namedPassword !== canonicalPassword) {
      throw new Error(`${serviceName} PG_PASSWORD must match ${role.password}`);
    }

    for (const variable of ROLE_PASSWORDS) {
      if (variable === role.password) continue;
      if (environment[variable] !== undefined && environment[variable] !== '') {
        throw new Error(`${serviceName} must not receive non-own ${variable}`);
      }
    }

    if (requiredPgSslMode && environment.PGSSLMODE !== requiredPgSslMode) {
      throw new Error(`${serviceName} must use PGSSLMODE=${requiredPgSslMode}`);
    }
    canonicalUsers.push(canonicalUser);
    canonicalPasswords.push(canonicalPassword);
  }

  if (new Set(canonicalUsers).size !== canonicalUsers.length) {
    throw new Error('rendered runtime and migration PostgreSQL users must be pairwise distinct');
  }
  if (new Set(canonicalPasswords).size !== canonicalPasswords.length) {
    throw new Error('rendered runtime and migration PostgreSQL passwords must be pairwise distinct');
  }
  return true;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && process.argv[1].endsWith('verify-compose-role-env.mjs')) {
  try {
    const { inputPath, requiredPgSslMode, requireRediss } = parseArguments(process.argv.slice(2));
    const contents = inputPath ? readFileSync(inputPath, 'utf8') : await readStdin();
    if (!contents.trim()) throw new Error('rendered Compose JSON input is empty');
    validateRenderedRoleEnvironment(contents, { requiredPgSslMode, requireRediss });
    console.log('rendered PostgreSQL role environment: valid');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
