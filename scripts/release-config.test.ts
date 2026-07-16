import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
import { findUnpinnedWorkflowActions } from './verify-release-config.mjs';

describe('release configuration contract', () => {
  it('accepts the isolated server4 beta deployment contract', () => {
    const script = resolve(process.cwd(), 'scripts/verify-release-config.mjs');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    expect(output).toContain('release config: valid');
  });

  it('rejects mutable GitHub Action tags while accepting full commit SHAs and local actions', () => {
    expect(
      findUnpinnedWorkflowActions(`
        - uses: actions/checkout@v4
        - uses: docker/login-action@main
        - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        - uses: ./github/actions/local
      `),
    ).toEqual(['actions/checkout@v4', 'docker/login-action@main']);
  });
});
