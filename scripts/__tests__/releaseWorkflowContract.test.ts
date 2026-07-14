import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type ReleaseConfigModule = {
  validateCdDeploymentWorkflowContract(workflow: string): true;
  validateComposeValidationFixtureContract(workflow: string, workflowName: string, stepName: string): true;
};

// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
const releaseConfig = (await import('../verify-release-config.mjs')) as ReleaseConfigModule;
const { validateCdDeploymentWorkflowContract, validateComposeValidationFixtureContract } = releaseConfig;

const root = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(resolve(root, '.github/workflows/cd.yml'), 'utf8');
const ciWorkflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');

describe('CD release workflow contract', () => {
  it('uses exact release tags, master ancestry, and a production-only candidate slot stage', () => {
    expect(validateCdDeploymentWorkflowContract(workflow)).toBe(true);
  });

  it('rejects ambiguous manual production refs and missing master ancestry', () => {
    const ambiguousTag = workflow.replace("format('refs/tags/{0}', inputs.release_ref)", 'inputs.release_ref');
    expect(() => validateCdDeploymentWorkflowContract(ambiguousTag)).toThrow('production release contract');

    const noMasterAncestry = workflow.replace(
      'git merge-base --is-ancestor "$SHA" "$MASTER_REF"',
      'echo "master ancestry skipped"',
    );
    expect(() => validateCdDeploymentWorkflowContract(noMasterAncestry)).toThrow('production release contract');
  });

  it('rejects the legacy production Compose deployment path', () => {
    const legacyProduction = workflow.replace(
      './scripts/deploy-server4-canary.sh stage-slot --slot "$PRODUCTION_SLOT" --manifest .release.env --confirm',
      'COMPOSE_FILE=docker-compose.server4.yml ./scripts/deploy-server4.sh --manifest .release.env',
    );
    expect(() => validateCdDeploymentWorkflowContract(legacyProduction)).toThrow(/production release contract|legacy/);
  });
});

describe('Compose validation workflow fixtures', () => {
  const requiredVariables = ['PUBLIC_BASE_URL', 'OAUTH_PUBLIC_BASE_URL', 'PLATFORM_PUBLIC_ADDRESS'];

  it.each([
    ['ci.yml', ciWorkflow, 'Validate Compose configuration'],
    ['cd.yml', workflow, 'Validate deployment Compose files'],
  ])('keeps %s fixture inputs complete', (workflowName, workflowContents, stepName) => {
    expect(validateComposeValidationFixtureContract(workflowContents, workflowName, stepName)).toBe(true);
    for (const variable of requiredVariables) {
      const withoutVariable = workflowContents.replace(new RegExp(`^\\s+${variable}:.*\\n`, 'm'), '');
      expect(() => validateComposeValidationFixtureContract(withoutVariable, workflowName, stepName)).toThrow(variable);
    }
  });
});
