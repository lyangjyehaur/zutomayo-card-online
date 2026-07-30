import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCreate, useList, useNavigation, useOne, useUpdate } from '@refinedev/core';
import { ArrowLeft, ExternalLink, Plus, Save, Search } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { adminUpdateCardI18n, fetchCardTextsI18n, type AdminCardTextUpdate } from '../api/client';
import { CARD_DISTRIBUTION_TYPES, type CardDef } from '../game/types';
import { CardImage } from '../components/CardImage';
import { useDebouncedSearchQuery } from '../hooks/useDebouncedSearchQuery';
import { useKnowledgeSearchIds } from '../hooks/useKnowledgeSearch';
import { useLocale } from '../i18n';
import { Alert, Badge, Button, EmptyState, FormField, Input, LoadingState, Select, Textarea } from '../ui';

const elements = ['闇', '炎', '電気', '風', 'カオス'] as const;
const cardTypes = ['Character', 'Enchant', 'Area Enchant'] as const;
const catalogStatuses = ['listed', 'pending_listing', 'unlisted'] as const;
const distributionTypes = CARD_DISTRIBUTION_TYPES;
const publicationStatuses = ['draft', 'reviewed', 'published', 'retired'] as const;
const playStatuses = ['playable', 'display_only', 'disabled'] as const;

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => !value || URL.canParse(value), '請輸入完整 URL');
const cardSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, '卡牌 ID 為必填')
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/, '只能使用英數、連字號與底線'),
  name: z.string().trim().min(1, '日文卡名為必填'),
  enNameOfficial: z.string(),
  element: z.enum(elements),
  type: z.enum(cardTypes),
  rarity: z.string().trim().min(1, '稀有度為必填'),
  clock: z.number().int().min(0),
  attackNight: z.number().int().min(0),
  attackDay: z.number().int().min(0),
  powerCost: z.number().int().min(0),
  sendToPower: z.number().int().min(0),
  effect: z.string(),
  enEffectOfficial: z.string(),
  image: optionalUrl,
  errata: z.string(),
  pack: z.string().trim().min(1, '所屬系列為必填'),
  song: z.string(),
  illustrator: z.string(),
  catalogStatus: z.enum(catalogStatuses),
  distributionType: z.enum(distributionTypes),
  publicationStatus: z.enum(publicationStatuses),
  playStatus: z.enum(playStatuses),
  playStatusReason: z.string(),
  sourceUrl: optionalUrl,
  sourceNote: z.string(),
  sourceSha256: z
    .string()
    .trim()
    .refine((value) => !value || /^[a-fA-F0-9]{64}$/.test(value), 'SHA-256 必須是 64 位十六進位字串'),
});

type CardFormValues = z.infer<typeof cardSchema>;

const EMPTY_CARD: CardFormValues = {
  id: '',
  name: '',
  enNameOfficial: '',
  element: '闇',
  type: 'Character',
  rarity: 'N',
  clock: 0,
  attackNight: 0,
  attackDay: 0,
  powerCost: 0,
  sendToPower: 0,
  effect: '',
  enEffectOfficial: '',
  image: '',
  errata: '',
  pack: '',
  song: '',
  illustrator: '',
  catalogStatus: 'unlisted',
  distributionType: 'bonus',
  publicationStatus: 'draft',
  playStatus: 'disabled',
  playStatusReason: '待人工審核',
  sourceUrl: '',
  sourceNote: '',
  sourceSha256: '',
};

function cardToForm(card: CardDef): CardFormValues {
  return {
    ...EMPTY_CARD,
    ...card,
    enNameOfficial: card.enNameOfficial ?? '',
    enEffectOfficial: card.enEffectOfficial ?? '',
    attackNight: card.attack?.night ?? 0,
    attackDay: card.attack?.day ?? 0,
    catalogStatus: card.catalogStatus ?? 'listed',
    distributionType: card.distributionType ?? 'standard',
    publicationStatus: card.publicationStatus ?? 'published',
    playStatus: card.playStatus ?? 'playable',
    playStatusReason: card.playStatusReason ?? '',
    sourceUrl: card.sourceUrl ?? '',
    sourceNote: card.sourceNote ?? '',
    sourceSha256: card.sourceSha256 ?? '',
  };
}

