#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { Pool } = require('pg');
const { ADMIN_CREDENTIAL_MODES, ADMIN_ROLES, mutateAdminCredentials } = require('../api/adminCredentialService.cjs');
const { encryptAdminTotpSecret, randomBase32 } = require('../api/adminSecretCrypto.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

const pbkdf2 = util.promisify(crypto.pbkdf2);
const VALID_MODES = new Set(ADMIN_CREDENTIAL_MODES);
const VALID_ROLES = new Set(ADMIN_ROLES);
const VALID_ARGUMENTS = new Set(['mode', 'username', 'role', 'totp-output-file']);

function argument(name, argv) {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function assertCliArguments(argv) {
  const seen = new Set();
  for (const value of argv) {
    const match = /^--([a-z-]+)=/.exec(value);
    if (!match) throw new Error('admin credential arguments must use --name=value syntax');
    if (!VALID_ARGUMENTS.has(match[1])) throw new Error(`unknown admin credential argument: --${match[1]}`);
    if (seen.has(match[1])) throw new Error(`duplicate admin credential argument: --${match[1]}`);
    seen.add(match[1]);
  }
}

function readSecretInput(env, name, fsModule = fs) {
  const direct = String(env[name] || '');
  const fileName = String(env[`${name}_FILE`] || '').trim();
  if (direct && fileName) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  if (!fileName) return direct;

  const descriptor = fsModule.openSync(fileName, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const metadata = fsModule.fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`${name}_FILE must be a regular file`);
    if ((metadata.mode & 0o077) !== 0) throw new Error(`${name}_FILE must not be accessible by group or other users`);
    return fsModule.readFileSync(descriptor, 'utf8').trim();
  } finally {
    fsModule.closeSync(descriptor);
  }
}

function writeGeneratedTotpSecret(outputFile, secret, fsModule = fs) {
  if (!outputFile) {
    throw new Error(
      'generated TOTP requires --totp-output-file=<absolute path>; the secret is never printed to stdout',
    );
  }
  if (!path.isAbsolute(outputFile)) throw new Error('--totp-output-file must be an absolute path');

  const descriptor = fsModule.openSync(outputFile, 'wx', 0o600);
  try {
    fsModule.fchmodSync(descriptor, 0o600);
    fsModule.writeFileSync(descriptor, `${secret}\n`, { encoding: 'utf8' });
    fsModule.fsyncSync(descriptor);
    const metadata = fsModule.fstatSync(descriptor);
    if ((metadata.mode & 0o777) !== 0o600) throw new Error('TOTP output file permissions must be 0600');
  } catch (error) {
    try {
      fsModule.closeSync(descriptor);
    } finally {
      fsModule.rmSync(outputFile, { force: true });
    }
    throw error;
  }
  fsModule.closeSync(descriptor);
}

function prepareTotpSecret({ env, outputFile, fsModule = fs }) {
  const configuredSecret = readSecretInput(env, 'ADMIN_BOOTSTRAP_TOTP_SECRET', fsModule);
  if (configuredSecret) {
    if (outputFile) {
      throw new Error('--totp-output-file cannot be combined with ADMIN_BOOTSTRAP_TOTP_SECRET or its file input');
    }
    const normalizedSecret = configuredSecret.toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z2-7]{32,128}$/.test(normalizedSecret)) {
      throw new Error('ADMIN_BOOTSTRAP_TOTP_SECRET must be an unpadded base32 secret of at least 160 bits');
    }
    return { secret: normalizedSecret, generatedOutputFile: '' };
  }

  const secret = randomBase32();
  writeGeneratedTotpSecret(outputFile, secret, fsModule);
  return { secret, generatedOutputFile: outputFile };
}

function poolConfig(env, migrationUser) {
  const databaseUrl = env === process.env ? postgresConnectionString(process.env) : postgresConnectionString(env);
  return {
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: env.PG_HOST,
          port: Number(env.PG_PORT) || 5432,
          user: env.PG_USER || migrationUser,
          password: env.PG_PASSWORD,
          database: env.PG_DATABASE,
        }),
    ssl: env === process.env ? postgresSslConfig(process.env) : postgresSslConfig(env),
  };
}

async function run({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  PoolClass = Pool,
  fsModule = fs,
} = {}) {
  assertCliArguments(argv);
  const mode = (argument('mode', argv) || 'create').trim().toLowerCase();
  const username = argument('username', argv).trim().toLowerCase();
  const role = argument('role', argv).trim().toLowerCase();
  const outputFile = argument('totp-output-file', argv).trim();
  const password = readSecretInput(env, 'ADMIN_BOOTSTRAP_PASSWORD', fsModule);
  const encryptionSecret = env.ADMIN_TOTP_ENCRYPTION_KEY || '';
  if (!VALID_MODES.has(mode)) throw new Error('--mode must be create, rotate, or recover');
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw new Error('--username must be 3-80 safe characters');
  if (role && !VALID_ROLES.has(role)) throw new Error('--role must be viewer, moderator, operator, or admin');
  if (password.length < 16) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 16 characters');
  const migrationUser =
    env === process.env
      ? assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER')
      : assertPostgresExpectedRole(env, 'PG_MIGRATION_USER');

  let generatedOutputFile = '';
  let mutationCommitted = false;
  let pool;

  try {
    const preparedTotp = prepareTotpSecret({ env, outputFile, fsModule });
    generatedOutputFile = preparedTotp.generatedOutputFile;
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await pbkdf2(password, salt, 100_000, 64, 'sha512')).toString('hex');
    const ciphertext = encryptAdminTotpSecret(preparedTotp.secret, encryptionSecret);
    pool = new PoolClass(poolConfig(env, migrationUser));
    const result = await mutateAdminCredentials({
      pool,
      mode,
      username,
      role,
      passwordHash,
      salt,
      totpSecretCiphertext: ciphertext,
    });
    mutationCommitted = true;

    stdout.write(`Admin ${result.username} ${mode} completed with role ${result.role}.\n`);
    if (mode !== 'create') stdout.write(`Revoked ${result.sessionsRevoked} active admin session(s).\n`);
    if (generatedOutputFile) {
      stdout.write(
        `TOTP bootstrap material written to ${generatedOutputFile} with mode 0600; delete after enrollment.\n`,
      );
    }
  } finally {
    if (!mutationCommitted && generatedOutputFile) fsModule.rmSync(generatedOutputFile, { force: true });
    if (pool) await pool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertCliArguments,
  poolConfig,
  prepareTotpSecret,
  readSecretInput,
  run,
  writeGeneratedTotpSecret,
};
