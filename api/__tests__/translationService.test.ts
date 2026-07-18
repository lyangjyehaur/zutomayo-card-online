import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createTranslationServiceFromEnv, translationConfig } = require('../translationService.cjs') as {
  createTranslationServiceFromEnv: (
    env: Record<string, string>,
    fetchImpl: typeof fetch,
  ) => ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
  translationConfig: (env: Record<string, string>) => Record<string, unknown>;
};

describe('shared translation service', () => {
  it('prefers generic configuration and keeps legacy chat configuration compatible', () => {
    expect(
      translationConfig({ TRANSLATION_ENDPOINT: 'https://new.test', CHAT_TRANSLATION_ENDPOINT: 'https://old.test' }),
    ).toMatchObject({ endpoint: 'https://new.test' });
    expect(translationConfig({ CHAT_TRANSLATION_ENDPOINT: 'https://old.test' })).toMatchObject({
      endpoint: 'https://old.test',
    });
  });

  it('passes a purpose and resource identity to the common provider', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ translatedContent: 'translated' }),
    })) as unknown as typeof fetch;
    const translate = createTranslationServiceFromEnv({ TRANSLATION_ENDPOINT: 'https://llm.test' }, fetchMock);

    await translate?.({
      text: 'source',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      purpose: 'announcement',
      resourceType: 'announcement',
      resourceId: 'announcement_1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.test',
      expect.objectContaining({
        body: expect.stringContaining('"purpose":"announcement"'),
      }),
    );
  });
});