function formToCard(values: CardFormValues): CardDef {
  return {
    id: values.id,
    name: values.name,
    enNameOfficial: values.enNameOfficial,
    element: values.element,
    type: values.type,
    rarity: values.rarity,
    clock: values.clock,
    attack: values.type === 'Character' ? { night: values.attackNight, day: values.attackDay } : null,
    powerCost: values.powerCost,
    sendToPower: values.sendToPower,
    effect: values.effect,
    enEffectOfficial: values.enEffectOfficial,
    image: values.image,
    errata: values.errata,
    pack: values.pack,
    song: values.song,
    illustrator: values.illustrator,
    catalogStatus: values.catalogStatus,
    distributionType: values.distributionType,
    publicationStatus: values.publicationStatus,
    playStatus: values.playStatus,
    playStatusReason: values.playStatusReason,
    sourceUrl: values.sourceUrl,
    sourceNote: values.sourceNote,
    sourceSha256: values.sourceSha256,
  };
}

function statusTone(status: string): 'jade' | 'gold' | 'vermilion' | 'neutral' {
  if (status === 'published' || status === 'playable' || status === 'listed') return 'jade';
  if (status === 'draft' || status === 'reviewed' || status === 'display_only' || status === 'pending_listing')
    return 'gold';
  if (status === 'disabled' || status === 'retired') return 'vermilion';
  return 'neutral';
}

