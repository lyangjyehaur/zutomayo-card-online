import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateLogtoAccountDeletionConfig } = require('../accountDeletionConfig.cjs') as {
  validateLogtoAccountDeletionConfig: (env: NodeJS.ProcessEnv) => boolean;
};

const productionConfig = {
  NODE_ENV: 'production',
  LOGTO_ENDPOINT: 'https://auth.example.com',
  LOGTO_M2M_APP_ID: 'account-deletion-worker',
  LOGTO_M2M_APP_SECRET: 'runtime-secret',
  LOGTO_MANAGEMENT_RESOURCE: 'https://auth.example.com/api',
  LOGTO_MANAGEMENT_SCOPE: 'delete:users',
};

describe('Logto account deletion production configuration', () => {
  it('accepts a dedicated M2M client with only the user-delete scope', () => {
    expect(validateLogtoAccountDeletionConfig(productionConfig)).toBe(true);
  });

  it('fails closed when credentials or the explicit management resource are missing', () => {
    expect(() => validateLogtoAccountDeletionConfig({ ...productionConfig, LOGTO_M2M_APP_SECRET: '' })).toThrow(
      'configured together',
    );
    expect(() => validateLogtoAccountDeletionConfig({ ...productionConfig, LOGTO_MANAGEMENT_RESOURCE: '' })).toThrow(
      'LOGTO_MANAGEMENT_RESOURCE',
    );
  });

  it('allows the beta deployment to explicitly disable Logto deletion recovery', () => {
    expect(
      validateLogtoAccountDeletionConfig({
        NODE_ENV: 'production',
        LOGTO_ENDPOINT: 'https://auth.example.com',
        ACCOUNT_DELETION_RECOVERY_ENABLED: 'false',
      }),
    ).toBe(true);
  });

  it('rejects broad or additional management scopes', () => {
    expect(() => validateLogtoAccountDeletionConfig({ ...productionConfig, LOGTO_MANAGEMENT_SCOPE: 'all' })).toThrow(
      'exactly delete:users',
    );
    expect(() =>
      validateLogtoAccountDeletionConfig({ ...productionConfig, LOGTO_MANAGEMENT_SCOPE: 'delete:users all' }),
    ).toThrow('exactly delete:users');
  });
});
