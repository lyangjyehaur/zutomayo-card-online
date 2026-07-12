import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

describe('release configuration contract', () => {
  it('rejects mutable deployment references and requires release gates', () => {
    const script = resolve(process.cwd(), 'scripts/verify-release-config.mjs');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    expect(output).toContain('release config: valid');
  });
});
