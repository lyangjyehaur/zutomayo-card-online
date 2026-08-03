import { useEffect, useState, type FormEvent } from 'react';
import { BellRing, KeyRound, Save, Send } from 'lucide-react';
import {
  adminGetNotificationSettings,
  adminTestNotificationSettings,
  adminUpdateNotificationSettings,
  type AdminNotificationSettings,
  type AdminNotificationTestResult,
} from '../api/client';
import { Alert, Badge, Button, Checkbox, FormActions, FormField, Input, LoadingState, Panel, Select } from '../ui';

type CredentialAction = 'keep' | 'replace' | 'clear';

function credentialLabel(credential: { configured: boolean; suffix: string } | undefined) {
  return credential?.configured ? `已加密儲存 · ••••${credential.suffix}` : '未設定';
}

function resultLabel(channel: AdminNotificationTestResult['results'][number]['channel']) {
  return channel === 'bark' ? 'Bark' : channel === 'telegram' ? 'Telegram' : 'Webhook';
}

export function AdminNotificationSettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<AdminNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState<AdminNotificationTestResult | null>(null);
  const [timeoutMs, setTimeoutMs] = useState('8000');
  const [barkEnabled, setBarkEnabled] = useState(false);
  const [barkServerUrl, setBarkServerUrl] = useState('https://api.day.app');
  const [barkAction, setBarkAction] = useState<CredentialAction>('keep');
  const [barkDeviceKey, setBarkDeviceKey] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramAction, setTelegramAction] = useState<CredentialAction>('keep');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookAction, setWebhookAction] = useState<CredentialAction>('keep');
  const [webhookSecret, setWebhookSecret] = useState('');

  const applySettings = (next: AdminNotificationSettings) => {
    setSettings(next);
    setTimeoutMs(String(next.timeoutMs));
    setBarkEnabled(next.channels.bark.enabled);
    setBarkServerUrl(next.channels.bark.serverUrl);
    setTelegramEnabled(next.channels.telegram.enabled);
    setTelegramChatId(next.channels.telegram.chatId);
    setWebhookEnabled(next.channels.webhook.enabled);
    setWebhookUrl(next.channels.webhook.url);
    setBarkAction('keep');
    setTelegramAction('keep');
    setWebhookAction('keep');
    setBarkDeviceKey('');
    setTelegramBotToken('');
    setWebhookSecret('');
  };

  useEffect(() => {
    let cancelled = false;
    adminGetNotificationSettings(token)
      .then((next) => {
        if (!cancelled) applySettings(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '無法載入通知設定。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    setTestResult(null);
    try {
      const next = await adminUpdateNotificationSettings(token, {
        timeoutMs: Number(timeoutMs),
        channels: {
          bark: {
            enabled: barkEnabled,
            serverUrl: barkServerUrl.trim(),
            deviceKeyAction: barkAction,
            ...(barkAction === 'replace' ? { deviceKey: barkDeviceKey.trim() } : {}),
          },
          telegram: {
            enabled: telegramEnabled,
            chatId: telegramChatId.trim(),
            botTokenAction: telegramAction,
            ...(telegramAction === 'replace' ? { botToken: telegramBotToken.trim() } : {}),
          },
          webhook: {
            enabled: webhookEnabled,
            url: webhookUrl.trim(),
            signingSecretAction: webhookAction,
            ...(webhookAction === 'replace' ? { signingSecret: webhookSecret.trim() } : {}),
          },
        },
      });
      applySettings(next);
      setNotice('通知設定已儲存，下一封新郵件會立即使用這組設定。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知設定儲存失敗。');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError('');
    setNotice('');
    setTestResult(null);
    try {
      setTestResult(await adminTestNotificationSettings(token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '測試通知發送失敗。');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <LoadingState className="min-h-64" label="載入通知設定" />;

  const enabledCount = [barkEnabled, telegramEnabled, webhookEnabled].filter(Boolean).length;
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {testResult && (
        <Alert tone={testResult.results.every((result) => result.ok) ? 'success' : 'warning'}>
          {testResult.results.length === 0
            ? '目前沒有啟用的通知渠道。'
            : testResult.results
                .map((result) => `${resultLabel(result.channel)}：${result.ok ? '成功' : result.error || '失敗'}`)
                .join(' · ')}
        </Alert>
      )}

      <Panel size="lg">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing className="size-5 text-accent-primary" aria-hidden="true" />
            <h2 className="font-display text-title-sm font-bold">管理員通知渠道</h2>
          </div>
          <Badge tone={enabledCount ? 'jade' : 'neutral'}>
            {enabledCount ? `已啟用 ${enabledCount} 個` : '全部停用'}
          </Badge>
        </div>

        <form className="grid gap-5" onSubmit={handleSave}>
          <FormField label="連線逾時（ms）">
            <Input
              type="number"
              min={1000}
              max={30000}
              required
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
            />
          </FormField>

          <section className="grid gap-3 border-t border-border-soft pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={barkEnabled} onChange={(event) => setBarkEnabled(event.target.checked)}>
                Bark
              </Checkbox>
              <Badge tone={barkEnabled ? 'jade' : 'neutral'}>{barkEnabled ? '啟用' : '停用'}</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Bark Server URL">
                <Input
                  type="url"
                  required={barkEnabled}
                  value={barkServerUrl}
                  onChange={(event) => setBarkServerUrl(event.target.value)}
                />
              </FormField>
              <FormField label="Device Key 管理">
                <Select value={barkAction} onChange={(event) => setBarkAction(event.target.value as CredentialAction)}>
                  <option value="keep">保留目前憑證</option>
                  <option value="replace">更換並加密儲存</option>
                  <option value="clear">清除憑證</option>
                </Select>
              </FormField>
            </div>
            <div className="text-caption text-content-muted">
              <KeyRound className="mr-2 inline size-4" aria-hidden="true" />
              {credentialLabel(settings?.channels.bark.deviceKey)}
            </div>
            {barkAction === 'replace' && (
              <FormField label="新 Device Key">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={barkDeviceKey}
                  onChange={(event) => setBarkDeviceKey(event.target.value)}
                />
              </FormField>
            )}
          </section>

          <section className="grid gap-3 border-t border-border-soft pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={telegramEnabled} onChange={(event) => setTelegramEnabled(event.target.checked)}>
                Telegram
              </Checkbox>
              <Badge tone={telegramEnabled ? 'jade' : 'neutral'}>{telegramEnabled ? '啟用' : '停用'}</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Chat ID">
                <Input
                  required={telegramEnabled}
                  value={telegramChatId}
                  onChange={(event) => setTelegramChatId(event.target.value)}
                />
              </FormField>
              <FormField label="Bot Token 管理">
                <Select
                  value={telegramAction}
                  onChange={(event) => setTelegramAction(event.target.value as CredentialAction)}
                >
                  <option value="keep">保留目前憑證</option>
                  <option value="replace">更換並加密儲存</option>
                  <option value="clear">清除憑證</option>
                </Select>
              </FormField>
            </div>
            <div className="text-caption text-content-muted">
              <KeyRound className="mr-2 inline size-4" aria-hidden="true" />
              {credentialLabel(settings?.channels.telegram.botToken)}
            </div>
            {telegramAction === 'replace' && (
              <FormField label="新 Bot Token">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                />
              </FormField>
            )}
          </section>

          <section className="grid gap-3 border-t border-border-soft pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={webhookEnabled} onChange={(event) => setWebhookEnabled(event.target.checked)}>
                自訂 Webhook
              </Checkbox>
              <Badge tone={webhookEnabled ? 'jade' : 'neutral'}>{webhookEnabled ? '啟用' : '停用'}</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Webhook URL">
                <Input
                  type="url"
                  required={webhookEnabled}
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
              </FormField>
              <FormField label="Signing Secret 管理">
                <Select
                  value={webhookAction}
                  onChange={(event) => setWebhookAction(event.target.value as CredentialAction)}
                >
                  <option value="keep">保留目前憑證</option>
                  <option value="replace">更換並加密儲存</option>
                  <option value="clear">清除憑證</option>
                </Select>
              </FormField>
            </div>
            <div className="text-caption text-content-muted">
              <KeyRound className="mr-2 inline size-4" aria-hidden="true" />
              {credentialLabel(settings?.channels.webhook.signingSecret)}
            </div>
            {webhookAction === 'replace' && (
              <FormField label="新 Signing Secret">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={webhookSecret}
                  onChange={(event) => setWebhookSecret(event.target.value)}
                />
              </FormField>
            )}
          </section>

          <FormActions>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              leftIcon={<Save className="size-4" aria-hidden="true" />}
            >
              {saving ? '儲存中…' : '儲存設定'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={testing}
              onClick={handleTest}
              leftIcon={<Send className="size-4" aria-hidden="true" />}
            >
              {testing ? '發送中…' : '發送測試通知'}
            </Button>
          </FormActions>
        </form>
      </Panel>
    </div>
  );
}
