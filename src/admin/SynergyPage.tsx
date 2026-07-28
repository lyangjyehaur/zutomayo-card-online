import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Plus, RefreshCw, Save } from 'lucide-react';
import {
  adminCreateCardSynergy,
  adminGetCards,
  adminGetCardSynergies,
  adminUpdateCardSynergy,
  type AdminCardSynergy,
  type AdminCardSynergyInput,
  type CardSynergyCategory,
} from '../api/client';
import type { CardDef } from '../game/types';
import { getLocalizedCardName } from '../game/cards/i18n';
import { useLocale } from '../i18n';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  SearchInput,
  Select,
  Textarea,
} from '../ui';

const categories: Array<[CardSynergyCategory, string]> = [
  ['named_card_song', '指定歌曲／卡牌'],
  ['element', '屬性'],
  ['zone_resource', '深淵／充能區'],
  ['chronos', 'Chronos／時間'],
  ['hp_damage', 'HP／傷害'],
  ['hand_draw', '手牌／抽牌'],
  ['card_stats_type', 'Power Cost／卡種'],
  ['deck_flow', '牌組／SEND TO POWER'],
  ['area_enchant', '區域附魔卡'],
  ['event_trigger', '事件觸發'],
  ['other', '其他'],
];
const locales = [
  ['zh-TW', '繁體中文'],
  ['zh-CN', '简体中文'],
  ['zh-HK', '廣東話'],
  ['en', 'English'],
  ['ko', '한국어'],
] as const;
type Draft = AdminCardSynergyInput & { evidenceText: string };
const emptyDraft: Draft = {
  groupId: '',
  sourceCardId: '',
  targetCardId: '',
  kind: 'enables',
  primaryCategory: 'named_card_song',
  categories: ['named_card_song'],
  confidence: 'high',
  score: 80,
  rationaleJa: '',
  rationaleI18n: {},
  evidence: [],
  evidenceText: '[]',
  reviewStatus: 'candidate',
  recommendationEligible: false,
  sourceVersion: 'manual-v1',
  rulesVersion: 'current',
};
const toDraft = (relation: AdminCardSynergy): Draft => ({
  ...relation,
  evidenceText: JSON.stringify(relation.evidence, null, 2),
});
const statusTone = (status: AdminCardSynergy['reviewStatus']): 'jade' | 'gold' | 'vermilion' | 'neutral' =>
  status === 'approved'
    ? 'jade'
    : status === 'rejected'
      ? 'vermilion'
      : status === 'needs_changes'
        ? 'gold'
        : 'neutral';

