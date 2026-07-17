import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createChatTranslationProviderFromEnv, readTranslatedContent } = require('../chatTranslationProvider.cjs') as {
  createChatTranslationProviderFromEnv: (
    env?: Record<string, string | undefined>,
    fetchImpl?: typeof fetch,
  ) => ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
  readTranslatedContent: (data: unknown) => string;
};

describe('chat translation provider', () => {
  it('stays disabled when no endpoint is configured', () => {
    expect(createChatTranslationProviderFromEnv({})).toBeUndefined();
  });

  it('posts translation requests to the configured HTTP provider', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        translatedContent: 'hello',
        provider: 'gateway',
        model: 'test-model',
      }),
    })) as unknown as typeof fetch;
    const translate = createChatTranslationProviderFromEnv(
      {
        CHAT_TRANSLATION_ENDPOINT: 'https://llm.example.test/translate',
        CHAT_TRANSLATION_API_KEY: 'secret',
        CHAT_TRANSLATION_PROVIDER: 'gateway',
        CHAT_TRANSLATION_MODEL: 'test-model',
      },
      fetchMock,
    );

    await expect(
      translate?.({
        text: 'こんにちは',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        messageId: 'chat_msg_1',
        conversationId: 'match:bgio-match-1',
      }),
    ).resolves.toEqual({
      translatedContent: 'hello',
      provider: 'gateway',
      model: 'test-model',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example.test/translate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify({
          text: 'こんにちは',
          sourceLanguage: 'ja',
          targetLanguage: 'en',
          purpose: 'general',
          resourceType: '',
          resourceId: '',
          messageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
          model: 'test-model',
        }),
      }),
    );
  });

  it('reads common provider response shapes', () => {
    expect(readTranslatedContent({ translation: 'hello' })).toBe('hello');
    expect(readTranslatedContent({ text: 'hello' })).toBe('hello');
    expect(readTranslatedContent({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });
});
