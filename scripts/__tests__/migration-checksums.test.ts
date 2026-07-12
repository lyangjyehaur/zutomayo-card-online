import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { recordMigrationChecksums } = require('../migration-checksums.cjs') as {
  recordMigrationChecksums: (
    pool: { query: ReturnType<typeof vi.fn> },
    migrationsDir: string,
  ) => Promise<{ recorded: number }>;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function migrationFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'migration-checksum-'));
  temporaryDirectories.push(directory);
  const contents = 'export const up = () => undefined;\n';
  await writeFile(join(directory, '000001_initial.js'), contents);
  return { directory, checksum: createHash('sha256').update(contents).digest('hex') };
}

describe('migration checksum recorder', () => {
  it('records an applied migration once and verifies the immutable digest', async () => {
    const { directory, checksum } = await migrationFixture();
    const recorded = new Map<string, string>();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('to_regclass')) return { rows: [{ name: 'schema_migration_checksums' }] };
      if (sql === 'SELECT name FROM public.schema_migrations') return { rows: [{ name: '000001_initial' }] };
      if (sql.includes('INSERT INTO public.schema_migration_checksums')) {
        recorded.set(String(params?.[0]), recorded.get(String(params?.[0])) ?? String(params?.[1]));
        return { rows: [] };
      }
      if (sql.includes('SELECT sha256')) return { rows: [{ sha256: recorded.get(String(params?.[0])) }] };
      return { rows: [] };
    });

    await expect(recordMigrationChecksums({ query }, directory)).resolves.toEqual({ recorded: 1 });
    expect(recorded.get('000001_initial')).toBe(checksum);
  });

  it('fails when an already-applied migration file changes', async () => {
    const { directory } = await migrationFixture();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ name: 'schema_migration_checksums' }] };
      if (sql === 'SELECT name FROM public.schema_migrations') return { rows: [{ name: '000001_initial' }] };
      if (sql.includes('SELECT sha256')) return { rows: [{ sha256: 'f'.repeat(64) }] };
      return { rows: [] };
    });

    await expect(recordMigrationChecksums({ query }, directory)).rejects.toThrow('modified after recording');
  });

  it('fails when the database contains an applied migration missing from the release', async () => {
    const { directory } = await migrationFixture();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ name: 'schema_migration_checksums' }] };
      if (sql === 'SELECT name FROM public.schema_migrations') {
        return { rows: [{ name: '000001_initial' }, { name: '000002_missing' }] };
      }
      return { rows: [] };
    });

    await expect(recordMigrationChecksums({ query }, directory)).rejects.toThrow(
      'Applied migration files are missing from the release: 000002_missing',
    );
  });
});
