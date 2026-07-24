import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Languages, RefreshCw, Save, Sparkles } from 'lucide-react';
import {
  adminCheckOfficialSources,
  adminGenerateOfficialTranslation,
  adminGetOfficialSyncStatus,
  adminGetOfficialTranslations,
  adminUpdateOfficialTranslation,
  type AdminOfficialResourceType,
  type AdminOfficialSyncRun,
  type AdminOfficialTranslationCoverage,
  type AdminOfficialTranslationItem,
  type AdminOfficialTranslationStatus,
} from '../api/client';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  Panel,
  SearchInput,
  Select,
  Textarea,
} from '../ui';

const LOCALES = [
  ['zh-TW', '繁體中文'],
  ['zh-HK', '廣東話'],
  ['zh-CN', '简体中文'],
  ['en', 'English'],
  ['ko', '한국어'],
] as const;

const STATUS_LABELS: Record<AdminOfficialTranslationStatus, string> = {
  pending_review: '待處理',
  machine: '機器翻譯',
  verified: '已人工複核',
  failed: '生成失敗',
};

const EMPTY_COVERAGE: AdminOfficialTranslationCoverage = {
  total: 0,
  translated: 0,
  verified: 0,
  pending: 0,
  failed: 0,
};

function draftFor(item: AdminOfficialTranslationItem | null) {
  return {
    ...item?.translation,
    status: item?.status || ('pending_review' as AdminOfficialTranslationStatus),
    provider: item?.provider || '',
    model: item?.model || '',
    reviewNote: item?.reviewNote || '',
  };
}

function syncSummary(run: AdminOfficialSyncRun | undefined) {
  if (!run) return '尚未從管理端檢查官方來源';
  if (run.status === 'running') return '來源檢查進行中';
  if (run.status === 'failed') return `來源檢查失敗：${run.error || '未知錯誤'}`;
  if (run.status === 'no_change') return '官方來源與資料庫內容一致';
  const groups = ['qa', 'errata'] as const;
  const changed = groups.flatMap((group) => {
    const diff = run.diff[group] || {};
    return [...(diff.added || []), ...(diff.updated || []), ...(diff.removed || [])];
  });
  return `偵測到 ${changed.length} 筆來源差異，請先以同步 CLI 審查並套用。`;
}

