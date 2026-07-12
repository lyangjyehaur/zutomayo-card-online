'use strict';

const { readFile, readdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const crypto = require('node:crypto');

async function migrationFileChecksum(filePath) {
  return crypto
    .createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function recordMigrationChecksums(pool, migrationsDir) {
  const table = await pool.query("SELECT to_regclass('public.schema_migration_checksums') AS name");
  if (!table.rows[0]?.name) return { recorded: 0 };
  const applied = new Set((await pool.query('SELECT name FROM public.schema_migrations')).rows.map((row) => row.name));
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.js$/.test(file));
  const localNames = new Set(files.map((file) => file.replace(/\.js$/, '')));
  const missingFiles = [...applied].filter((name) => !localNames.has(name)).sort();
  if (missingFiles.length > 0) {
    throw new Error(`Applied migration files are missing from the release: ${missingFiles.join(', ')}`);
  }
  let recordedCount = 0;
  for (const file of files) {
    const name = file.replace(/\.js$/, '');
    if (!applied.has(name)) continue;
    const checksum = await migrationFileChecksum(resolve(migrationsDir, file));
    await pool.query(
      `INSERT INTO public.schema_migration_checksums (name, sha256, recorded_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO NOTHING`,
      [name, checksum],
    );
    const recorded = await pool.query('SELECT sha256 FROM public.schema_migration_checksums WHERE name = $1 LIMIT 1', [
      name,
    ]);
    if (recorded.rows[0]?.sha256 !== checksum) {
      throw new Error(`Applied migration was modified after recording: ${name}`);
    }
    recordedCount += 1;
  }
  await pool.query('DELETE FROM public.schema_migration_checksums WHERE name <> ALL($1::text[])', [
    Array.from(applied),
  ]);
  return { recorded: recordedCount };
}

module.exports = { migrationFileChecksum, recordMigrationChecksums };
