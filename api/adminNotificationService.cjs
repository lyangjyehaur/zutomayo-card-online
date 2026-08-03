/* global module, fetch, AbortSignal */

const crypto = require('crypto');
const { writeAuditLog } = require('./adminService.cjs');

const ADMIN_NOTIFICATION_INTEGRATION_KEY = 'admin_notifications';
const DEFAULT_BARK_SERVER_URL = 'https://api.day.app';
const DEFAULT_TIMEOUT_MS = 8_000;

class AdminNotificationError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AdminNotificationError';
    this.status = status;
  }
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanUrl(value, { fallback = '', required = false } = {}) {
  const raw = cleanText(value, 1000) || fallback;
  if (!raw && !required) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new AdminNotificationError('Notification endpoint must be a valid HTTP(S) URL', 400);
  }
}

function emptySecrets() {
  return { barkDeviceKey: '', telegramBotToken: '', webhookSecret: '' };
}

function parseSecrets(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptySecrets();
    return {
      barkDeviceKey: cleanText(parsed.barkDeviceKey, 500),
      telegramBotToken: cleanText(parsed.telegramBotToken, 500),
      webhookSecret: cleanText(parsed.webhookSecret, 1000),
    };
  } catch {
    throw new AdminNotificationError('Stored notification credentials are invalid', 500);
  }
}

function normalizeConfig(value) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
  const bark = channels.bark && typeof channels.bark === 'object' ? channels.bark : {};
  const telegram = channels.telegram && typeof channels.telegram === 'object' ? channels.telegram : {};
  const webhook = channels.webhook && typeof channels.webhook === 'object' ? channels.webhook : {};
  return {
    timeoutMs: Math.max(1_000, Math.min(Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS, 30_000)),
    channels: {
      bark: {
        enabled: bark.enabled === true,
        serverUrl: cleanUrl(bark.serverUrl, { fallback: DEFAULT_BARK_SERVER_URL }),
      },
      telegram: {
        enabled: telegram.enabled === true,
        chatId: cleanText(telegram.chatId, 200),
      },
      webhook: {
        enabled: webhook.enabled === true,
        url: cleanUrl(webhook.url),
      },
    },
  };
}

async function readAdminNotificationIntegration(pool) {
  const result = await pool.query(
    `SELECT config, secret_ciphertext, updated_at
       FROM service_integrations
      WHERE key = $1`,
    [ADMIN_NOTIFICATION_INTEGRATION_KEY],
  );
  return result.rows[0] || null;
}

async function resolveAdminNotificationSettings({ pool, decryptSecret, encryptionKey }) {
  const stored = await readAdminNotificationIntegration(pool);
  const config = normalizeConfig(stored?.config);
  const secrets = stored?.secret_ciphertext
    ? parseSecrets(decryptSecret(stored.secret_ciphertext, encryptionKey))
    : emptySecrets();
  return { ...config, secrets, updatedAt: stored?.updated_at || null };
}

function credentialView(value) {
  return { configured: Boolean(value), suffix: value ? value.slice(-4) : '' };
}

function adminNotificationSettingsView(settings) {
  return {
    timeoutMs: settings.timeoutMs,
    updatedAt: settings.updatedAt,
    channels: {
      bark: {
        ...settings.channels.bark,
        deviceKey: credentialView(settings.secrets.barkDeviceKey),
      },
      telegram: {
        ...settings.channels.telegram,
        botToken: credentialView(settings.secrets.telegramBotToken),
      },
      webhook: {
        ...settings.channels.webhook,
        signingSecret: credentialView(settings.secrets.webhookSecret),
      },
    },
  };
}

async function getAdminNotificationSettings(deps) {
  const settings = await resolveAdminNotificationSettings(deps);
  return { ok: true, body: { settings: adminNotificationSettingsView(settings) } };
}

function replaceCredential(current, action, replacement, label) {
  if (action === 'keep') return current;
  if (action === 'clear') return '';
  const next = cleanText(replacement, 1000);
  if (!next) throw new AdminNotificationError(`${label} is required`, 400);
  return next;
}

function validateEnabledChannels(settings) {
  if (settings.channels.bark.enabled && !settings.secrets.barkDeviceKey) {
    throw new AdminNotificationError('Bark device key is required when Bark is enabled', 400);
  }
  if (settings.channels.telegram.enabled && !settings.channels.telegram.chatId) {
    throw new AdminNotificationError('Telegram chat ID is required when Telegram is enabled', 400);
  }
  if (settings.channels.telegram.enabled && !settings.secrets.telegramBotToken) {
    throw new AdminNotificationError('Telegram bot token is required when Telegram is enabled', 400);
  }
  if (settings.channels.webhook.enabled && !settings.channels.webhook.url) {
    throw new AdminNotificationError('Webhook URL is required when Webhook is enabled', 400);
  }
}

