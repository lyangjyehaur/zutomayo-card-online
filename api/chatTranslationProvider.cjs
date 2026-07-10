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

function createChatTranslationProviderFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const endpoint = cleanText(env.CHAT_TRANSLATION_ENDPOINT, 1000);
  if (!endpoint || typeof fetchImpl !== 'function') return undefined;

  const provider = cleanText(env.CHAT_TRANSLATION_PROVIDER, 60) || 'http';
  const model = cleanText(env.CHAT_TRANSLATION_MODEL, 120);
  const apiKey = cleanText(env.CHAT_TRANSLATION_API_KEY, 2000);
  const timeoutMs = Math.max(1000, Math.min(Number(env.CHAT_TRANSLATION_TIMEOUT_MS) || 10_000, 60_000));

  return async function translateChatMessage(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          text: input.text,
          sourceLanguage: input.sourceLanguage || '',
          targetLanguage: input.targetLanguage,
          messageId: input.messageId,
          conversationId: input.conversationId,
          model,
        }),
      });
      if (!response.ok) throw new Error(`Translation provider returned ${response.status}`);
      const data = await response.json();
      const translatedContent = cleanText(readTranslatedContent(data), 4000);
      if (!translatedContent) throw new Error('Translation provider returned empty content');
      return {
        translatedContent,
        provider: cleanText(data.provider, 60) || provider,
        model: cleanText(data.model, 120) || model,
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = {
  createChatTranslationProviderFromEnv,
  readTranslatedContent,
};