export function CardListPage() {
  const { query } = useList<CardDef>({ resource: 'cards', pagination: { mode: 'off' } });
  const { create, edit } = useNavigation();
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [publication, setPublication] = useState('all');
  const [playStatus, setPlayStatus] = useState('all');
  const [catalogStatus, setCatalogStatus] = useState('all');
  const [distribution, setDistribution] = useState('all');
  const { inputBindings: searchInputBindings } = useDebouncedSearchQuery({ value: search, onCommit: setSearch });
  const { ids: publicSearchIds } = useKnowledgeSearchIds({
    query: search,
    locale,
    scope: 'card',
    limit: 500,
    analytics: false,
  });
  const cards = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const publicSearchOrder = useMemo(() => new Map(publicSearchIds.map((id, index) => [id, index])), [publicSearchIds]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const matches = cards.filter((card) => {
      if (publication !== 'all' && card.publicationStatus !== publication) return false;
      if (playStatus !== 'all' && card.playStatus !== playStatus) return false;
      if (catalogStatus !== 'all' && card.catalogStatus !== catalogStatus) return false;
      if (distribution !== 'all' && card.distributionType !== distribution) return false;
      const localMatch = [
        card.id,
        card.name,
        card.enNameOfficial,
        card.pack,
        card.song,
        card.effect,
        card.enEffectOfficial,
      ].some((value) => value?.toLocaleLowerCase().includes(needle));
      return !needle || localMatch || publicSearchOrder.has(card.id);
    });
    if (!needle || publicSearchOrder.size === 0) return matches;
    return matches.sort(
      (left, right) =>
        (publicSearchOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (publicSearchOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [cards, catalogStatus, distribution, playStatus, publication, publicSearchOrder, search]);

  return (
    <section className="admin-resource-page">
      <header className="admin-resource-header">
        <div>
          <h1>卡牌維護</h1>
          <p>管理正式卡、限定卡、展示用卡與人工審核狀態。</p>
        </div>
        <Button onClick={() => create('cards')}>
          <Plus className="size-4" />
          新增卡牌
        </Button>
      </header>
      <div className="admin-status-filters">
        <Input aria-label="搜尋卡牌" placeholder="搜尋 ID、卡名、歌曲或系列" {...searchInputBindings} />
        <Select aria-label="發布狀態" value={publication} onChange={(event) => setPublication(event.target.value)}>
          <option value="all">全部發布狀態</option>
          {publicationStatuses.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select aria-label="遊玩狀態" value={playStatus} onChange={(event) => setPlayStatus(event.target.value)}>
          <option value="all">全部遊玩狀態</option>
          {playStatuses.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select aria-label="圖鑑狀態" value={catalogStatus} onChange={(event) => setCatalogStatus(event.target.value)}>
          <option value="all">全部圖鑑狀態</option>
          {catalogStatuses.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select aria-label="發行方式" value={distribution} onChange={(event) => setDistribution(event.target.value)}>
          <option value="all">全部發行方式</option>
          {distributionTypes.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
      </div>
      <div className="mb-3 flex items-center gap-2 text-body-sm text-content-muted">
        <Search className="size-4" />
        <span>
          {filtered.length} / {cards.length} 張
        </span>
      </div>
      {query.isLoading ? (
        <LoadingState label="載入卡牌…" />
      ) : query.isError ? (
        <Alert tone="danger">{query.error?.message ?? '卡牌載入失敗'}</Alert>
      ) : filtered.length === 0 ? (
        <EmptyState title="找不到卡牌" />
      ) : (
        <div className="admin-card-grid">
          {filtered.map((card) => (
            <button key={card.id} className="admin-card-list-item text-left" onClick={() => edit('cards', card.id)}>
              {card.image ? (
                <CardImage src={card.image} sourceKind="url" context="thumbnail" alt="" loading="lazy" />
              ) : (
                <span className="grid aspect-[5/7] place-items-center bg-surface-base text-xs text-content-muted">
                  NO IMAGE
                </span>
              )}
              <span className="min-w-0">
                <span className="block font-mono text-xs text-content-muted">{card.id}</span>
                <strong className="mt-1 block truncate">{card.name || '未命名卡牌'}</strong>
                <span className="mt-1 block truncate text-xs text-content-muted">{card.pack || '未指定系列'}</span>
                <span className="mt-2 flex flex-wrap gap-1">
                  <Badge tone={statusTone(card.publicationStatus ?? 'published')}>
                    {card.publicationStatus ?? 'published'}
                  </Badge>
                  <Badge tone={statusTone(card.playStatus ?? 'playable')}>{card.playStatus ?? 'playable'}</Badge>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <span className="text-xs text-accent-danger">{message}</span> : null;
}

function CardFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id = '' } = useParams();
  const { list } = useNavigation();
  const one = useOne<CardDef>({ resource: 'cards', id, queryOptions: { enabled: mode === 'edit' && Boolean(id) } });
  const createMutation = useCreate<CardDef>();
  const updateMutation = useUpdate<CardDef>();
  const [saveError, setSaveError] = useState('');
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<CardFormValues>({ resolver: zodResolver(cardSchema), defaultValues: EMPTY_CARD });
  const card = one.query.data?.data;
  useEffect(() => {
    if (card) reset(cardToForm(card));
  }, [card, reset]);
  const image = watch('image');
  const type = watch('type');
  const cardId = watch('id');
  const saving = createMutation.mutation.isPending || updateMutation.mutation.isPending;

  const submit = handleSubmit((values) => {
    setSaveError('');
    const data = formToCard(values);
    if (mode === 'create') {
      createMutation.mutate(
        { resource: 'cards', values: data },
        { onSuccess: () => list('cards'), onError: (reason) => setSaveError(reason.message) },
      );
    } else {
      const { id: _ignored, ...patch } = data;
      updateMutation.mutate(
        { resource: 'cards', id, values: patch },
        { onSuccess: () => reset(values), onError: (reason) => setSaveError(reason.message) },
      );
    }
  });

  if (mode === 'edit' && one.query.isLoading) return <LoadingState label="載入卡牌…" />;
  if (mode === 'edit' && (one.query.isError || !card))
    return <Alert tone="danger">{one.query.error?.message ?? '找不到卡牌'}</Alert>;

  const selectField = (name: keyof CardFormValues, label: string, values: readonly string[]) => (
    <FormField label={label}>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select {...field} value={String(field.value)}>
            {values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        )}
      />
    </FormField>
  );

  return (
    <section className="admin-resource-page">
      <header className="admin-resource-header">
        <div>
          <button
            className="mb-2 flex items-center gap-1 text-body-sm text-content-muted hover:text-content-primary"
            onClick={() => list('cards')}
          >
            <ArrowLeft className="size-4" />
            返回卡牌列表
          </button>
          <h1>{mode === 'create' ? '新增卡牌' : `編輯 ${card?.id}`}</h1>
          <p>
            {mode === 'create'
              ? '新資料預設不發布且不可加入牌組，完成審核後再調整狀態。'
              : '變更官方文本與遊玩狀態前，請確認來源和審核紀錄。'}
          </p>
        </div>
        <Button disabled={saving || (mode === 'edit' && !isDirty)} onClick={() => void submit()}>
          <Save className="size-4" />
          {saving ? '儲存中…' : '儲存'}
        </Button>
      </header>
      {saveError && (
        <Alert className="mb-4" tone="danger">
          {saveError}
        </Alert>
      )}
      <form className="admin-card-form-grid" onSubmit={submit}>
        <div className="admin-card-form-fields">
          <section className="admin-card-form-section">
            <h2>識別與官方資料</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="卡牌 ID *">
                <Input {...register('id')} readOnly={mode === 'edit'} />
                <FieldError message={errors.id?.message} />
              </FormField>
              <FormField label="稀有度 *">
                <Input {...register('rarity')} />
                <FieldError message={errors.rarity?.message} />
              </FormField>
              <FormField label="日文卡名 *">
                <Input {...register('name')} />
                <FieldError message={errors.name?.message} />
              </FormField>
              <FormField label="官方英文卡名">
                <Input {...register('enNameOfficial')} />
              </FormField>
              {selectField('element', '屬性 *', elements)}
              {selectField('type', '卡牌種類 *', cardTypes)}
              <FormField label="所屬系列 *">
                <Input {...register('pack')} />
                <FieldError message={errors.pack?.message} />
              </FormField>
              <FormField label="歌曲">
                <Input {...register('song')} />
              </FormField>
              <FormField label="繪師">
                <Input {...register('illustrator')} />
              </FormField>
            </div>
            <FormField label="有效日文效果">
              <Textarea rows={5} {...register('effect')} />
            </FormField>
            <FormField label="官方英文效果">
              <Textarea rows={5} {...register('enEffectOfficial')} />
            </FormField>
            <FormField label="舊勘誤備註">
              <Textarea rows={2} {...register('errata')} />
            </FormField>
          </section>
          <section className="admin-card-form-section">
            <h2>數值</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <FormField label="Clock">
                <Input type="number" {...register('clock', { valueAsNumber: true })} />
              </FormField>
              <FormField label="Power Cost">
                <Input type="number" {...register('powerCost', { valueAsNumber: true })} />
              </FormField>
              <FormField label="SEND TO POWER">
                <Input type="number" {...register('sendToPower', { valueAsNumber: true })} />
              </FormField>
              {type === 'Character' && (
                <>
                  <FormField label="夜攻擊">
                    <Input type="number" {...register('attackNight', { valueAsNumber: true })} />
                  </FormField>
                  <FormField label="晝攻擊">
                    <Input type="number" {...register('attackDay', { valueAsNumber: true })} />
                  </FormField>
                </>
              )}
            </div>
          </section>
          <section className="admin-card-form-section">
            <h2>圖鑑與遊玩狀態</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {selectField('catalogStatus', '圖鑑收錄', catalogStatuses)}
              {selectField('distributionType', '發行方式', distributionTypes)}
              {selectField('publicationStatus', '發布狀態', publicationStatuses)}
              {selectField('playStatus', '遊玩狀態', playStatuses)}
            </div>
            <FormField label="遊玩狀態原因">
              <Textarea rows={2} {...register('playStatusReason')} />
            </FormField>
          </section>
          <section className="admin-card-form-section">
            <h2>圖片與來源</h2>
            <FormField label="卡圖 URL（不會上傳至 R2）">
              <Input type="url" {...register('image')} />
              <FieldError message={errors.image?.message} />
            </FormField>
            <FormField label="資料來源 URL">
              <Input type="url" {...register('sourceUrl')} />
              <FieldError message={errors.sourceUrl?.message} />
            </FormField>
            <FormField label="來源備註">
              <Textarea rows={3} {...register('sourceNote')} />
            </FormField>
            <FormField label="來源 SHA-256">
              <Input className="font-mono" {...register('sourceSha256')} />
              <FieldError message={errors.sourceSha256?.message} />
            </FormField>
          </section>
          {mode === 'edit' && card && <CardTranslationsEditor card={card} />}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || (mode === 'edit' && !isDirty)}>
              <Save className="size-4" />
              {saving ? '儲存中…' : '儲存卡牌'}
            </Button>
          </div>
        </div>
        <aside className="admin-card-form-section admin-card-form-preview">
          <h2>圖片預覽</h2>
          {image ? (
            <CardImage src={image} sourceKind="url" context="detail" alt={`${cardId || '新卡牌'} 預覽`} />
          ) : (
            <div className="grid aspect-[5/7] place-items-center bg-surface-base text-content-muted">
              尚未設定卡圖 URL
            </div>
          )}
          {image && (
            <a
              className="flex items-center justify-center gap-1 text-body-sm text-accent-action"
              href={image}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-4" />
              開啟原圖
            </a>
          )}
          <Alert tone="info">圖片只作為待審核來源預覽；這個表單不會把圖片上傳到 R2。</Alert>
        </aside>
      </form>
    </section>
  );
}

type TranslationDraft = {
  nameText: string;
  effectText: string;
  reviewStatus: 'verified' | 'pending_review';
  reviewNote: string;
};
const translationLocales = [
  ['zh-TW', '繁體中文'],
  ['zh-HK', '廣東話'],
  ['zh-CN', '简体中文'],
  ['ko', '한국어'],
] as const;

function CardTranslationsEditor({ card }: { card: CardDef }) {
  const [drafts, setDrafts] = useState<Record<string, TranslationDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchCardTextsI18n(card.id)
      .then((data) => {
        if (cancelled) return;
        setDrafts(
          Object.fromEntries(
            translationLocales.map(([locale]) => [
              locale,
              {
                nameText: data[locale]?.name ?? '',
                effectText: data[locale]?.effect ?? '',
                reviewStatus: data[locale]?.reviewStatus === 'verified' ? 'verified' : 'pending_review',
                reviewNote: data[locale]?.reviewNote ?? '',
              },
            ]),
          ),
        );
      })
      .catch(() => setDrafts({}))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id]);
  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      await Promise.all(
        translationLocales.map(([locale]) => {
          const value = drafts[locale] ?? {
            nameText: '',
            effectText: '',
            reviewStatus: 'pending_review',
            reviewNote: '',
          };
          const payload: AdminCardTextUpdate = {
            ...value,
            source: 'admin_bilingual_translation',
            nameSource: 'admin_bilingual_translation',
            effectSource: 'admin_bilingual_translation',
          };
          return adminUpdateCardI18n(card.id, locale, payload);
        }),
      );
      setNotice('翻譯已儲存');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '翻譯儲存失敗');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="admin-card-form-section">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2>校對翻譯</h2>
          <p className="mt-1 text-xs text-content-muted">以官方日文與英文為參照，卡名應使用既有校對名稱。</p>
        </div>
        <Button size="sm" disabled={loading || saving} onClick={() => void save()}>
          {saving ? '儲存中…' : '儲存翻譯'}
        </Button>
      </div>
      {notice && <Alert tone={notice === '翻譯已儲存' ? 'success' : 'danger'}>{notice}</Alert>}
      {loading ? (
        <LoadingState label="載入翻譯…" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {translationLocales.map(([locale, label]) => {
            const value = drafts[locale] ?? {
              nameText: '',
              effectText: '',
              reviewStatus: 'pending_review' as const,
              reviewNote: '',
            };
            const update = (patch: Partial<TranslationDraft>) =>
              setDrafts((current) => ({ ...current, [locale]: { ...value, ...patch } }));
            return (
              <div key={locale} className="grid gap-2 border border-border-soft p-3">
                <strong>{label}</strong>
                <Input
                  aria-label={`${label}卡名`}
                  value={value.nameText}
                  onChange={(event) => update({ nameText: event.target.value })}
                />
                <Textarea
                  aria-label={`${label}效果`}
                  rows={4}
                  value={value.effectText}
                  onChange={(event) => update({ effectText: event.target.value })}
                />
                <Select
                  aria-label={`${label}審核狀態`}
                  value={value.reviewStatus}
                  onChange={(event) => update({ reviewStatus: event.target.value as TranslationDraft['reviewStatus'] })}
                >
                  <option value="pending_review">待複核</option>
                  <option value="verified">已人工複核</option>
                </Select>
                <Input
                  aria-label={`${label}複核備註`}
                  placeholder="複核備註"
                  value={value.reviewNote}
                  onChange={(event) => update({ reviewNote: event.target.value })}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CardCreatePage() {
  return <CardFormPage mode="create" />;
}
export function CardEditPage() {
  return <CardFormPage mode="edit" />;
}
