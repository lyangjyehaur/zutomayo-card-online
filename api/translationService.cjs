/* global AbortController, clearTimeout, module, process, setTimeout */

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function readTranslatedContent(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.translatedContent === 'string') return data.translatedContent;
  if (typeof data.translation === 'string') return data.translation;
  if (typeof data.text === 'string') return data.text;
  if (Array.isArray(data.choices)) {
    const first = data.choices[0];
    if (first?.message && typeof first.message.content === 'string') return first.message.content;
    if (typeof first?.text === 'string') return first.text;
  }
  return '';
}

function translationConfig(env) {
  return {
    endpoint: cleanText(env.TRANSLATION_ENDPOINT || env.CHAT_TRANSLATION_ENDPOINT, 1000),
    provider: cleanText(env.TRANSLATION_PROVIDER || env.CHAT_TRANSLATION_PROVIDER, 60) || 'http',
    model: cleanText(env.TRANSLATION_MODEL || env.CHAT_TRANSLATION_MODEL, 120),
    apiKey: cleanText(env.TRANSLATION_API_KEY || env.CHAT_TRANSLATION_API_KEY, 2000),
    timeoutMs: Math.max(
      1000,
      Math.min(Number(env.TRANSLATION_TIMEOUT_MS || env.CHAT_TRANSLATION_TIMEOUT_MS) || 10_000, 60_000),
    ),
  };
}

function createTranslationService(config, fetchImpl = globalThis.fetch) {
  if (!config.endpoint || typeof fetchImpl !== 'function') return undefined;

  return async function translateText(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          text: input.text,
          sourceLanguage: input.sourceLanguage || '',
          targetLanguage: input.targetLanguage,
          purpose: input.purpose || 'general',
          resourceType: input.resourceType || '',
          resourceId: input.resourceId || '',
          messageId: input.messageId || '',
          conversationId: input.conversationId || '',
          model: config.model,
        }),
      });
      if (!response.ok) throw new Error(`Translation provider returned ${response.status}`);
      const data = await response.json();
      const translatedContent = cleanText(readTranslatedContent(data), Number(input.maxLength) || 4000);
      if (!translatedContent) throw new Error('Translation provider returned empty content');
      return {
        translatedContent,
        provider: cleanText(data.provider, 60) || config.provider,
        model: cleanText(data.model, 120) || config.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

function createTranslationServiceFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  return createTranslationService(translationConfig(env), fetchImpl);
}

module.exports = {
  createTranslationService,
  createTranslationServiceFromEnv,
  readTranslatedContent,
  translationConfig,
};