export function AdminOfficialRulingsPanel() {
  const [locale, setLocale] = useState('zh-TW');
  const [resourceType, setResourceType] = useState<'all' | AdminOfficialResourceType>('all');
  const [status, setStatus] = useState<'' | AdminOfficialTranslationStatus>('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AdminOfficialTranslationItem[]>([]);
  const [coverage, setCoverage] = useState(EMPTY_COVERAGE);
  const [syncRuns, setSyncRuns] = useState<AdminOfficialSyncRun[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>(draftFor(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selected = useMemo(
    () => items.find((item) => `${item.resourceType}:${item.id}` === selectedId) || null,
    [items, selectedId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [translations, runs] = await Promise.all([
        adminGetOfficialTranslations({ locale, resourceType, status, query }),
        adminGetOfficialSyncStatus(),
      ]);
      setItems(translations.items);
      setCoverage(translations.coverage);
      setSyncRuns(runs);
      const currentId = selectedIdRef.current;
      const currentStillExists = translations.items.some((item) => `${item.resourceType}:${item.id}` === currentId);
      const next = currentStillExists
        ? translations.items.find((item) => `${item.resourceType}:${item.id}` === currentId) || null
        : translations.items[0] || null;
      setSelectedId(next ? `${next.resourceType}:${next.id}` : '');
      setDraft(draftFor(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '官方規則管理資料載入失敗');
    } finally {
      setLoading(false);
    }
  }, [locale, query, resourceType, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 200);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selectItem = (item: AdminOfficialTranslationItem) => {
    setSelectedId(`${item.resourceType}:${item.id}`);
    setDraft(draftFor(item));
    setError('');
    setSuccess('');
  };

  const updateDraft = (key: string, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSuccess('');
  };

  const save = async () => {
    if (!selected) return;
    setSaving('save');
    setError('');
    setSuccess('');
    try {
      const content: Record<string, string> = {};
      if (selected.resourceType === 'qa') {
        content.question = draft.question || '';
        content.answer = draft.answer || '';
      } else {
        content.incorrectText = draft.incorrectText || '';
        content.reason = draft.reason || '';
        content.replacementPolicy = draft.replacementPolicy || '';
        content.usagePolicy = draft.usagePolicy || '';
      }
      await adminUpdateOfficialTranslation(selected, locale, {
        ...content,
        status: draft.status || 'pending_review',
        provider: draft.provider || '',
        model: draft.model || '',
        reviewNote: draft.reviewNote || '',
      });
      setSuccess('翻譯已儲存並寫入管理稽核紀錄。');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '翻譯儲存失敗');
    } finally {
      setSaving('');
    }
  };

  const generate = async () => {
    if (!selected) return;
    setSaving('generate');
    setError('');
    setSuccess('');
    try {
      await adminGenerateOfficialTranslation(selected, locale);
      setSuccess('已產生機器翻譯，請核對日文原文後再標記為已複核。');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '機器翻譯生成失敗');
    } finally {
      setSaving('');
    }
  };

  const checkSources = async () => {
    setSaving('sync');
    setError('');
    setSuccess('');
    try {
      const run = await adminCheckOfficialSources();
      setSuccess(syncSummary(run));
      setSyncRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '官方來源檢查失敗');
      await adminGetOfficialSyncStatus()
        .then(setSyncRuns)
        .catch(() => undefined);
    } finally {
      setSaving('');
    }
  };

  const latestRun = syncRuns[0];

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <Panel size="lg" className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Languages className="size-5 text-accent-primary" aria-hidden="true" />
              <h2 className="font-display text-xl font-bold">官方規則翻譯</h2>
            </div>
            <p className="mt-1 text-body-sm text-content-muted">
              日文是權威來源；機器翻譯必須人工核對後才能升級為 verified。
            </p>
          </div>
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className={`size-4 ${saving === 'sync' ? 'animate-spin' : ''}`} aria-hidden="true" />}
            disabled={Boolean(saving)}
            onClick={() => void checkSources()}
          >
            檢查官方來源
          </Button>
        </div>
        <Alert tone={latestRun?.status === 'failed' ? 'danger' : latestRun?.status === 'changes' ? 'warning' : 'info'}>
          {syncSummary(latestRun)}
          {latestRun?.startedAt && ` · ${new Date(latestRun.startedAt).toLocaleString()}`}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Badge>總計 {coverage.total}</Badge>
          <Badge tone="gold">已有翻譯 {coverage.translated}</Badge>
          <Badge tone="jade">已複核 {coverage.verified}</Badge>
          {coverage.failed > 0 && <Badge tone="vermilion">失敗 {coverage.failed}</Badge>}
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <FormField label="語言">
            <Select value={locale} onChange={(event) => setLocale(event.target.value)}>
              {LOCALES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="內容類型">
            <Select
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value as 'all' | AdminOfficialResourceType)}
            >
              <option value="all">全部</option>
              <option value="qa">Q&A</option>
              <option value="errata">勘誤</option>
            </Select>
          </FormField>
          <FormField label="翻譯狀態">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as '' | AdminOfficialTranslationStatus)}
            >
              <option value="">全部</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="搜尋">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="編號或內容" />
          </FormField>
        </div>
      </Panel>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {success && <Alert tone="success">{success}</Alert>}

      {loading ? (
        <LoadingState label="載入官方規則翻譯" />
      ) : items.length === 0 ? (
        <EmptyState title="沒有符合條件的內容" />
      ) : (
        <div className="grid min-h-[36rem] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <Panel className="min-w-0 overflow-hidden" size="md">
            <div className="grid max-h-[70vh] gap-1 overflow-y-auto">
              {items.map((item) => {
                const active = `${item.resourceType}:${item.id}` === selectedId;
                return (
                  <button
                    key={`${item.resourceType}:${item.id}`}
                    type="button"
                    className={`rounded-sm border px-3 py-2 text-left transition ${active ? 'border-accent-primary bg-accent-primary/10' : 'border-border-soft bg-surface-base/40 hover:border-border-strong'}`}
                    onClick={() => selectItem(item)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <strong className="font-mono text-caption text-accent-primary">{item.label}</strong>
                      <Badge
                        tone={item.status === 'verified' ? 'jade' : item.status === 'failed' ? 'vermilion' : 'gold'}
                      >
                        {STATUS_LABELS[item.status]}
                      </Badge>
                    </span>
                    <span className="mt-2 line-clamp-2 text-body-sm text-content-muted">
                      {item.source.question || item.cardName || item.source.incorrectText}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>

          {selected && (
            <Panel className="min-w-0" size="lg">
              <div className="grid gap-5">
                <div>
                  <p className="font-mono text-caption text-accent-primary">
                    {selected.label} · content v{selected.contentVersion} · {locale}
                  </p>
                  {selected.cardName && <h3 className="mt-1 font-display text-lg font-bold">{selected.cardName}</h3>}
                </div>
                {Object.entries(selected.source).map(([key, value]) => (
                  <div
                    key={`source:${key}`}
                    className="grid gap-2 rounded-sm border border-border-soft bg-surface-base/40 p-3"
                  >
                    <span className="font-mono text-caption uppercase text-content-dim">日文原文 · {key}</span>
                    <p className="whitespace-pre-line text-body-sm leading-relaxed text-content-primary">{value}</p>
                  </div>
                ))}
                {Object.keys(selected.source).map((key) => (
                  <FormField key={`translation:${key}`} label={`翻譯 · ${key}`}>
                    <Textarea
                      rows={key === 'answer' || key === 'usagePolicy' ? 7 : 4}
                      value={draft[key] || ''}
                      onChange={(event) => updateDraft(key, event.target.value)}
                    />
                  </FormField>
                ))}
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label="狀態">
                    <Select value={draft.status} onChange={(event) => updateDraft('status', event.target.value)}>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Provider">
                    <Input
                      value={draft.provider || ''}
                      onChange={(event) => updateDraft('provider', event.target.value)}
                    />
                  </FormField>
                  <FormField label="Model">
                    <Input value={draft.model || ''} onChange={(event) => updateDraft('model', event.target.value)} />
                  </FormField>
                </div>
                <FormField label="複核備註">
                  <Textarea
                    rows={3}
                    value={draft.reviewNote || ''}
                    onChange={(event) => updateDraft('reviewNote', event.target.value)}
                  />
                </FormField>
                <FormActions>
                  <Button
                    variant="secondary"
                    leftIcon={<Sparkles className="size-4" aria-hidden="true" />}
                    disabled={Boolean(saving)}
                    onClick={() => void generate()}
                  >
                    {saving === 'generate' ? '生成中…' : '重新產生機器翻譯'}
                  </Button>
                  <Button
                    leftIcon={<Save className="size-4" aria-hidden="true" />}
                    disabled={Boolean(saving)}
                    onClick={() => void save()}
                  >
                    {saving === 'save' ? '儲存中…' : '儲存翻譯'}
                  </Button>
                </FormActions>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
