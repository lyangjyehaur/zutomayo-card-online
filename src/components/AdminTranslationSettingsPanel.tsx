import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Languages, Play, Save } from 'lucide-react';
import {
  adminGetTranslationSettings,
  adminTestTranslationSettings,
  adminUpdateTranslationSettings,
  type AdminTranslationSettings,
  type AdminTranslationTestResult,
} from '../api/client';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FormActions,
  FormField,
  Input,
  LoadingState,
  Panel,
  Select,
  Textarea,
} from '../ui';

const LANGUAGE_OPTIONS = [
  ['ja', '日本語'],
  ['zh-tw', '繁體中文'],
  ['zh-cn', '简体中文'],
  ['zh-hk', '廣東話'],
  ['en', 'English'],
  ['ko', '한국어'],
] as const;

type ApiKeyAction = 'keep' | 'replace' | 'clear' | 'environment';

export function AdminTranslationSettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<AdminTranslationSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [endpoint, setEndpoint] = useState('');
  const [provider, setProvider] = useState('http');
  const [model, setModel] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('10000');
  const [apiKeyAction, setApiKeyAction] = useState<ApiKeyAction>('keep');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [testText, setTestText] = useState('歡迎來到 ZUTOMAYO CARD ONLINE');
  const [sourceLanguage, setSourceLanguage] = useState('zh-tw');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [testResult, setTestResult] = useState<AdminTranslationTestResult | null>(null);

  const applySettings = (next: AdminTranslationSettings) => {
    setSettings(next);
    setEnabled(next.enabled);
    setEndpoint(next.endpoint);
    setProvider(next.provider || 'http');
    setModel(next.model);
    setTimeoutMs(String(next.timeoutMs));
    setApiKeyAction('keep');
    setApiKey('');
  };

  useEffect(() => {
    let cancelled = false;
    adminGetTranslationSettings(token)
      .then((next) => {
        if (!cancelled) applySettings(next);
      })
      .catch(() => {
        if (!cancelled) setError('無法載入翻譯服務設定。');
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
    setStatus('');
    try {
      const next = await adminUpdateTranslationSettings(token, {
        enabled,
        endpoint: endpoint.trim(),
        provider: provider.trim() || 'http',
        model: model.trim(),
        timeoutMs: Number(timeoutMs),
        apiKeyAction,
        ...(apiKeyAction === 'replace' ? { apiKey: apiKey.trim() } : {}),
      });
      applySettings(next);
      setStatus('翻譯服務設定已儲存，新的翻譯請求會自動套用。');
    } catch {
      setError('儲存失敗，請檢查端點、逾時與 API Key 設定。');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      setTestResult(
        await adminTestTranslationSettings(token, {
          text: testText.trim(),
          sourceLanguage,
          targetLanguage,
        }),
      );
    } catch {
      setError('翻譯測試失敗。測試使用目前已儲存的設定，請先儲存後再試。');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <LoadingState className="min-h-64" label="載入翻譯設定" />;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {status && <Alert tone="success">{status}</Alert>}

      <Panel size="lg">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Languages className="size-5 text-accent-primary" aria-hidden="true" />
              <h2 className="font-display text-title-sm font-bold">翻譯服務</h2>
            </div>
            <p className="mt-2 text-body-sm leading-relaxed text-content-muted">
              設定只保存在伺服器。API Key 會加密儲存，前端只會看到來源與末四碼。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={enabled ? 'jade' : 'neutral'}>{enabled ? '已啟用' : '已停用'}</Badge>
            <Badge tone="neutral">{settings?.source === 'admin' ? 'Admin 設定' : '環境變數'}</Badge>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSave}>
          <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)}>
            啟用聊天與公告自動翻譯
          </Checkbox>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField className="md:col-span-2" label="Provider Endpoint">
              <Input
                type="url"
                value={endpoint}
                placeholder="https://example.com/v1/translate"
                required={enabled}
                onChange={(event) => setEndpoint(event.target.value)}
              />
            </FormField>
            <FormField label="Provider">
              <Input value={provider} maxLength={60} onChange={(event) => setProvider(event.target.value)} />
            </FormField>
            <FormField label="Model">
              <Input value={model} maxLength={120} onChange={(event) => setModel(event.target.value)} />
            </FormField>
            <FormField label="Timeout (ms)">
              <Input
                type="number"
                min={1000}
                max={60000}
                required
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </FormField>
            <FormField label="API Key 管理">
              <Select value={apiKeyAction} onChange={(event) => setApiKeyAction(event.target.value as ApiKeyAction)}>
                <option value="keep">保留目前憑證</option>
                <option value="replace">更換並加密儲存</option>
                <option value="environment">改用環境變數</option>
                <option value="clear">清除憑證</option>
              </Select>
            </FormField>
          </div>
          <div className="rounded-sm border border-border-soft bg-surface-canvas/35 p-3 text-caption text-content-muted">
            <span className="inline-flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden="true" />
              目前憑證：
              {settings?.apiKeyConfigured
                ? `${settings.apiKeySource === 'stored' ? '加密儲存' : '環境變數'} · ••••${settings.apiKeySuffix}`
                : '未設定'}
            </span>
          </div>
          {apiKeyAction === 'replace' && (
            <FormField label="新 API Key">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={apiKey}
                maxLength={2000}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </FormField>
          )}
          <FormActions>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              leftIcon={<Save className="size-4" aria-hidden="true" />}
            >
              {saving ? '儲存中…' : '儲存設定'}
            </Button>
          </FormActions>
        </form>
      </Panel>

      <Panel size="lg">
        <div className="mb-4">
          <h2 className="font-display text-title-sm font-bold">即時測試</h2>
          <p className="mt-2 text-body-sm text-content-muted">測試只會傳送下方文字，不會建立公告或聊天記錄。</p>
        </div>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="來源語言">
              <Select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="目標語言">
              <Select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="測試文字">
            <Textarea
              rows={4}
              maxLength={4000}
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
            />
          </FormField>
          <FormActions>
            <Button
              type="button"
              variant="secondary"
              disabled={testing || !testText.trim() || sourceLanguage === targetLanguage}
              leftIcon={<Play className="size-4" aria-hidden="true" />}
              onClick={() => void handleTest()}
            >
              {testing ? '測試中…' : '執行測試'}
            </Button>
          </FormActions>
          {testResult && (
            <div className="rounded-sm border border-accent-primary/35 bg-accent-primary/5 p-4">
              <p className="whitespace-pre-wrap text-body leading-relaxed text-content-primary">
                {testResult.translatedContent}
              </p>
              <p className="mt-3 font-mono text-caption text-content-dim">
                {testResult.provider || 'provider'} {testResult.model ? `· ${testResult.model}` : ''} ·{' '}
                {testResult.latencyMs}ms
              </p>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
