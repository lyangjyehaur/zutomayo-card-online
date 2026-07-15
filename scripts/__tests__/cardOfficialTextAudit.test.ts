import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const auditScript = resolve('scripts/audit-card-official-texts.ts');

function runAudit(source = resolve('data/card-english-extraction.json')) {
  return spawnSync(process.execPath, ['--import', 'tsx', auditScript, source], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 10_000,
  });
}

describe('signed official card text audit', () => {
  it('accepts the reviewed extraction and its human/override provenance', () => {
    const result = runAudit();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('human-reviewed names 422/422, effects 250/250');
  });

  it('rejects a human_verified value that matches neither review source', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-card-audit-'));
    const source = resolve(directory, 'extraction.json');
    const extraction = JSON.parse(readFileSync(resolve('data/card-english-extraction.json'), 'utf8')) as {
      cards: Array<{ enNameOfficial: string }>;
    };
    extraction.cards[0].enNameOfficial += ' UNREVIEWED';
    writeFileSync(source, JSON.stringify(extraction));

    const result = runAudit(source);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('human-verified English name has no matching review provenance');
  });
});
