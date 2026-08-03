import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { decryptSecretEnvelope, encryptSecretEnvelope } = require('../adminSecretCrypto.cjs') as {
  decryptSecretEnvelope: (value: string, key: string) => string;
  encryptSecretEnvelope: (value: string, key: string) => string;
};
const { dispatchAdminNotification, getAdminNotificationSettings, updateAdminNotificationSettings } =
  require('../adminNotificationService.cjs') as {
    dispatchAdminNotification: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    getAdminNotificationSettings: (input: Record<string, unknown>) => Promise<{
      body: { settings: Record<string, unknown> };
    }>;
    updateAdminNotificationSettings: (input: Record<string, unknown>) => Promise<unknown>;
  };

const encryptionKey = 'admin-notification-test-key-at-least-32-characters';

function response(ok = true, body = '') {
  return { ok, status: ok ? 200 : 502, text: vi.fn(async () => body) };
}

describe('admin notification service', () => {
  it('encrypts channel credentials and never returns them to the admin client or audit log', async () => {
    let storedCiphertext = '';
    let storedConfig: Record<string, unknown> | null = null;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT config, secret_ciphertext')) {
        return storedConfig ? { rows: [{ config: storedConfig, secret_ciphertext: storedCiphertext }] } : { rows: [] };
      }
      if (sql.includes('INSERT INTO service_integrations')) {
        storedConfig = JSON.parse(String(params?.[1] || '{}')) as Record<string, unknown>;
        storedCiphertext = String(params?.[2] || '');
      }
      return { rows: [] };
    });

    await updateAdminNotificationSettings({
      pool: { query },
      body: {
        timeoutMs: 5000,
        channels: {
          bark: {
            enabled: true,
            serverUrl: 'https://api.day.app',
            deviceKeyAction: 'replace',
            deviceKey: 'bark-device-secret',
          },
          telegram: {
            enabled: true,
            chatId: '12345',
            botTokenAction: 'replace',
            botToken: 'telegram-bot-secret',
          },
          webhook: {
            enabled: true,
            url: 'https://hooks.example.test/admin',
            signingSecretAction: 'replace',
            signingSecret: 'webhook-signing-secret',
          },
        },
      },
      adminUserId: 'admin_1',
      encryptSecret: encryptSecretEnvelope,
      decryptSecret: decryptSecretEnvelope,
      encryptionKey,
    });

    const decrypted = JSON.parse(decryptSecretEnvelope(storedCiphertext, encryptionKey)) as Record<string, string>;
    expect(decrypted).toMatchObject({
      barkDeviceKey: 'bark-device-secret',
      telegramBotToken: 'telegram-bot-secret',
      webhookSecret: 'webhook-signing-secret',
    });
    const view = await getAdminNotificationSettings({
      pool: { query },
      decryptSecret: decryptSecretEnvelope,
      encryptionKey,
    });
    expect(JSON.stringify(view)).not.toContain('telegram-bot-secret');
    expect(
      JSON.stringify(query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'))),
    ).not.toContain('webhook-signing-secret');
  });

  it('delivers to all enabled official channels and signs the custom webhook', async () => {
    const fetchImpl = vi.fn(async () => response());
    const event = {
      version: 1,
      id: 'email_1',
      type: 'support.email.received',
      occurredAt: '2026-08-03T00:00:00.000Z',
      title: '新しいお問い合わせメール',
      message: 'Player <player@example.com>\nカードを選択できません',
      actionUrl: 'https://battle.example/admin/support-inbox',
      data: { emailId: 'email_1' },
    };
    const settings = {
      timeoutMs: 5000,
      channels: {
        bark: { enabled: true, serverUrl: 'https://api.day.app' },
        telegram: { enabled: true, chatId: '12345' },
        webhook: { enabled: true, url: 'https://hooks.example.test/admin' },
      },
      secrets: {
        barkDeviceKey: 'bark-secret',
        telegramBotToken: 'telegram-secret',
        webhookSecret: 'signing-secret',
      },
    };

    await expect(dispatchAdminNotification({ settings, event, fetchImpl })).resolves.toEqual([
      { channel: 'bark', ok: true },
      { channel: 'telegram', ok: true },
      { channel: 'webhook', ok: true },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://api.day.app/push',
      'https://api.telegram.org/bottelegram-secret/sendMessage',
      'https://hooks.example.test/admin',
    ]);
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toMatchObject({
      'X-ZTMY-Notification-Event': 'support.email.received',
      'X-ZTMY-Notification-Id': 'email_1',
      'X-ZTMY-Notification-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
    });
  });

  it('isolates a failing channel so other enabled channels still deliver', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('api.day.app') ? response(false, 'Bark unavailable') : response(),
    );
    const results = await dispatchAdminNotification({
      settings: {
        timeoutMs: 5000,
        channels: {
          bark: { enabled: true, serverUrl: 'https://api.day.app' },
          telegram: { enabled: true, chatId: '12345' },
          webhook: { enabled: false, url: '' },
        },
        secrets: { barkDeviceKey: 'bark-secret', telegramBotToken: 'telegram-secret', webhookSecret: '' },
      },
      event: { id: 'test', type: 'admin.test', title: 'Test', message: 'Test', data: {} },
      fetchImpl,
    });

    expect(results).toEqual([
      { channel: 'bark', ok: false, error: 'Bark unavailable' },
      { channel: 'telegram', ok: true },
    ]);
  });
});
