/* global module, process */

const { writeAuditLog } = require('./adminService.cjs');
const { createTranslationService, translationConfig } = require('./translationService.cjs');

const TRANSLATION_INTEGRATION_KEY = 'translation';

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizedStoredConfig(value, fallback) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: config.enabled !== false,
    endpoint: cleanText(config.endpoint, 1000) || fallback.endpoint,
    provider: cleanText(config.provider, 60) || fallback.provider,
    model: cleanText(config.model, 120) || fallback.model,
    timeoutMs: Math.max(1000, Math.min(Number(config.timeoutMs) || fallback.timeoutMs, 60_000)),
    useEnvironmentApiKey: config.useEnvironmentApiKey === true,
  };
}

async function readTranslationIntegration(pool) {
  const result = await pool.query(
    `SELECT config, secret_ciphertext, updated_at
       FROM service_integrations
      WHERE key = $1`,
    [TRANSLATION_INTEGRATION_KEY],
  );
  return result.rows[0] || null;
}

async function resolveTranslationSettings({ pool, env = process.env, decryptSecret, encryptionKey }) {
  const fallback = translationConfig(env);
  const stored = await readTranslationIntegration(pool);
  if (!stored) {
    return {
      ...fallback,
      enabled: Boolean(fallback.endpoint),
      source: 'environment',
      apiKeySource: fallback.apiKey ? 'environment' : 'none',
      updatedAt: null,
    };
  }

  const config = normalizedStoredConfig(stored.config, fallback);
  let apiKey = '';
  let apiKeySource = 'none';
  if (stored.secret_ciphertext) {
    apiKey = decryptSecret(stored.secret_ciphertext, encryptionKey);
    apiKeySource = 'stored';
  } else if (config.useEnvironmentApiKey && fallback.apiKey) {
    apiKey = fallback.apiKey;
    apiKeySource = 'environment';
  }

  return {
    enabled: config.enabled,
    endpoint: config.endpoint,
    provider: config.provider,
    model: config.model,
    timeoutMs: config.timeoutMs,
    apiKey,
    apiKeySource,
    source: 'admin',
    updatedAt: stored.updated_at || null,
  };
}

function adminTranslationSettingsView(settings) {
  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    provider: settings.provider,
    model: settings.model,
    timeoutMs: settings.timeoutMs,
    source: settings.source,
    apiKeyConfigured: Boolean(settings.apiKey),
    apiKeySource: settings.apiKeySource,
    apiKeySuffix: settings.apiKey ? settings.apiKey.slice(-4) : '',
    updatedAt: settings.updatedAt,
  };
}

async function getAdminTranslationSettings(deps) {
  const settings = await resolveTranslationSettings(deps);
  return { ok: true, body: { settings: adminTranslationSettingsView(settings) } };
}

async function updateAdminTranslationSettings({
  pool,
  env = process.env,
  body,
  adminUserId,
  encryptSecret,
  encryptionKey,
  decryptSecret,
}) {
  const existing = await readTranslationIntegration(pool);
  const fallback = translationConfig(env);
  const currentConfig = normalizedStoredConfig(existing?.config, fallback);
  let secretCiphertext = existing?.secret_ciphertext || null;
  let useEnvironmentApiKey = currentConfig.useEnvironmentApiKey;

  if (body.apiKeyAction === 'replace') {
    secretCiphertext = encryptSecret(body.apiKey, encryptionKey);
    useEnvironmentApiKey = false;
  } else if (body.apiKeyAction === 'clear') {
    secretCiphertext = null;
    useEnvironmentApiKey = false;
  } else if (body.apiKeyAction === 'environment') {
    secretCiphertext = null;
    useEnvironmentApiKey = true;
  }

  const config = {
    enabled: body.enabled,
    endpoint: body.endpoint,
    provider: body.provider,
    model: body.model,
    timeoutMs: body.timeoutMs,
    useEnvironmentApiKey,
  };

  await pool.query(
    `INSERT INTO service_integrations (key, config, secret_ciphertext, updated_by_user_id, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET
       config = EXCLUDED.config,
       secret_ciphertext = EXCLUDED.secret_ciphertext,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = NOW()`,
    [TRANSLATION_INTEGRATION_KEY, JSON.stringify(config), secretCiphertext, adminUserId || null],
  );
  await writeAuditLog(pool, {
    adminUserId: adminUserId || null,
    action: 'update_translation_settings',
    targetType: 'service_integration',
    targetId: TRANSLATION_INTEGRATION_KEY,
    details: {
      enabled: config.enabled,
      endpoint: config.endpoint,
      provider: config.provider,
      model: config.model,
      timeoutMs: config.timeoutMs,
      apiKeyAction: body.apiKeyAction,
    },
  });
  return getAdminTranslationSettings({ pool, env, decryptSecret, encryptionKey });
}

function createRuntimeTranslationService({
  pool,
  env = process.env,
  fetchImpl = globalThis.fetch,
  decryptSecret,
  encryptionKey,
  cacheTtlMs = 5_000,
  databaseSettingsEnabled = env.NODE_ENV !== 'test',
}) {
  let cached = null;
  let expiresAt = 0;
  let readDatabaseSettings = databaseSettingsEnabled;

  const loadSettings = async () => {
    if (cached && Date.now() < expiresAt) return cached;
    cached = readDatabaseSettings
      ? await resolveTranslationSettings({ pool, env, decryptSecret, encryptionKey })
      : {
          ...translationConfig(env),
          enabled: Boolean(translationConfig(env).endpoint),
          source: 'environment',
          apiKeySource: translationConfig(env).apiKey ? 'environment' : 'none',
          updatedAt: null,
        };
    expiresAt = Date.now() + cacheTtlMs;
    return cached;
  };

  return {
    async getTranslateText() {
      const settings = await loadSettings();
      if (!settings.enabled) return undefined;
      return createTranslationService(settings, fetchImpl);
    },
    invalidate({ enableDatabaseSettings = false } = {}) {
      if (enableDatabaseSettings) readDatabaseSettings = true;
      cached = null;
      expiresAt = 0;
    },
  };
}

async function testAdminTranslationSettings({ translateText, body }) {
  const startedAt = Date.now();
  try {
    if (typeof translateText !== 'function') throw new Error('Translation provider is not configured');
    const result = await translateText({
      text: body.text,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      purpose: 'admin-test',
      resourceType: 'admin_translation_test',
      maxLength: 4000,
    });
    return {
      ok: true,
      body: {
        translatedContent: result.translatedContent,
        provider: result.provider || '',
        model: result.model || '',
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : 'Translation test failed',
    };
  }
}

module.exports = {
  TRANSLATION_INTEGRATION_KEY,
  adminTranslationSettingsView,
  createRuntimeTranslationService,
  getAdminTranslationSettings,
  readTranslationIntegration,
  resolveTranslationSettings,
  testAdminTranslationSettings,
  updateAdminTranslationSettings,
};
