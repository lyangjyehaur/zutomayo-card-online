import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
import { findOutdatedCoreWorkflowActions, findUnpinnedWorkflowActions } from './verify-release-config.mjs';

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
        - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        - uses: ./github/actions/local
      `),
    ).toEqual(['actions/checkout@v4', 'docker/login-action@main']);
  });

  it('requires the reviewed Node 24 core action commits', () => {
    expect(
      findOutdatedCoreWorkflowActions(`
        - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        - uses: actions/setup-node@v7
        - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
        - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
      `),
    ).toEqual([
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 (required actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0)',
      'actions/setup-node@v7 (required actions/setup-node@820762786026740c76f36085b0efc47a31fe5020)',
    ]);
  });
});
