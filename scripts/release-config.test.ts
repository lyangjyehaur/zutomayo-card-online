import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
import { findUnpinnedWorkflowActions, findUnreviewedWorkflowActions } from './verify-release-config.mjs';

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

  it('requires the reviewed workflow action commits and rejects unknown actions', () => {
    expect(
      findUnreviewedWorkflowActions(`
        - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        - uses: actions/upload-artifact@v7
        - uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
        - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
        - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
        - uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a
        - uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25
        - uses: example/unreviewed-action@1111111111111111111111111111111111111111
        - uses: ./github/actions/local
      `),
    ).toEqual([
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 (required actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0)',
      'actions/upload-artifact@v7 (required actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a)',
      'docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 (required docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a)',
      'example/unreviewed-action@1111111111111111111111111111111111111111 (action is not in the reviewed workflow allowlist)',
    ]);
  });
});
