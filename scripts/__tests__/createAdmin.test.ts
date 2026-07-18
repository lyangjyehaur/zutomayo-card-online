import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { assertCliArguments, prepareTotpSecret, readSecretInput, run } = require('../create-admin.cjs') as {
  assertCliArguments: (argv: string[]) => void;
  prepareTotpSecret: (input: { env: NodeJS.ProcessEnv; outputFile: string }) => {
    secret: string;
    generatedOutputFile: string;
  };
  readSecretInput: (env: NodeJS.ProcessEnv, name: string) => string;
  run: (input: Record<string, unknown>) => Promise<void>;
};

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zutomayo-admin-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('create admin CLI secret handling', () => {
  it('rejects unknown or positional arguments before a default role can be applied', () => {
    expect(() => assertCliArguments(['--username=operator', '--rol=viewer'])).toThrow('--rol');
    expect(() => assertCliArguments(['operator'])).toThrow('--name=value');
    expect(() => assertCliArguments(['--username=first', '--username=second'])).toThrow('duplicate');
  });

  it('requires an explicit secure file when it generates the TOTP secret', () => {
    expect(() => prepareTotpSecret({ env: {}, outputFile: '' })).toThrow('the secret is never printed to stdout');
  });

  it('writes generated bootstrap material once with owner-only permissions', () => {
    const outputFile = path.join(temporaryDirectory(), 'operator.totp');
    const result = prepareTotpSecret({ env: {}, outputFile });
    const metadata = fs.statSync(outputFile);

    expect(result.generatedOutputFile).toBe(outputFile);
    expect(fs.readFileSync(outputFile, 'utf8').trim()).toBe(result.secret);
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(() => prepareTotpSecret({ env: {}, outputFile })).toThrow();
  });

  it('accepts file-backed inputs only when group and other users cannot read them', () => {
    const secureFile = path.join(temporaryDirectory(), 'password');
    fs.writeFileSync(secureFile, 'a-secure-bootstrap-password\n', { mode: 0o600 });
    expect(readSecretInput({ ADMIN_BOOTSTRAP_PASSWORD_FILE: secureFile }, 'ADMIN_BOOTSTRAP_PASSWORD')).toBe(
      'a-secure-bootstrap-password',
    );

    fs.chmodSync(secureFile, 0o640);
    expect(() => readSecretInput({ ADMIN_BOOTSTRAP_PASSWORD_FILE: secureFile }, 'ADMIN_BOOTSTRAP_PASSWORD')).toThrow(
      'must not be accessible by group or other users',
    );
  });

  it('rejects weak or malformed operator-supplied TOTP material', () => {
    expect(() => prepareTotpSecret({ env: { ADMIN_BOOTSTRAP_TOTP_SECRET: 'not-base32' }, outputFile: '' })).toThrow(
      'at least 160 bits',
    );
  });

  it('never includes generated TOTP or password material in ordinary stdout', async () => {
    const outputFile = path.join(temporaryDirectory(), 'operator.totp');
    const stdout = { write: vi.fn() };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes('INSERT INTO admin_users')) {
        return {
          rows: [{ id: 'admin_0123456789abcdef', username: 'operator', role: 'operator', disabled_at: null }],
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const end = vi.fn();
    class FakePool {
      async connect() {
        return { query, release };
      }

      async end() {
        await end();
      }
    }

    await run({
      argv: ['--mode=create', '--username=operator', '--role=operator', `--totp-output-file=${outputFile}`],
      env: {
        ADMIN_BOOTSTRAP_PASSWORD: 'bootstrap-password-marker',
        ADMIN_TOTP_ENCRYPTION_KEY: 'admin-totp-encryption-key-marker-32-characters',
        PG_MIGRATION_USER: 'migration_role',
        PG_USER: 'migration_role',
      },
      stdout,
      PoolClass: FakePool,
    });

    const generatedSecret = fs.readFileSync(outputFile, 'utf8').trim();
    const ordinaryOutput = stdout.write.mock.calls.flat().join('');
    expect(ordinaryOutput).not.toContain(generatedSecret);
    expect(ordinaryOutput).not.toContain('bootstrap-password-marker');
    expect(ordinaryOutput).toContain(outputFile);
    expect(end).toHaveBeenCalledOnce();
  });

  it('removes generated bootstrap material when the database mutation does not commit', async () => {
    const outputFile = path.join(temporaryDirectory(), 'operator.totp');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'operator', disabled_at: null }],
        };
      }
      return { rows: [] };
    });
    const end = vi.fn();
    class FakePool {
      async connect() {
        return { query, release: vi.fn() };
      }

      async end() {
        await end();
      }
    }

    await expect(
      run({
        argv: ['--mode=create', '--username=operator', '--role=operator', `--totp-output-file=${outputFile}`],
        env: {
          ADMIN_BOOTSTRAP_PASSWORD: 'bootstrap-password-marker',
          ADMIN_TOTP_ENCRYPTION_KEY: 'admin-totp-encryption-key-marker-32-characters',
          PG_MIGRATION_USER: 'migration_role',
          PG_USER: 'migration_role',
        },
        stdout: { write: vi.fn() },
        PoolClass: FakePool,
      }),
    ).rejects.toThrow('already exists');
    expect(fs.existsSync(outputFile)).toBe(false);
    expect(end).toHaveBeenCalledOnce();
  });
});