export function SynergyPage() {
  const locale = useLocale();
  const [items, setItems] = useState<AdminCardSynergy[]>([]);
  const [cards, setCards] = useState<CardDef[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('candidate');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const displayCardName = useCallback(
    (cardId: string, japaneseFallback = '') => {
      const card = cardsById.get(cardId);
      return card ? getLocalizedCardName(card, locale) : japaneseFallback || cardId;
    },
    [cardsById, locale],
  );
  const japaneseCardName = useCallback(
    (cardId: string, japaneseFallback = '') => cardsById.get(cardId)?.name || japaneseFallback,
    [cardsById],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [relations, cardRows] = await Promise.all([
        adminGetCardSynergies({ status, category, query, limit: 300 }),
        cards.length ? Promise.resolve(cards) : adminGetCards(),
      ]);
      setItems(relations);
      setCards(cardRows);
      const selected = relations.find((item) => item.id === selectedId);
      if (selected) setDraft(toDraft(selected));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '聯動資料載入失敗');
    } finally {
      setLoading(false);
    }
  }, [cards, category, query, selectedId, status]);
  useEffect(() => void refresh(), [refresh]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const select = (item: AdminCardSynergy) => {
    setSelectedId(item.id);
    setDraft(toDraft(item));
    setError('');
    setNotice('');
  };
  const startNew = () => {
    setSelectedId('');
    setDraft(emptyDraft);
    setError('');
    setNotice('');
  };
  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const evidence = JSON.parse(draft.evidenceText) as unknown;
      if (!Array.isArray(evidence)) throw new Error('Evidence 必須是 JSON array');
      const { evidenceText: _ignored, ...input } = { ...draft, evidence };
      const saved = selectedId ? await adminUpdateCardSynergy(selectedId, input) : await adminCreateCardSynergy(input);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      setNotice('聯動資料已儲存');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '聯動資料儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-resource-page">
      <header className="admin-resource-header">
        <div>
          <h1>卡牌聯動審核</h1>
          <p>只有 approved 且 recommendation eligible 的方向性關係會優先出現在公開圖鑑。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={startNew}>
            <Plus className="size-4" />
            新增關係
          </Button>
          <Button variant="secondary" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            重新整理
          </Button>
        </div>
      </header>
      {error && (
        <Alert className="mb-3" tone="danger">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert className="mb-3" tone="success">
          {notice}
        </Alert>
      )}
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(14rem,1fr)_12rem_14rem]">
        <SearchInput placeholder="卡號、卡名或理由" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select aria-label="審核狀態" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部審核狀態</option>
          <option value="candidate">candidate</option>
          <option value="needs_changes">needs_changes</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </Select>
        <Select aria-label="聯動分類" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">全部分類</option>
          {categories.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)]">
        <aside className="max-h-[72vh] overflow-y-auto border border-border-soft bg-surface-panel p-2">
          {loading ? (
            <LoadingState label="載入聯動…" />
          ) : items.length === 0 ? (
            <EmptyState title="沒有符合的聯動關係" />
          ) : (
            <div className="grid gap-2">
              {items.map((item) =>
                (() => {
                  const sourceName = displayCardName(item.sourceCardId, item.sourceCardName);
                  const targetName = displayCardName(item.targetCardId, item.targetCardName);
                  const sourceNameJa = japaneseCardName(item.sourceCardId, item.sourceCardName);
                  const targetNameJa = japaneseCardName(item.targetCardId, item.targetCardName);
                  const localizedRationale = item.rationaleI18n[locale] || item.rationaleI18n['zh-TW'];
                  return (
                    <button
                      key={item.id}
                      className={`grid gap-2 border p-3 text-left ${selectedId === item.id ? 'border-accent-primary bg-accent-primary/10' : 'border-border-soft bg-surface-base/50'}`}
                      onClick={() => select(item)}
                    >
                      <span className="flex items-center gap-2">
                        <Badge tone={statusTone(item.reviewStatus)}>{item.reviewStatus}</Badge>
                        <Badge>{item.confidence}</Badge>
                        <span className="ml-auto font-mono text-xs text-accent-primary">{item.score}</span>
                      </span>
                      <strong className="text-body-sm">
                        {item.sourceCardId} → {item.targetCardId}
                      </strong>
                      <span className="truncate text-xs text-content-muted">
                        {sourceName} → {targetName}
                      </span>
                      {(sourceName !== sourceNameJa || targetName !== targetNameJa) && (
                        <span className="truncate text-[0.6875rem] text-content-muted/70">
                          日文來源：{sourceNameJa} → {targetNameJa}
                        </span>
                      )}
                      <span className="line-clamp-2 text-xs">{localizedRationale || `尚無 ${locale} 的聯動理由`}</span>
                    </button>
                  );
                })(),
              )}
            </div>
          )}
        </aside>
        <div className="grid gap-4">
          <section className="admin-card-form-section">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2">
                <Link2 className="size-4" />
                {selectedId ? '編輯關係' : '新增關係'}
              </h2>
              {selectedId && <span className="font-mono text-xs text-content-muted">{selectedId}</span>}
            </div>
            <datalist id="admin-synergy-card-ids">
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {getLocalizedCardName(card, locale)}
                </option>
              ))}
            </datalist>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="來源卡 ID *">
                <Input
                  list="admin-synergy-card-ids"
                  value={draft.sourceCardId}
                  onChange={(event) => update('sourceCardId', event.target.value)}
                />
                {draft.sourceCardId && (
                  <p className="mt-1 text-xs text-content-muted">
                    {displayCardName(draft.sourceCardId)}
                    {displayCardName(draft.sourceCardId) !== japaneseCardName(draft.sourceCardId) && (
                      <> · 日文來源：{japaneseCardName(draft.sourceCardId)}</>
                    )}
                  </p>
                )}
              </FormField>
              <FormField label="目標卡 ID *">
                <Input
                  list="admin-synergy-card-ids"
                  value={draft.targetCardId}
                  onChange={(event) => update('targetCardId', event.target.value)}
                />
                {draft.targetCardId && (
                  <p className="mt-1 text-xs text-content-muted">
                    {displayCardName(draft.targetCardId)}
                    {displayCardName(draft.targetCardId) !== japaneseCardName(draft.targetCardId) && (
                      <> · 日文來源：{japaneseCardName(draft.targetCardId)}</>
                    )}
                  </p>
                )}
              </FormField>
              <FormField label="關係">
                <Select value={draft.kind} onChange={(event) => update('kind', event.target.value as Draft['kind'])}>
                  <option value="enables">enables</option>
                  <option value="conflicts">conflicts</option>
                </Select>
              </FormField>
              <FormField label="主要分類">
                <Select
                  value={draft.primaryCategory}
                  onChange={(event) => {
                    const value = event.target.value as CardSynergyCategory;
                    update('primaryCategory', value);
                    update('categories', [value]);
                  }}
                >
                  {categories.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="信心">
                <Select
                  value={draft.confidence}
                  onChange={(event) => update('confidence', event.target.value as Draft['confidence'])}
                >
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </Select>
              </FormField>
              <FormField label="分數">
                <Input
                  type="number"
                  min={-1000}
                  max={1000}
                  value={draft.score}
                  onChange={(event) => update('score', Number(event.target.value))}
                />
              </FormField>
              <FormField label="來源版本">
                <Input value={draft.sourceVersion} onChange={(event) => update('sourceVersion', event.target.value)} />
              </FormField>
              <FormField label="規則版本">
                <Input value={draft.rulesVersion} onChange={(event) => update('rulesVersion', event.target.value)} />
              </FormField>
              <FormField label="審核狀態">
                <Select
                  value={draft.reviewStatus}
                  onChange={(event) => {
                    const value = event.target.value as Draft['reviewStatus'];
                    update('reviewStatus', value);
                    if (value !== 'approved') update('recommendationEligible', false);
                  }}
                >
                  <option value="candidate">candidate</option>
                  <option value="needs_changes">needs_changes</option>
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                </Select>
              </FormField>
              <FormField label="機制群組 ID">
                <Input value={draft.groupId} onChange={(event) => update('groupId', event.target.value)} />
              </FormField>
            </div>
            <Checkbox
              disabled={draft.reviewStatus !== 'approved'}
              checked={draft.recommendationEligible}
              onChange={(event) => update('recommendationEligible', event.target.checked)}
            >
              允許出現在公開推薦（必須已批准）
            </Checkbox>
            <FormField label="日文理由 *">
              <Textarea
                rows={4}
                value={draft.rationaleJa}
                onChange={(event) => update('rationaleJa', event.target.value)}
              />
            </FormField>
          </section>
          <section className="admin-card-form-section">
            <h2>多語理由</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {locales.map(([locale, label]) => (
                <FormField key={locale} label={label}>
                  <Textarea
                    rows={3}
                    value={draft.rationaleI18n[locale] ?? ''}
                    onChange={(event) =>
                      update('rationaleI18n', { ...draft.rationaleI18n, [locale]: event.target.value })
                    }
                  />
                </FormField>
              ))}
            </div>
          </section>
          <section className="admin-card-form-section">
            <h2>Evidence JSON</h2>
            <Textarea
              className="font-mono text-xs"
              rows={8}
              value={draft.evidenceText}
              onChange={(event) => update('evidenceText', event.target.value)}
            />
          </section>
          <div className="flex justify-end">
            <Button
              disabled={
                saving ||
                !draft.sourceCardId ||
                !draft.targetCardId ||
                !draft.rationaleJa ||
                !draft.sourceVersion ||
                !draft.rulesVersion
              }
              onClick={() => void save()}
            >
              <Save className="size-4" />
              {saving ? '儲存中…' : '儲存聯動'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