async function updateAdminNotificationSettings({
  pool,
  body,
  adminUserId,
  encryptSecret,
  decryptSecret,
  encryptionKey,
}) {
  const current = await resolveAdminNotificationSettings({ pool, decryptSecret, encryptionKey });
  const config = normalizeConfig(body);
  const secrets = {
    barkDeviceKey: replaceCredential(
      current.secrets.barkDeviceKey,
      body.channels.bark.deviceKeyAction,
      body.channels.bark.deviceKey,
      'Bark device key',
    ),
    telegramBotToken: replaceCredential(
      current.secrets.telegramBotToken,
      body.channels.telegram.botTokenAction,
      body.channels.telegram.botToken,
      'Telegram bot token',
    ),
    webhookSecret: replaceCredential(
      current.secrets.webhookSecret,
      body.channels.webhook.signingSecretAction,
      body.channels.webhook.signingSecret,
      'Webhook signing secret',
    ),
  };
  validateEnabledChannels({ ...config, secrets });
  const secretCiphertext = Object.values(secrets).some(Boolean)
    ? encryptSecret(JSON.stringify(secrets), encryptionKey)
    : null;

  await pool.query(
    `INSERT INTO service_integrations (key, config, secret_ciphertext, updated_by_user_id, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET
       config = EXCLUDED.config,
       secret_ciphertext = EXCLUDED.secret_ciphertext,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = NOW()`,
    [ADMIN_NOTIFICATION_INTEGRATION_KEY, JSON.stringify(config), secretCiphertext, adminUserId || null],
  );
  await writeAuditLog(pool, {
    adminUserId: adminUserId || null,
    action: 'update_admin_notification_settings',
    targetType: 'service_integration',
    targetId: ADMIN_NOTIFICATION_INTEGRATION_KEY,
    details: {
      timeoutMs: config.timeoutMs,
      channels: {
        bark: { enabled: config.channels.bark.enabled, serverUrl: config.channels.bark.serverUrl },
        telegram: { enabled: config.channels.telegram.enabled, chatId: config.channels.telegram.chatId },
        webhook: { enabled: config.channels.webhook.enabled, url: config.channels.webhook.url },
      },
      credentialActions: {
        bark: body.channels.bark.deviceKeyAction,
        telegram: body.channels.telegram.botTokenAction,
        webhook: body.channels.webhook.signingSecretAction,
      },
    },
  });
  return getAdminNotificationSettings({ pool, decryptSecret, encryptionKey });
}

async function postJson(url, body, { timeoutMs, headers = {}, fetchImpl = fetch }) {
  const payload = JSON.stringify(body);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'request timed out' : 'request failed');
  }
  if (!response.ok) {
    const detail = cleanText(await response.text().catch(() => ''), 300);
    throw new Error(detail || `HTTP ${response.status || 'error'}`);
  }
  return payload;
}

async function deliverChannel(channel, settings, event, fetchImpl) {
  const { title, message, actionUrl } = event;
  if (channel === 'bark') {
    await postJson(
      `${settings.channels.bark.serverUrl}/push`,
      {
        device_key: settings.secrets.barkDeviceKey,
        title,
        body: message,
        group: 'ZTMYCardOnline',
        ...(actionUrl ? { url: actionUrl } : {}),
      },
      { timeoutMs: settings.timeoutMs, fetchImpl },
    );
    return;
  }
  if (channel === 'telegram') {
    await postJson(
      `https://api.telegram.org/bot${settings.secrets.telegramBotToken}/sendMessage`,
      {
        chat_id: settings.channels.telegram.chatId,
        text: [title, message, actionUrl].filter(Boolean).join('\n\n'),
        disable_web_page_preview: true,
      },
      { timeoutMs: settings.timeoutMs, fetchImpl },
    );
    return;
  }
  const payload = JSON.stringify(event);
  const signature = settings.secrets.webhookSecret
    ? `sha256=${crypto.createHmac('sha256', settings.secrets.webhookSecret).update(payload).digest('hex')}`
    : '';
  await postJson(settings.channels.webhook.url, event, {
    timeoutMs: settings.timeoutMs,
    fetchImpl,
    headers: {
      'X-ZTMY-Notification-Event': event.type,
      'X-ZTMY-Notification-Id': event.id,
      ...(signature ? { 'X-ZTMY-Notification-Signature': signature } : {}),
    },
  });
}

async function dispatchAdminNotification({ settings, event, fetchImpl = fetch }) {
  const channels = ['bark', 'telegram', 'webhook'].filter((channel) => settings.channels[channel].enabled);
  const settled = await Promise.allSettled(
    channels.map((channel) => deliverChannel(channel, settings, event, fetchImpl)),
  );
  return channels.map((channel, index) => {
    const result = settled[index];
    return result.status === 'fulfilled'
      ? { channel, ok: true }
      : { channel, ok: false, error: result.reason instanceof Error ? result.reason.message : 'delivery failed' };
  });
}

function normalizeNotificationEvent(event) {
  return {
    version: 1,
    id: cleanText(event.id, 300) || crypto.randomUUID(),
    type: cleanText(event.type, 120) || 'admin.test',
    occurredAt: cleanText(event.occurredAt, 100) || new Date().toISOString(),
    title: cleanText(event.title, 300),
    message: cleanText(event.message, 4000),
    actionUrl: cleanText(event.actionUrl, 1000),
    data: event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {},
  };
}

function createAdminNotificationRuntime({ pool, decryptSecret, encryptionKey, fetchImpl = fetch }) {
  return {
    async notify(event) {
      const settings = await resolveAdminNotificationSettings({ pool, decryptSecret, encryptionKey });
      return dispatchAdminNotification({ settings, event: normalizeNotificationEvent(event), fetchImpl });
    },
  };
}

async function testAdminNotificationSettings({ runtime, publicBaseUrl = '' }) {
  const results = await runtime.notify({
    id: `admin-test-${Date.now()}`,
    type: 'admin.notification.test',
    title: 'ZTMYCardOnline 通知測試',
    message: '管理員通知渠道設定正常。',
    actionUrl: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/admin/notifications` : '',
    data: { test: true },
  });
  return { ok: true, body: { results } };
}

module.exports = {
  ADMIN_NOTIFICATION_INTEGRATION_KEY,
  AdminNotificationError,
  adminNotificationSettingsView,
  createAdminNotificationRuntime,
  dispatchAdminNotification,
  getAdminNotificationSettings,
  normalizeNotificationEvent,
  resolveAdminNotificationSettings,
  testAdminNotificationSettings,
  updateAdminNotificationSettings,
};
