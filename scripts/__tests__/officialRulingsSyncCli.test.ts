import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'scripts/__tests__/fixtures/official-rulings');

describe('official rulings sync CLI fixtures', () => {
  it('runs without network access and writes a machine-readable diff report', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'official-rulings-sync-'));
    const reportPath = path.join(temp, 'report.json');
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/sync-official-rulings.ts',
          '--check',
          '--baseline-empty',
          `--fixture-dir=${fixtureDir}`,
          `--report=${reportPath}`,
        ],
        { cwd: root, encoding: 'utf8' },
      );
      expect(result.status).toBe(2);
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, Record<string, unknown>>;
      expect(report.qa).toMatchObject({ remote: 1, changed: true });
      expect(report.errata).toMatchObject({ remote: 1, changed: true });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
