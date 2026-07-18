/* global module */

const { createTranslationServiceFromEnv, readTranslatedContent } = require('./translationService.cjs');

const createChatTranslationProviderFromEnv = createTranslationServiceFromEnv;

module.exports = {
  createChatTranslationProviderFromEnv,
  readTranslatedContent,
};
