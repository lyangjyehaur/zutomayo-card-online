import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { decryptSecretEnvelope, encryptSecretEnvelope } = require('../adminSecretCrypto.cjs') as {
  decryptSecretEnvelope: (value: string, key: string) => string;
  encryptSecretEnvelope: (value: string, key: string) => string;
};
const { createRuntimeTranslationService, getAdminTranslationSettings, updateAdminTranslationSettings } =
  require('../translationSettingsService.cjs') as {
    createRuntimeTranslationService: (input: Record<string, unknown>) => {
      getTranslateText: () => Promise<
        ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined
      >;
      invalidate: (options?: { enableDatabaseSettings?: boolean }) => void;
    };
    getAdminTranslationSettings: (input: Record<string, unknown>) => Promise<{
      ok: boolean;
      body: { settings: Record<string, unknown> };
    }>;
    updateAdminTranslationSettings: (input: Record<string, unknown>) => Promise<unknown>;
  };

const encryptionKey = 'translation-settings-test-key-at-least-32-characters';

describe('admin translation settings', () => {
  it('uses an encrypted stored key without exposing it to the admin response', async () => {
    const ciphertext = encryptSecretEnvelope('provider-secret-key', encryptionKey);
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            config: {
              enabled: true,
              endpoint: 'https://translate.test',
              provider: 'custom',
              model: 'model-1',
              timeoutMs: 9000,
              useEnvironmentApiKey: false,
            },
            secret_ciphertext: ciphertext,
            updated_at: '2026-07-19T00:00:00.000Z',
          },
        ],
      })),
    };
    const response = await getAdminTranslationSettings({
      pool,
      env: {},
      decryptSecret: decryptSecretEnvelope,
      encryptionKey,
    });

    expect(response.body.settings).toMatchObject({
      apiKeyConfigured: true,
      apiKeySource: 'stored',
      apiKeySuffix: '-key',
    });
    expect(JSON.stringify(response)).not.toContain('provider-secret-key');
  });

  it('applies runtime settings and sends the stored key only from the server', async () => {
    const ciphertext = encryptSecretEnvelope('provider-secret-key', encryptionKey);
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            config: {
              enabled: true,
              endpoint: 'https://translate.test',
              provider: 'custom',
              model: 'model-1',
              timeoutMs: 9000,
              useEnvironmentApiKey: false,
            },
            secret_ciphertext: ciphertext,
            updated_at: null,
          },
        ],
      })),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ translatedContent: 'translated' }),
    }));
    const runtime = createRuntimeTranslationService({
      pool,
      env: {},
      fetchImpl: fetchMock,
      decryptSecret: decryptSecretEnvelope,
      encryptionKey,
      cacheTtlMs: 1000,
      databaseSettingsEnabled: true,
    });
    const translate = await runtime.getTranslateText();

    await translate?.({ text: 'source', sourceLanguage: 'ja', targetLanguage: 'en' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://translate.test',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer provider-secret-key' }) }),
    );
  });

  it('encrypts replacement keys and excludes them from audit details', async () => {
    let storedCiphertext = '';
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT config, secret_ciphertext')) {
        return storedCiphertext
          ? {
              rows: [
                {
                  config: {
                    enabled: true,
                    endpoint: 'https://translate.test',
                    provider: 'custom',
                    model: 'model-1',
                    timeoutMs: 10000,
                    useEnvironmentApiKey: false,
                  },
                  secret_ciphertext: storedCiphertext,
                  updated_at: null,
                },
              ],
            }
          : { rows: [] };
      }
      if (sql.includes('INSERT INTO service_integrations')) {
        storedCiphertext = String(params?.[2] || '');
      }
      return { rows: [] };
    });

    await updateAdminTranslationSettings({
      pool: { query },
      env: {},
      body: {
        enabled: true,
        endpoint: 'https://translate.test',
        provider: 'custom',
        model: 'model-1',
        timeoutMs: 10000,
        apiKeyAction: 'replace',
        apiKey: 'replacement-secret',
      },
      adminUserId: 'admin_1',
      encryptSecret: encryptSecretEnvelope,
      decryptSecret: decryptSecretEnvelope,
      encryptionKey,
    });

    expect(storedCiphertext).toMatch(/^v1\./);
    expect(storedCiphertext).not.toContain('replacement-secret');
    expect(decryptSecretEnvelope(storedCiphertext, encryptionKey)).toBe('replacement-secret');
    const auditCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'));
    expect(JSON.stringify(auditCall)).not.toContain('replacement-secret');
  });
});
