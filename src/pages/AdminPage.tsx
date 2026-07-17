import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getAllCardDefs, refreshCards } from '../game/cards/loader';
import { parseEffect } from '../game/effects/parser';
import type { ParsedEffect } from '../game/effects';
import type { CardDef, CardType, Element } from '../game/types';
import {
  ApiError,
  adminCreateChatUserSanction,
  adminGetChatConversationMessages,
  adminGetChatReports,
  adminGetMatches,
  adminGetUsers,
  adminLogin,
  adminLoginWithAccount,
  adminLogout,
  adminRevokeChatUserSanction,
  adminReviewChatMessageModeration,
  adminReviewChatReport,
  adminResetElo,
  adminUpdateUserRole,
  adminUpdateAboutPage,
  adminUpdateCard,
  adminUpdateCardI18n,
  DEFAULT_ABOUT_PAGE_I18N_CONFIG,
  fetchAboutPageI18n,
  fetchCardTextsI18n,
} from '../api/client';
import type {
  AboutPageConfig,
  AboutPageI18nConfig,
  AboutPageLocale,
  AdminMatch,
  AdminRole,
  AdminUser,
  ChatConversation,
  ChatMessage,
  ChatReport,
} from '../api/client';
import {
  Badge,
  BackButton,
  Button,
  Card as UiCard,
  DataListCell,
  DataListTable,
  Dialog,
  EmptyState,
  Input,
  SearchInput,
  Alert,
  LoadingState,
  PageShell,
  Panel,
  Select,
  SegmentedControl,
  StatCard,
  StatsGrid,
  Textarea,
  ToolHeader,
} from '../ui';
import { CardImage } from '../components/CardImage';
import { AdminOperationsPanel } from '../components/AdminOperationsPanel';
import '../components/AdminPanel.css';

const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';
const ADMIN_ROLE_KEY = 'zutomayo_admin_role';

const ADMIN_ROLES: AdminRole[] = ['viewer', 'moderator', 'operator', 'admin'];

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);
}

function readStoredAdminRole(): AdminRole | null {
  const stored = sessionStorage.getItem(ADMIN_ROLE_KEY);
  if (isAdminRole(stored)) return stored;
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: unknown;
    };
    return isAdminRole(payload.role) ? payload.role : null;
  } catch {
    return null;
  }
}

const ELEMENT_OPTIONS: Element[] = ['闇', '炎', '電気', '風', 'カオス'];
const TYPE_OPTIONS: CardType[] = ['Character', 'Enchant', 'Area Enchant'];
const RARITY_OPTIONS = ['N', 'R', 'SR', 'UR', 'SE'] as const;
const ELEMENTS: (Element | 'all')[] = ['all', ...ELEMENT_OPTIONS];
const TYPES: (CardType | 'all')[] = ['all', ...TYPE_OPTIONS];
const FALLBACK_PACKS = ['THE WORLD IS CHANGING', 'ALL ALONG THE WATCHTOWER', 'Off Minor', 'Fantasy Is Reality'];
const TRIGGERS = [
  'all',
  'onUse',
  'onTurnStart',
  'onTurnEnd',
  'onDamageReceived',
  'onChronosChanged',
  'onZoneEntered',
  'onBattle',
];
const I18N_LANGS = [
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-HK', label: '廣東話' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
] as const;

const ABOUT_LANGS: Array<{ code: AboutPageLocale; label: string }> = I18N_LANGS.map((lang) => ({
  code: lang.code as AboutPageLocale,
  label: lang.label,
}));

type AdminTab = 'cards' | 'users' | 'matches' | 'chat' | 'operations' | 'about';
type ModalTab = 'basic' | 'engine' | 'i18n';
type ParsedCardMeta = {
  card: CardDef;
  lines: string[];
  parsed: ParsedEffect[];
  unparsedLines: string[];
  triggers: string[];
  actions: string[];
  conditions: string[];
  hasPendingChoice: boolean;
  hasAreaExpiry: boolean;
};

type CardEditDraft = {
  name: string;
  enNameOfficial: string;
  element: Element;
  type: CardType;
  rarity: string;
  clock: string;
  attackNight: string;
  attackDay: string;
  powerCost: string;
  sendToPower: string;
  effect: string;
  enEffectOfficial: string;
  image: string;
  errata: string;
  pack: string;
  song: string;
  illustrator: string;
};

function cardToDraft(card: CardDef): CardEditDraft {
  return {
    name: card.name,
    enNameOfficial: card.enNameOfficial ?? '',
    element: card.element,
    type: card.type,
    rarity: card.rarity,
    clock: String(card.clock),
    attackNight: card.attack ? String(card.attack.night) : '',
    attackDay: card.attack ? String(card.attack.day) : '',
    powerCost: String(card.powerCost),
    sendToPower: String(card.sendToPower),
    effect: card.effect,
    enEffectOfficial: card.enEffectOfficial ?? '',
    image: card.image,
    errata: card.errata,
    pack: card.pack,
    song: card.song,
    illustrator: card.illustrator,
  };
}

function draftToPatch(draft: CardEditDraft): Partial<CardDef> {
  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };
  return {
    name: draft.name,
    enNameOfficial: draft.enNameOfficial,
    element: draft.element,
    type: draft.type,
    rarity: draft.rarity,
    clock: num(draft.clock),
    attack: draft.type === 'Character' ? { night: num(draft.attackNight), day: num(draft.attackDay) } : null,
    powerCost: num(draft.powerCost),
    sendToPower: num(draft.sendToPower),
    effect: draft.effect,
    enEffectOfficial: draft.enEffectOfficial,
    image: draft.image.trim(),
    errata: draft.errata,
    pack: draft.pack,
    song: draft.song,
    illustrator: draft.illustrator,
  };
}

function changedFields(card: CardDef, draft: CardEditDraft): Partial<CardDef> {
  const next = draftToPatch(draft);
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (k === 'attack') {
      const a = card.attack,
        b = v as CardDef['attack'];
      if (!a && !b) continue;
      if (!a || !b || a.night !== b.night || a.day !== b.day) changed.attack = b;
    } else if ((card as unknown as Record<string, unknown>)[k] !== v) {
      changed[k] = v;
    }
  }
  return changed as Partial<CardDef>;
}

// ===== Parser helpers =====
function effectLines(card: CardDef): string[] {
  return card.effect
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function conditionTypes(effect: ParsedEffect): string[] {
  const collect = (conditions: ParsedEffect['conditions']): string[] =>
    conditions.flatMap((c) => (c.type === 'and' || c.type === 'or' ? [c.type, ...collect(c.value)] : [c.type]));
  return collect(effect.conditions);
}

function parseCardMeta(card: CardDef): ParsedCardMeta {
  const lines = effectLines(card);
  const parsed = lines.map((l) => parseEffect(l)).filter((x): x is ParsedEffect => Boolean(x));
  const unparsedLines = lines.filter((l) => !parseEffect(l));
  const all = parsed.flatMap((e) => (e.expiry ? [e, e.expiry] : [e]));
  const actions = [...new Set(all.map((e) => e.action.type))];
  const triggers = [...new Set(all.map((e) => e.trigger))];
  const conditions = [...new Set(all.flatMap(conditionTypes))];
  const hasPendingChoice = actions.some((a) => /choose|reveal|recover|move|swap|reorder|useFrom/i.test(a));
  const hasAreaExpiry =
    card.type === 'Area Enchant' &&
    all.some(
      (e) =>
        Boolean(e.expiry) ||
        e.action.type === 'moveSelfAreaEnchant' ||
        e.rawText.includes('ターンの終了時') ||
        e.rawText.includes('アビスに置く'),
    );
  return { card, lines, parsed, unparsedLines, triggers, actions, conditions, hasPendingChoice, hasAreaExpiry };
}

function badgeList(items: string[], empty = '—') {
  if (items.length === 0) return <Badge>{empty}</Badge>;
  return items.map((item) => (
    <Badge className="mr-1 mb-1" tone="gold" key={item}>
      {item}
    </Badge>
  ));
}

// ===== EffectInspector (read-only) =====
function EffectInspector({ meta }: { meta: ParsedCardMeta }) {
  const astJson = JSON.stringify(meta.parsed, null, 2);
  if (meta.lines.length === 0)
    return (
      <section className="grid gap-3">
        <h4 className="text-lg font-bold">效果引擎</h4>
        <p className="opacity-70">無效果</p>
      </section>
    );
  return (
    <section className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-bold">效果引擎</h4>
          <p className="text-sm opacity-70">
            {meta.parsed.length}/{meta.lines.length} 行已解析
            {meta.unparsedLines.length ? `，未解析 ${meta.unparsedLines.length} 行` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" type="button" onClick={() => navigator.clipboard?.writeText(astJson)}>
          複製 AST
        </Button>
      </div>
      <UiCard>
        <div className="grid gap-2">
          <strong>原文</strong>
          {meta.lines.map((l) => (
            <p className="whitespace-pre-wrap" key={l}>
              {l}
            </p>
          ))}
        </div>
      </UiCard>
      <div className="grid gap-2 md:grid-cols-3">
        <div>
          <span className="text-sm opacity-70">Trigger</span>
          <div className="mt-1">{badgeList(meta.triggers)}</div>
        </div>
        <div>
          <span className="text-sm opacity-70">Action</span>
          <div className="mt-1">{badgeList(meta.actions)}</div>
        </div>
        <div>
          <span className="text-sm opacity-70">Condition</span>
          <div className="mt-1">{badgeList(meta.conditions)}</div>
        </div>
      </div>
      {meta.parsed.map((effect, i) => (
        <UiCard as="article" key={`${effect.rawText}-${i}`}>
          <div className="grid gap-2">
            <div>{badgeList([effect.trigger, effect.action.type])}</div>
            <p className="my-2">{effect.rawText}</p>
            {effect.conditions.length > 0 && (
              <small className="opacity-70">條件：{conditionTypes(effect).join(', ')}</small>
            )}
            {effect.expiry && (
              <small className="opacity-70">
                附帶 expiry：{effect.expiry.trigger} / {effect.expiry.action.type}
              </small>
            )}
          </div>
        </UiCard>
      ))}
      <details className="rounded-sm bg-surface-base p-4 ring-1 ring-content-primary/10">
        <summary className="cursor-pointer font-bold">查看完整 AST JSON</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{astJson}</pre>
      </details>
      {meta.unparsedLines.length > 0 && (
        <Panel className="border-l-2 border-accent-primary/40 bg-accent-primary/10 text-xs text-accent-primary">
          <span>
            <strong>未解析行</strong>
            {meta.unparsedLines.map((l) => (
              <p className="mt-1 whitespace-pre-wrap" key={l}>
                {l}
              </p>
            ))}
          </span>
        </Panel>
      )}
    </section>
  );
}

// ===== Card Edit Form =====
function CardEditForm({ card, onSaved }: { card: CardDef; onSaved: (updated: CardDef) => void }) {
  const [draft, setDraft] = useState<CardEditDraft>(() => cardToDraft(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDraft(cardToDraft(card));
    setSuccess(false);
    setError('');
  }, [card]);

  const set = (field: keyof CardEditDraft, value: string) => setDraft((d) => ({ ...d, [field]: value }));

  const handleSave = async () => {
    const patch = changedFields(card, draft);
    if (Object.keys(patch).length === 0) {
      setSuccess(true);
      return;
    }
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await adminUpdateCard(card.id, patch);
      setSuccess(true);
      onSaved({ ...card, ...patch } as CardDef);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">官方日文名稱</span>
        <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">卡面官方英文名稱</span>
        <Input value={draft.enNameOfficial} onChange={(e) => set('enNameOfficial', e.target.value)} />
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">屬性</span>
          <Select value={draft.element} onChange={(e) => set('element', e.target.value)}>
            {ELEMENT_OPTIONS.map((el) => (
              <option key={el}>{el}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">類型</span>
          <Select value={draft.type} onChange={(e) => set('type', e.target.value)}>
            {TYPE_OPTIONS.map((tp) => (
              <option key={tp}>{tp}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">稀有度</span>
          <Select value={draft.rarity} onChange={(e) => set('rarity', e.target.value)}>
            {RARITY_OPTIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">時計</span>
          <Input type="number" value={draft.clock} onChange={(e) => set('clock', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">充能成本</span>
          <Input type="number" value={draft.powerCost} onChange={(e) => set('powerCost', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">SEND TO POWER</span>
          <Input type="number" value={draft.sendToPower} onChange={(e) => set('sendToPower', e.target.value)} />
        </label>
      </div>
      {draft.type === 'Character' && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">夜間攻擊</span>
            <Input type="number" value={draft.attackNight} onChange={(e) => set('attackNight', e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">日間攻擊</span>
            <Input type="number" value={draft.attackDay} onChange={(e) => set('attackDay', e.target.value)} />
          </label>
        </div>
      )}
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">官方日文效果</span>
        <Textarea value={draft.effect} onChange={(e) => set('effect', e.target.value)} rows={4} />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">卡面官方英文效果</span>
        <Textarea value={draft.enEffectOfficial} onChange={(e) => set('enEffectOfficial', e.target.value)} rows={4} />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">圖片 URL</span>
        <Input value={draft.image} onChange={(e) => set('image', e.target.value)} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">歌曲</span>
          <Input value={draft.song} onChange={(e) => set('song', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">畫師</span>
          <Input value={draft.illustrator} onChange={(e) => set('illustrator', e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">卡包</span>
        <Select value={draft.pack} onChange={(e) => set('pack', e.target.value)}>
          {FALLBACK_PACKS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-content-primary/50">勘誤</span>
        <Textarea value={draft.errata} onChange={(e) => set('errata', e.target.value)} rows={2} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '儲存中…' : '儲存'}
        </Button>
        {success && <Badge tone="jade">已儲存</Badge>}
        {error && <Badge tone="vermilion">{error}</Badge>}
      </div>
    </div>
  );
}

// ===== i18n Editor =====
type CardTextDraft = {
  name: string;
  effect: string;
  reviewStatus: 'official' | 'verified' | 'pending_review';
  reviewNote: string;
};

const DERIVED_I18N_LANGS = I18N_LANGS.filter((lang) => lang.code !== 'ja' && lang.code !== 'en');

function I18nEditor({ card }: { card: CardDef }) {
  const cardId = card.id;
  const [draft, setDraft] = useState<Record<string, CardTextDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchCardTextsI18n(cardId)
      .then((data) => {
        const init: Record<string, CardTextDraft> = {};
        for (const lang of DERIVED_I18N_LANGS) {
          const entry = data[lang.code];
          init[lang.code] = {
            name: entry?.name ?? '',
            effect: entry?.effect ?? '',
            reviewStatus: entry?.reviewStatus ?? 'pending_review',
            reviewNote: entry?.reviewNote ?? '',
          };
        }
        setDraft(init);
      })
      .catch(() => {
        const init: Record<string, CardTextDraft> = {};
        for (const lang of DERIVED_I18N_LANGS) {
          init[lang.code] = { name: '', effect: '', reviewStatus: 'pending_review', reviewNote: '' };
        }
        setDraft(init);
      })
      .finally(() => setLoading(false));
  }, [cardId]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      for (const lang of DERIVED_I18N_LANGS) {
        const entry = draft[lang.code];
        await adminUpdateCardI18n(cardId, lang.code, {
          nameText: entry?.name ?? '',
          effectText: entry?.effect ?? '',
          reviewStatus: entry?.reviewStatus ?? 'pending_review',
          reviewNote: entry?.reviewNote ?? '',
          source: 'admin_bilingual_translation',
          nameSource: card.officialErrataAffectsName
            ? 'official_japanese_errata_translation'
            : 'admin_bilingual_translation',
          effectSource: card.officialErrataAffectsEffect
            ? 'official_japanese_errata_translation'
            : 'admin_bilingual_translation',
        });
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="載入翻譯中…" />;

  return (
    <div className="grid gap-3">
      <p className="text-xs text-content-primary/50">
        翻譯須同時核對官方日文與卡面官方英文；只有標記為「已複核」的文字會顯示給玩家。
      </p>
      {DERIVED_I18N_LANGS.map((lang) => {
        const entry = draft[lang.code] ?? { name: '', effect: '', reviewStatus: 'pending_review', reviewNote: '' };
        const update = (patch: Partial<CardTextDraft>) =>
          setDraft((current) => ({ ...current, [lang.code]: { ...entry, ...patch } }));
        return (
          <Panel className="grid gap-2" key={lang.code}>
            <span className="text-xs font-semibold text-content-primary/70">
              {lang.label} <span className="opacity-60">({lang.code})</span>
            </span>
            <Input value={entry.name} onChange={(e) => update({ name: e.target.value })} placeholder="卡牌名稱" />
            <Textarea
              value={entry.effect}
              onChange={(e) => update({ effect: e.target.value })}
              rows={3}
              placeholder="卡牌效果"
            />
            <div className="grid gap-2 md:grid-cols-2">
              <Select
                value={entry.reviewStatus}
                onChange={(e) => update({ reviewStatus: e.target.value as CardTextDraft['reviewStatus'] })}
              >
                <option value="pending_review">待複核</option>
                <option value="verified">已複核</option>
              </Select>
              <Input
                value={entry.reviewNote}
                onChange={(e) => update({ reviewNote: e.target.value })}
                placeholder="複核備註"
              />
            </div>
          </Panel>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '儲存中…' : '儲存翻譯'}
        </Button>
        {success && <Badge tone="jade">已儲存</Badge>}
        {error && <Badge tone="vermilion">{error}</Badge>}
      </div>
    </div>
  );
}

function AboutSettingsEditor() {
  const [draft, setDraft] = useState<AboutPageI18nConfig>(DEFAULT_ABOUT_PAGE_I18N_CONFIG);
  const [activeLocale, setActiveLocale] = useState<AboutPageLocale>('zh-TW');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAboutPageI18n()
      .then(setDraft)
      .catch(() => setDraft(DEFAULT_ABOUT_PAGE_I18N_CONFIG))
      .finally(() => setLoading(false));
  }, []);

  const currentDraft = draft[activeLocale];

  const updateCurrentDraft = (update: (current: AboutPageConfig) => AboutPageConfig) => {
    setDraft((current) => ({ ...current, [activeLocale]: update(current[activeLocale]) }));
    setSuccess(false);
  };

  const setField = (field: keyof Pick<AboutPageConfig, 'title' | 'description'>, value: string) => {
    updateCurrentDraft((current) => ({ ...current, [field]: value }));
  };

  const setPersonField = (person: 'author' | 'artist', field: keyof AboutPageConfig['author'], value: string) => {
    updateCurrentDraft((current) => ({ ...current, [person]: { ...current[person], [field]: value } }));
  };

  const setLinkField = (link: 'github' | 'otherProjects', field: keyof AboutPageConfig['github'], value: string) => {
    updateCurrentDraft((current) => ({ ...current, [link]: { ...current[link], [field]: value } }));
  };

  const setCommunityField = (field: keyof AboutPageConfig['community'], value: string) => {
    updateCurrentDraft((current) => ({ ...current, community: { ...current.community, [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await adminUpdateAboutPage(draft);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="載入 About 設定中…" />;

  return (
    <section className="admin-about-editor mx-auto grid w-full max-w-5xl gap-4">
      <Panel size="lg" className="grid gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-content-primary">About 彈窗</h2>
          <p className="mt-1 text-body leading-relaxed text-content-muted">
            這裡的內容會保存到資料庫，首頁 About 彈窗會依照目前語言讀取對應設定。
          </p>
        </div>
        <SegmentedControl
          className="admin-tablist"
          behavior="tabs"
          size="sm"
          ariaLabel="About 語言"
          options={ABOUT_LANGS.map((lang) => ({ value: lang.code, label: lang.label }))}
          value={activeLocale}
          onChange={setActiveLocale}
        />
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">標題</span>
          <Input value={currentDraft.title} onChange={(e) => setField('title', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">自述文本</span>
          <Textarea
            value={currentDraft.description}
            onChange={(e) => setField('description', e.target.value)}
            rows={3}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">作者名稱</span>
            <Input
              value={currentDraft.author.name}
              onChange={(e) => setPersonField('author', 'name', e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">作者 URL</span>
            <Input value={currentDraft.author.url} onChange={(e) => setPersonField('author', 'url', e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">畫師名稱</span>
            <Input
              value={currentDraft.artist.name}
              onChange={(e) => setPersonField('artist', 'name', e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">畫師 URL</span>
            <Input value={currentDraft.artist.url} onChange={(e) => setPersonField('artist', 'url', e.target.value)} />
          </label>
        </div>
      </Panel>

      <Panel size="lg" className="grid gap-4">
        <div>
          <h3 className="font-display text-lg font-bold text-content-primary">GitHub</h3>
          <p className="mt-1 text-caption leading-relaxed text-content-muted">
            單獨展示倉庫入口，可寫明歡迎貢獻 PR 的說明。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">顯示標題</span>
            <Input
              value={currentDraft.github.title}
              onChange={(e) => setLinkField('github', 'title', e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">URL</span>
            <Input value={currentDraft.github.url} onChange={(e) => setLinkField('github', 'url', e.target.value)} />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">描述</span>
          <Textarea
            value={currentDraft.github.description}
            onChange={(e) => setLinkField('github', 'description', e.target.value)}
            rows={3}
          />
        </label>
      </Panel>

      <Panel size="lg" className="grid gap-4">
        <div>
          <h3 className="font-display text-lg font-bold text-content-primary">其他項目</h3>
          <p className="mt-1 text-caption leading-relaxed text-content-muted">
            指向你的其他 ZUTOMAYO 相關項目，可以用描述補充項目集合的內容。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">顯示標題</span>
            <Input
              value={currentDraft.otherProjects.title}
              onChange={(e) => setLinkField('otherProjects', 'title', e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">URL</span>
            <Input
              value={currentDraft.otherProjects.url}
              onChange={(e) => setLinkField('otherProjects', 'url', e.target.value)}
            />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">描述</span>
          <Textarea
            value={currentDraft.otherProjects.description}
            onChange={(e) => setLinkField('otherProjects', 'description', e.target.value)}
            rows={3}
          />
        </label>
      </Panel>

      <Panel size="lg" className="grid gap-4">
        <div>
          <h3 className="font-display text-lg font-bold text-content-primary">社群</h3>
          <p className="mt-1 text-caption leading-relaxed text-content-muted">
            用來說明可以反饋問題、提出建議以及組局對戰。
          </p>
        </div>
        <label className="grid gap-1">
          <span className="text-xs text-content-primary/50">社群描述</span>
          <Textarea
            value={currentDraft.community.description}
            onChange={(e) => setCommunityField('description', e.target.value)}
            rows={3}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">QQ群 URL</span>
            <Input value={currentDraft.community.qqUrl} onChange={(e) => setCommunityField('qqUrl', e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">Telegram URL</span>
            <Input
              value={currentDraft.community.telegramUrl}
              onChange={(e) => setCommunityField('telegramUrl', e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-content-primary/50">Discord URL</span>
            <Input
              value={currentDraft.community.discordUrl}
              onChange={(e) => setCommunityField('discordUrl', e.target.value)}
            />
          </label>
        </div>
      </Panel>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-border-soft bg-surface-panel-strong/95 p-3 backdrop-blur">
        {success && <Badge tone="jade">已保存到資料庫</Badge>}
        {error && <Badge tone="vermilion">{error}</Badge>}
        <Button type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '儲存中…' : '儲存 About 設定'}
        </Button>
      </div>
    </section>
  );
}

// ===== Main Component =====
export function AdminPage() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem(ADMIN_TOKEN_KEY)));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [checkingLinkedAdmin, setCheckingLinkedAdmin] = useState(() => !sessionStorage.getItem(ADMIN_TOKEN_KEY));
  const [currentAdminRole, setCurrentAdminRole] = useState<AdminRole | null>(readStoredAdminRole);
  const [activeTab, setActiveTab] = useState<AdminTab>('cards');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleEdits, setUserRoleEdits] = useState<Record<string, AdminRole | 'none'>>({});
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState('');
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [chatReports, setChatReports] = useState<ChatReport[]>([]);
  const [chatReportStatus, setChatReportStatus] = useState<'open' | 'reviewing' | 'resolved' | 'dismissed'>('open');
  const [chatReviewingId, setChatReviewingId] = useState<string | null>(null);
  const [chatEvidenceLoadingId, setChatEvidenceLoadingId] = useState<string | null>(null);
  const [chatSanctioningId, setChatSanctioningId] = useState<string | null>(null);
  const [chatModeratingMessageId, setChatModeratingMessageId] = useState<string | null>(null);
  const [chatEvidenceFocusMessageId, setChatEvidenceFocusMessageId] = useState<string | null>(null);
  const [chatEvidence, setChatEvidence] = useState<{
    conversation: ChatConversation;
    messages: ChatMessage[];
  } | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [eloEdits, setEloEdits] = useState<Record<string, string>>({});
  const [eloSavingId, setEloSavingId] = useState<string | null>(null);
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [filterPack, setFilterPack] = useState('all');
  const [errataOnly, setErrataOnly] = useState(false);
  const [filterTrigger, setFilterTrigger] = useState('all');
  const [filterAction, setFilterAction] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [areaExpiryOnly, setAreaExpiryOnly] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'id' | 'name' | 'cost' | 'attack'>('id');
  const [selectedCard, setSelectedCard] = useState<CardDef | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('basic');
  const [showMobileCardFilters, setShowMobileCardFilters] = useState(false);
  const [allCards, setAllCards] = useState(() => getAllCardDefs());
  const [cardLoadStatus, setCardLoadStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(() =>
    getAllCardDefs().length > 0 ? 'loaded' : 'idle',
  );
  const [cardLoadError, setCardLoadError] = useState('');
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '';

  const metaById = useMemo(() => new Map(allCards.map((card) => [card.id, parseCardMeta(card)])), [allCards]);
  const audit = useMemo(() => {
    const metas = [...metaById.values()];
    const effectCards = metas.filter((m) => m.lines.length > 0);
    return {
      totalCards: metas.length,
      effectCards: effectCards.length,
      effectLines: metas.reduce((s, m) => s + m.lines.length, 0),
      parsedLines: metas.reduce((s, m) => s + m.parsed.length, 0),
      unparsedLines: metas.reduce((s, m) => s + m.unparsedLines.length, 0),
      runtimeParsedEffects: metas.reduce(
        (s, m) => s + m.parsed.flatMap((e) => (e.expiry ? [e, e.expiry] : [e])).length,
        0,
      ),
    };
  }, [metaById]);

  const filtered = useMemo(() => {
    let cards = allCards;
    if (filterElement !== 'all') cards = cards.filter((c) => c.element === filterElement);
    if (filterType !== 'all') cards = cards.filter((c) => c.type === filterType);
    if (filterPack !== 'all') cards = cards.filter((c) => c.pack === filterPack);
    if (errataOnly) cards = cards.filter((c) => c.hasOfficialErrata);
    if (filterTrigger !== 'all') cards = cards.filter((c) => metaById.get(c.id)?.triggers.includes(filterTrigger));
    if (filterAction)
      cards = cards.filter((c) =>
        metaById.get(c.id)?.actions.some((a) => a.toLowerCase().includes(filterAction.toLowerCase())),
      );
    if (filterCondition)
      cards = cards.filter((c) =>
        metaById.get(c.id)?.conditions.some((cond) => cond.toLowerCase().includes(filterCondition.toLowerCase())),
      );
    if (pendingOnly) cards = cards.filter((c) => metaById.get(c.id)?.hasPendingChoice);
    if (areaExpiryOnly) cards = cards.filter((c) => metaById.get(c.id)?.hasAreaExpiry);
    if (searchText) {
      const q = searchText.toLowerCase();
      cards = cards.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.effect.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.song.toLowerCase().includes(q),
      );
    }
    return [...cards].sort((a, b) => {
      if (sortBy === 'cost') return a.powerCost - b.powerCost;
      if (sortBy === 'attack')
        return (
          (b.attack ? Math.max(b.attack.night, b.attack.day) : 0) -
          (a.attack ? Math.max(a.attack.night, a.attack.day) : 0)
        );
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    });
  }, [
    allCards,
    areaExpiryOnly,
    filterAction,
    filterCondition,
    filterElement,
    filterPack,
    filterTrigger,
    filterType,
    errataOnly,
    pendingOnly,
    searchText,
    sortBy,
    metaById,
  ]);

  const activeCardFilterCount = [
    filterElement !== 'all',
    filterType !== 'all',
    filterPack !== 'all',
    filterTrigger !== 'all',
    Boolean(filterAction),
    Boolean(filterCondition),
    pendingOnly,
    areaExpiryOnly,
    errataOnly,
    sortBy !== 'id',
  ].filter(Boolean).length;

  const handleLogin = useCallback(async () => {
    setLoggingIn(true);
    setError('');
    try {
      const { token: tok, role } = await adminLogin({ username, password, totpCode });
      sessionStorage.setItem(ADMIN_TOKEN_KEY, tok);
      sessionStorage.setItem(ADMIN_ROLE_KEY, role);
      setCurrentAdminRole(role);
      setAuthenticated(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '登入失敗');
    } finally {
      setLoggingIn(false);
    }
  }, [password, totpCode, username]);

  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_TOKEN_KEY)) {
      setCheckingLinkedAdmin(false);
      return;
    }
    let cancelled = false;
    void adminLoginWithAccount()
      .then(({ token: linkedToken, role }) => {
        if (cancelled) return;
        sessionStorage.setItem(ADMIN_TOKEN_KEY, linkedToken);
        sessionStorage.setItem(ADMIN_ROLE_KEY, role);
        setCurrentAdminRole(role);
        setAuthenticated(true);
      })
      .catch((adminError: unknown) => {
        if (cancelled) return;
        if (
          !(adminError instanceof ApiError) ||
          (adminError.status !== 401 && adminError.status !== 403 && adminError.status !== 404)
        ) {
          setError(adminError instanceof Error ? adminError.message : '管理員身分驗證失敗');
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingLinkedAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    if (token) await adminLogout(token).catch(() => undefined);
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_ROLE_KEY);
    setCurrentAdminRole(null);
    setAuthenticated(false);
  }, [token]);

  const refreshUsers = useCallback(
    async (query = '') => {
      if (!token) return;
      setAdminLoading(true);
      setAdminError('');
      try {
        const { users: u } = await adminGetUsers(token, { query });
        setUsers(u);
        setUserRoleEdits(
          Object.fromEntries(u.map((user) => [user.id, user.adminRole ?? 'none'])) as Record<
            string,
            AdminRole | 'none'
          >,
        );
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '載入失敗');
      } finally {
        setAdminLoading(false);
      }
    },
    [token],
  );

  const updateUserRole = useCallback(
    async (user: AdminUser) => {
      if (!token || currentAdminRole !== 'admin' || user.isCurrentAdmin) return;
      const selectedRole = userRoleEdits[user.id] ?? user.adminRole ?? 'none';
      const nextRole = selectedRole === 'none' ? null : selectedRole;
      if (nextRole === user.adminRole) return;
      if (nextRole === null && !window.confirm(`確定撤回 ${user.email} 的管理權限？`)) return;

      setRoleSavingId(user.id);
      setAdminError('');
      setAdminNotice('');
      try {
        await adminUpdateUserRole(token, user.id, nextRole);
        setAdminNotice(nextRole ? `已將 ${user.email} 設為 ${nextRole}` : `已撤回 ${user.email} 的管理權限`);
        await refreshUsers(userSearch);
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '管理權限更新失敗');
      } finally {
        setRoleSavingId(null);
      }
    },
    [currentAdminRole, refreshUsers, token, userRoleEdits, userSearch],
  );

  const refreshMatches = useCallback(async () => {
    if (!token) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const { matches: m } = await adminGetMatches(token);
      setMatches(m);
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setAdminLoading(false);
    }
  }, [token]);

  const refreshChatReports = useCallback(async () => {
    if (!token) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const { reports } = await adminGetChatReports(token, chatReportStatus);
      setChatReports(reports);
      setChatEvidence(null);
      setChatEvidenceFocusMessageId(null);
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setAdminLoading(false);
    }
  }, [chatReportStatus, token]);

  const reviewChatReport = useCallback(
    async (reportId: string, status: 'reviewing' | 'resolved' | 'dismissed') => {
      if (!token) return;
      setChatReviewingId(reportId);
      setAdminError('');
      try {
        await adminReviewChatReport(token, reportId, { status });
        await refreshChatReports();
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '更新失敗');
      } finally {
        setChatReviewingId(null);
      }
    },
    [refreshChatReports, token],
  );

  const loadChatEvidence = useCallback(
    async (report: ChatReport) => {
      if (!token) return;
      if (chatEvidence?.conversation.id === report.conversationId) {
        setChatEvidence(null);
        setChatEvidenceFocusMessageId(null);
        return;
      }
      setChatEvidenceLoadingId(report.id);
      setAdminError('');
      try {
        const evidence = await adminGetChatConversationMessages(token, report.conversationId, 100);
        setChatEvidence(evidence);
        setChatEvidenceFocusMessageId(report.messageId);
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '載入聊天上下文失敗');
      } finally {
        setChatEvidenceLoadingId(null);
      }
    },
    [chatEvidence?.conversation.id, token],
  );

  const moderateChatMessage = useCallback(
    async (message: ChatMessage, status: 'visible' | 'blocked' | 'deleted') => {
      if (!token) return;
      setChatModeratingMessageId(message.id);
      setAdminError('');
      try {
        const reason =
          status === 'visible'
            ? 'manual_visible'
            : status === 'blocked'
              ? message.moderationReason || 'manual_blocked'
              : 'manual_deleted';
        await adminReviewChatMessageModeration(token, message.id, { status, reason });
        if (chatEvidence) {
          const evidence = await adminGetChatConversationMessages(token, chatEvidence.conversation.id, 100);
          setChatEvidence(evidence);
        }
        const { reports } = await adminGetChatReports(token, chatReportStatus);
        setChatReports(reports);
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '訊息審核失敗');
      } finally {
        setChatModeratingMessageId(null);
      }
    },
    [chatEvidence, chatReportStatus, token],
  );

  const muteReportedAuthor = useCallback(
    async (report: ChatReport) => {
      const targetUserId = report.message?.authorUserId;
      if (!token || !targetUserId) return;
      setChatSanctioningId(report.id);
      setAdminError('');
      try {
        await adminCreateChatUserSanction(token, {
          targetUserId,
          type: 'chat_mute',
          durationMinutes: 1440,
          reason: `chat_report:${report.reason}`,
          sourceReportId: report.id,
          sourceMessageId: report.messageId,
          conversationId: report.conversationId,
        });
        await refreshChatReports();
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '禁言失敗');
      } finally {
        setChatSanctioningId(null);
      }
    },
    [refreshChatReports, token],
  );

  const revokeChatSanction = useCallback(
    async (report: ChatReport) => {
      const sanctionId = report.message?.activeSanction?.id;
      if (!token || !sanctionId) return;
      setChatSanctioningId(report.id);
      setAdminError('');
      try {
        await adminRevokeChatUserSanction(token, sanctionId);
        await refreshChatReports();
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : '解除禁言失敗');
      } finally {
        setChatSanctioningId(null);
      }
    },
    [refreshChatReports, token],
  );

  const loadAdminCards = useCallback(async () => {
    setCardLoadStatus('loading');
    setCardLoadError('');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const cards = await refreshCards();
        const nextCards = cards.length > 0 ? cards : getAllCardDefs();
        if (nextCards.length > 0) {
          setAllCards(nextCards);
          setCardLoadStatus('loaded');
          return;
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
      }
      setAllCards([]);
      setCardLoadStatus('error');
      setCardLoadError('卡牌資料尚未載入，請稍後重試。');
    } catch (e) {
      setCardLoadStatus('error');
      setCardLoadError(e instanceof Error ? e.message : '卡牌資料載入失敗');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'users' && users.length === 0) void refreshUsers();
    if (activeTab === 'matches' && matches.length === 0) void refreshMatches();
    if (activeTab === 'chat') void refreshChatReports();
  }, [activeTab, matches.length, refreshChatReports, refreshMatches, refreshUsers, users.length]);

  useEffect(() => {
    if (!authenticated || activeTab !== 'cards') return;
    if (allCards.length > 0) {
      setCardLoadStatus('loaded');
      return;
    }
    if (cardLoadStatus === 'idle') void loadAdminCards();
  }, [activeTab, allCards.length, authenticated, cardLoadStatus, loadAdminCards]);

  if (checkingLinkedAdmin) {
    return (
      <PageShell className="flex items-center justify-center p-4">
        <LoadingState label="驗證管理員身分中…" />
      </PageShell>
    );
  }

  if (!authenticated) {
    return (
      <PageShell className="flex items-center justify-center p-4">
        <BackButton className="absolute left-4 top-4 min-h-11" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </BackButton>
        <Panel className="w-96 max-w-full" size="lg">
          <div className="grid gap-4">
            <h2 className="font-display text-xl font-bold">管理員驗證</h2>
            <Input
              aria-label="管理員帳號"
              autoComplete="username"
              placeholder="管理員帳號"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loggingIn}
            />
            <Input
              aria-label="管理員密碼"
              autoComplete="current-password"
              type="password"
              placeholder="輸入管理密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loggingIn) void handleLogin();
              }}
              disabled={loggingIn}
            />
            <Input
              aria-label="管理員驗證碼"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="六位數驗證碼"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loggingIn) void handleLogin();
              }}
              disabled={loggingIn}
            />
            <Button
              fullWidth
              onClick={() => void handleLogin()}
              disabled={loggingIn || !username || !password || totpCode.length !== 6}
            >
              {loggingIn ? '驗證中…' : '登入'}
            </Button>
            {error && (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            )}
          </div>
        </Panel>
      </PageShell>
    );
  }

  const selectedMeta = selectedCard ? metaById.get(selectedCard.id) : null;
  const CardModal =
    selectedCard && selectedMeta ? (
      <Dialog
        open
        onOpenChange={(open) => !open && setSelectedCard(null)}
        title={selectedCard.name}
        size="lg"
        className="admin-card-dialog"
        footer={
          <Button variant="secondary" type="button" onClick={() => setSelectedCard(null)}>
            關閉
          </Button>
        }
      >
        <div className="grid gap-4">
          <div className="admin-card-modal-summary flex items-center gap-3">
            <CardImage
              cardId={selectedCard.id}
              context="thumbnail"
              alt={selectedCard.name}
              className="h-20 w-14 rounded object-contain"
              loading="eager"
              referrerPolicy="no-referrer"
            />
            <div>
              <h3 className="text-lg font-bold">{selectedCard.name}</h3>
              <p className="font-mono text-xs opacity-70">{selectedCard.id}</p>
            </div>
          </div>
          <div role="tablist" className="admin-card-modal-tabs mt-4 flex flex-wrap gap-2">
            {(
              [
                ['basic', '基本資訊'],
                ['engine', '效果引擎'],
                ['i18n', '多語言'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                role="tab"
                variant={modalTab === key ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setModalTab(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="admin-card-modal-body mt-4 max-h-[60vh] overflow-y-auto pr-1">
            {modalTab === 'basic' && (
              <CardEditForm
                card={selectedCard}
                onSaved={(updated) => {
                  setSelectedCard(updated);
                  setAllCards((cards) => cards.map((card) => (card.id === updated.id ? updated : card)));
                  void refreshCards().then(() => setAllCards(getAllCardDefs()));
                }}
              />
            )}
            {modalTab === 'engine' && <EffectInspector meta={selectedMeta} />}
            {modalTab === 'i18n' && <I18nEditor card={selectedCard} />}
          </div>
        </div>
      </Dialog>
    ) : null;

  return (
    <PageShell className="card-admin-page admin-page flex flex-col">
      <ToolHeader
        className="admin-header"
        leading={
          <div className="admin-title-row flex items-center gap-2">
            <BackButton className="min-h-11" onClick={() => navigate('/')}>
              {t('common.backToLobby')}
            </BackButton>
            {activeTab === 'cards' && (
              <Badge>
                {filtered.length} / {allCards.length} 張
              </Badge>
            )}
          </div>
        }
        title={<span className="admin-heading">管理員面板</span>}
        actions={
          <>
            <SegmentedControl
              className="admin-tablist"
              behavior="tabs"
              size="sm"
              ariaLabel="管理員分頁"
              options={[
                { value: 'cards', label: '卡牌資料' },
                { value: 'users', label: '使用者' },
                { value: 'matches', label: '對戰' },
                { value: 'chat', label: '聊天' },
                { value: 'operations', label: t('admin.operations') },
                { value: 'about', label: 'About' },
              ]}
              value={activeTab}
              onChange={setActiveTab}
            />
            <div className="admin-header-actions">
              <Button
                aria-label="登出"
                className="admin-logout-button size-11 p-0 sm:size-auto sm:min-h-11 sm:px-3"
                variant="secondary"
                size="sm"
                onClick={() => void handleLogout()}
              >
                <LogOut className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">登出</span>
              </Button>
            </div>
          </>
        }
      />

      {activeTab === 'cards' && (
        <div className="admin-main flex-1 overflow-y-auto p-4">
          <StatsGrid className="admin-stats-grid" columns={5}>
            <StatCard label="總卡" value={audit.totalCards} />
            <StatCard label="效果卡" value={audit.effectCards} />
            <StatCard label="效果行" value={`${audit.parsedLines}/${audit.effectLines}`} />
            <StatCard label="未解析" value={audit.unparsedLines} />
            <StatCard label="Runtime effects" value={audit.runtimeParsedEffects} />
          </StatsGrid>
          <div className="admin-filter-panel grid gap-3 py-4">
            <Input
              type="text"
              placeholder="搜尋卡名/效果/ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="admin-search-input max-w-md"
            />
            <div className="admin-mobile-filter-summary">
              <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-primary/50">
                {filtered.length} results
                {activeCardFilterCount > 0 ? ` / ${activeCardFilterCount} filters` : ''}
              </span>
              <Button
                size="sm"
                variant={showMobileCardFilters ? 'primary' : 'secondary'}
                leftIcon={<SlidersHorizontal className="size-3.5" aria-hidden="true" />}
                aria-expanded={showMobileCardFilters}
                onClick={() => setShowMobileCardFilters((value) => !value)}
              >
                篩選
              </Button>
            </div>
            <div className={`admin-filter-advanced${showMobileCardFilters ? ' admin-filter-advanced-open' : ''}`}>
              <div className="admin-filter-row flex flex-wrap items-center gap-2">
                <span className="admin-filter-label w-12 text-xs text-content-primary/50">屬性</span>
                {ELEMENTS.map((el) => (
                  <Button
                    key={el}
                    size="sm"
                    variant={filterElement === el ? 'primary' : 'ghost'}
                    onClick={() => setFilterElement(el)}
                  >
                    {el === 'all' ? '全部' : el}
                  </Button>
                ))}
              </div>
              <div className="admin-filter-row flex flex-wrap items-center gap-2">
                <span className="admin-filter-label w-12 text-xs text-content-primary/50">類型</span>
                {TYPES.map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={filterType === type ? 'primary' : 'ghost'}
                    onClick={() => setFilterType(type)}
                  >
                    {type === 'all' ? '全部' : type === 'Character' ? '角色' : type === 'Enchant' ? '附魔' : '區域'}
                  </Button>
                ))}
              </div>
              <div className="admin-filter-row flex flex-wrap items-center gap-2">
                <span className="admin-filter-label w-12 text-xs text-content-primary/50">Trigger</span>
                {TRIGGERS.map((trigger) => (
                  <Button
                    key={trigger}
                    size="sm"
                    variant={filterTrigger === trigger ? 'primary' : 'ghost'}
                    onClick={() => setFilterTrigger(trigger)}
                  >
                    {trigger === 'all' ? '全部' : trigger}
                  </Button>
                ))}
              </div>
              <div className="admin-filter-row flex flex-wrap items-center gap-2">
                <span className="admin-filter-label w-12 text-xs text-content-primary/50">引擎</span>
                <Input
                  className="w-36"
                  placeholder="Action type"
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                />
                <Input
                  className="w-36"
                  placeholder="Condition type"
                  value={filterCondition}
                  onChange={(e) => setFilterCondition(e.target.value)}
                />
                <Button size="sm" variant={pendingOnly ? 'primary' : 'ghost'} onClick={() => setPendingOnly((v) => !v)}>
                  待選卡
                </Button>
                <Button
                  size="sm"
                  variant={areaExpiryOnly ? 'primary' : 'ghost'}
                  onClick={() => setAreaExpiryOnly((v) => !v)}
                >
                  Area expiry
                </Button>
                <Button
                  size="sm"
                  variant={errataOnly ? 'primary' : 'ghost'}
                  onClick={() => setErrataOnly((value) => !value)}
                >
                  官方勘誤
                </Button>
              </div>
              <div className="admin-filter-row flex flex-wrap items-center gap-2">
                <span className="admin-filter-label w-12 text-xs text-content-primary/50">卡包</span>
                {FALLBACK_PACKS.map((pack) => (
                  <Button
                    key={pack}
                    size="sm"
                    variant={filterPack === pack ? 'primary' : 'ghost'}
                    onClick={() => setFilterPack(pack)}
                  >
                    {pack === 'all' ? '全部' : pack}
                  </Button>
                ))}
              </div>
              <div className="admin-filter-row flex flex-wrap items-center gap-2">
                <span className="admin-filter-label w-12 text-xs text-content-primary/50">排序</span>
                {(['id', 'name', 'cost', 'attack'] as const).map((sort) => (
                  <Button
                    key={sort}
                    size="sm"
                    variant={sortBy === sort ? 'primary' : 'ghost'}
                    onClick={() => setSortBy(sort)}
                  >
                    {sort === 'id' ? '編號' : sort === 'name' ? '名稱' : sort === 'cost' ? '充能成本' : '攻擊'}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          {cardLoadStatus === 'loading' && allCards.length === 0 && (
            <LoadingState className="min-h-48" label="載入卡牌資料中…" />
          )}
          {cardLoadStatus === 'error' && allCards.length === 0 && (
            <EmptyState
              className="min-h-48"
              title="卡牌資料未載入"
              description={cardLoadError || '請確認 API 服務後重新載入。'}
              actions={
                <Button type="button" onClick={() => void loadAdminCards()}>
                  重新載入
                </Button>
              }
            />
          )}
          {allCards.length > 0 && filtered.length === 0 && (
            <EmptyState className="min-h-48" title="沒有符合條件的卡牌" description="調整搜尋或篩選條件後再試一次。" />
          )}
          {allCards.length > 0 && filtered.length > 0 && (
            <div className="admin-card-grid grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {filtered.map((card) => {
                const meta = metaById.get(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    className="group relative overflow-hidden rounded-sm bg-surface-base text-left ring-1 ring-content-primary/10 transition hover:-translate-y-1 hover:ring-accent-primary/40 focus:outline-none focus:ring-2 focus:ring-accent-primary/60"
                    onClick={() => {
                      setSelectedCard(card);
                      setModalTab('basic');
                    }}
                  >
                    <CardImage
                      className="aspect-[5/7] w-full object-contain opacity-80 transition group-hover:opacity-100"
                      cardId={card.id}
                      context="thumbnail"
                      alt={card.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-surface-canvas/80 p-3 backdrop-blur">
                      {card.hasOfficialErrata && (
                        <Badge className="mb-1" tone="gold">
                          官方勘誤 #{card.officialErrataId}
                        </Badge>
                      )}
                      <h2 className="block truncate text-sm font-bold">{card.name}</h2>
                      <p className="font-mono text-xs opacity-80">{card.id}</p>
                      <p className="text-xs opacity-80">
                        {card.element} • {card.type === 'Character' ? '角' : card.type === 'Enchant' ? '附' : '域'}
                        {card.type === 'Character' && card.attack && ` • ${card.attack.night}/${card.attack.day}`}
                        {card.powerCost > 0 && ` • ${card.powerCost}`}
                      </p>
                    </div>
                    {card.effect && (
                      <Badge
                        tone={meta?.unparsedLines.length ? 'vermilion' : 'gold'}
                        className="absolute right-2 top-2"
                      >
                        {meta?.parsed.length ?? 0}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <section className="admin-table-section flex-1 overflow-auto p-4">
          <form
            className="mb-4 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAdminNotice('');
              void refreshUsers(userSearch);
            }}
          >
            <SearchInput
              className="min-w-0"
              containerClassName="admin-search-input"
              icon={<Search className="size-4 shrink-0 text-content-dim" aria-hidden="true" />}
              aria-label="搜尋使用者"
              placeholder="搜尋 Email、暱稱或 ID"
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
            />
            <Button type="submit" size="sm">
              搜尋
            </Button>
            <Badge>{users.length} 位</Badge>
          </form>
          {adminLoading && <LoadingState className="mb-3" label="載入中…" />}
          {adminNotice && (
            <Alert className="mb-3" tone="success">
              {adminNotice}
            </Alert>
          )}
          {adminError && (
            <Alert className="mb-3" tone="danger" role="alert">
              {adminError}
            </Alert>
          )}
          {!adminLoading && users.length === 0 ? (
            <EmptyState className="min-h-48" title="找不到使用者" />
          ) : (
            <DataListTable className="admin-responsive-table admin-users-table">
              <thead className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                <tr className="border-b border-content-primary/10">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">暱稱</th>
                  <th className="px-3 py-2">ELO</th>
                  <th className="px-3 py-2">場次</th>
                  <th className="px-3 py-2">勝率</th>
                  {currentAdminRole === 'admin' && <th className="px-3 py-2">管理權限</th>}
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="odd:bg-surface-base/50">
                    <DataListCell label="ID" className="max-w-32 truncate font-mono text-xs opacity-70">
                      {u.id}
                    </DataListCell>
                    <DataListCell label="Email">{u.email}</DataListCell>
                    <DataListCell label="暱稱">{u.nickname}</DataListCell>
                    <DataListCell label="ELO">
                      <div className="admin-elo-field flex items-center gap-2">
                        {eloEdits[u.id] ?? u.elo}
                        <Input
                          className="w-20"
                          value={eloEdits[u.id] ?? ''}
                          placeholder={String(u.elo)}
                          onChange={(e) => setEloEdits((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        />
                      </div>
                    </DataListCell>
                    <DataListCell label="場次">{u.matchCount}</DataListCell>
                    <DataListCell label="勝率">{u.winRate}%</DataListCell>
                    {currentAdminRole === 'admin' && (
                      <DataListCell label="管理權限">
                        <div className="admin-role-field flex items-center gap-2">
                          <Select
                            className="min-w-36"
                            aria-label={`${u.email} 的管理權限`}
                            disabled={u.isCurrentAdmin || roleSavingId === u.id}
                            value={userRoleEdits[u.id] ?? u.adminRole ?? 'none'}
                            onChange={(event) =>
                              setUserRoleEdits((previous) => ({
                                ...previous,
                                [u.id]: event.target.value as AdminRole | 'none',
                              }))
                            }
                          >
                            <option value="none">無管理權限</option>
                            <option value="viewer">viewer</option>
                            <option value="moderator">moderator</option>
                            <option value="operator">operator</option>
                            <option value="admin">admin</option>
                          </Select>
                          {u.isCurrentAdmin ? (
                            <Badge tone="gold">目前帳號</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              leftIcon={<ShieldCheck className="size-4" aria-hidden="true" />}
                              disabled={
                                roleSavingId === u.id ||
                                (userRoleEdits[u.id] ?? u.adminRole ?? 'none') === (u.adminRole ?? 'none')
                              }
                              onClick={() => void updateUserRole(u)}
                            >
                              {roleSavingId === u.id ? '套用中…' : '套用'}
                            </Button>
                          )}
                        </div>
                      </DataListCell>
                    )}
                    <DataListCell label="操作">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={eloSavingId === u.id}
                        onClick={() => {
                          const v = Number(eloEdits[u.id]);
                          if (!Number.isFinite(v)) return;
                          void adminResetElo(token, u.id, Math.trunc(v))
                            .then(() => refreshUsers(userSearch))
                            .then(() =>
                              setEloEdits((p) => {
                                const n = { ...p };
                                delete n[u.id];
                                return n;
                              }),
                            );
                          setEloSavingId(u.id);
                          setTimeout(() => setEloSavingId(null), 1500);
                        }}
                      >
                        {eloSavingId === u.id ? '已更新' : '更新 ELO'}
                      </Button>
                    </DataListCell>
                  </tr>
                ))}
              </tbody>
            </DataListTable>
          )}
        </section>
      )}

      {activeTab === 'matches' && (
        <section className="admin-table-section flex-1 overflow-auto p-4">
          {adminLoading && <LoadingState className="mb-3" label="載入中…" />}
          {adminError && (
            <Alert className="mb-3" tone="danger" role="alert">
              {adminError}
            </Alert>
          )}
          <DataListTable className="admin-responsive-table">
            <thead className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
              <tr className="border-b border-content-primary/10">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">勝者</th>
                <th className="px-3 py-2">敗者</th>
                <th className="px-3 py-2">ELO Δ</th>
                <th className="px-3 py-2">回合</th>
                <th className="px-3 py-2">時長</th>
                <th className="px-3 py-2">時間</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id} className="odd:bg-surface-base/50">
                  <DataListCell label="ID" className="max-w-32 truncate font-mono text-xs opacity-70">
                    {m.id}
                  </DataListCell>
                  <DataListCell label="勝者">{m.winnerNickname ?? m.winnerId}</DataListCell>
                  <DataListCell label="敗者">{m.loserNickname ?? m.loserId}</DataListCell>
                  <DataListCell label="ELO Δ">
                    {m.winnerEloChange >= 0 ? '+' : ''}
                    {m.winnerEloChange} / {m.loserEloChange}
                  </DataListCell>
                  <DataListCell label="回合">{m.turns ?? '—'}</DataListCell>
                  <DataListCell label="時長">
                    {m.duration != null ? `${Math.round(m.duration / 60)}m` : '—'}
                  </DataListCell>
                  <DataListCell label="時間">{new Date(m.createdAt).toLocaleString()}</DataListCell>
                </tr>
              ))}
            </tbody>
          </DataListTable>
        </section>
      )}

      {activeTab === 'chat' && (
        <section className="admin-table-section flex-1 overflow-auto p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              behavior="tabs"
              size="sm"
              ariaLabel="聊天舉報狀態"
              options={[
                { value: 'open', label: 'Open' },
                { value: 'reviewing', label: 'Reviewing' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'dismissed', label: 'Dismissed' },
              ]}
              value={chatReportStatus}
              onChange={setChatReportStatus}
            />
            <Button size="sm" variant="secondary" onClick={() => void refreshChatReports()}>
              重新整理
            </Button>
          </div>
          {adminLoading && <LoadingState className="mb-3" label="載入中…" />}
          {adminError && (
            <Alert className="mb-3" tone="danger" role="alert">
              {adminError}
            </Alert>
          )}
          {chatReports.length === 0 && !adminLoading ? (
            <EmptyState className="min-h-48" title="沒有聊天舉報" description="目前篩選條件下沒有待處理項目。" />
          ) : (
            <>
              <DataListTable className="admin-responsive-table">
                <thead className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                  <tr className="border-b border-content-primary/10">
                    <th className="px-3 py-2">狀態</th>
                    <th className="px-3 py-2">訊息</th>
                    <th className="px-3 py-2">舉報</th>
                    <th className="px-3 py-2">時間</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {chatReports.map((report) => (
                    <tr key={report.id} className="odd:bg-surface-base/50">
                      <DataListCell label="狀態">
                        <Badge
                          tone={
                            report.status === 'resolved' ? 'jade' : report.status === 'dismissed' ? 'neutral' : 'gold'
                          }
                        >
                          {report.status}
                        </Badge>
                      </DataListCell>
                      <DataListCell label="訊息">
                        <div className="grid max-w-xl gap-1">
                          <span className="font-mono text-xs text-content-primary/50">{report.conversationId}</span>
                          <span className="text-xs text-content-primary/60">
                            {report.message?.authorDisplayName || report.message?.authorUserId || 'Unknown'}
                          </span>
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {report.message?.content || '訊息已刪除或無法讀取'}
                          </p>
                          {report.message?.activeSanction && (
                            <span className="text-xs text-accent-action">
                              已禁言至{' '}
                              {report.message.activeSanction.expiresAt
                                ? new Date(report.message.activeSanction.expiresAt).toLocaleString()
                                : '永久'}
                            </span>
                          )}
                        </div>
                      </DataListCell>
                      <DataListCell label="舉報">
                        <div className="grid gap-1">
                          <span>{report.reason}</span>
                          {report.note && <span className="text-xs text-content-primary/60">{report.note}</span>}
                          <span className="font-mono text-xs text-content-primary/50">
                            by {report.reporterUserId || 'unknown'}
                          </span>
                        </div>
                      </DataListCell>
                      <DataListCell label="時間">{new Date(report.createdAt).toLocaleString()}</DataListCell>
                      <DataListCell label="操作">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={chatEvidenceLoadingId === report.id}
                            onClick={() => void loadChatEvidence(report)}
                          >
                            {chatEvidenceLoadingId === report.id ? '載入中…' : '上下文'}
                          </Button>
                          {report.message?.activeSanction ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={chatSanctioningId === report.id}
                              onClick={() => void revokeChatSanction(report)}
                            >
                              解除禁言
                            </Button>
                          ) : (
                            report.message?.authorUserId && (
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={chatSanctioningId === report.id}
                                onClick={() => void muteReportedAuthor(report)}
                              >
                                禁言 24h
                              </Button>
                            )
                          )}
                          {report.status === 'open' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={chatReviewingId === report.id}
                              onClick={() => void reviewChatReport(report.id, 'reviewing')}
                            >
                              標記審核中
                            </Button>
                          )}
                          {report.status !== 'resolved' && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={chatReviewingId === report.id}
                              onClick={() => void reviewChatReport(report.id, 'resolved')}
                            >
                              已處理
                            </Button>
                          )}
                          {report.status !== 'dismissed' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={chatReviewingId === report.id}
                              onClick={() => void reviewChatReport(report.id, 'dismissed')}
                            >
                              駁回
                            </Button>
                          )}
                        </div>
                      </DataListCell>
                    </tr>
                  ))}
                </tbody>
              </DataListTable>

              {chatEvidence && (
                <div className="mt-4 border-t border-border-soft pt-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-1">
                      <h3 className="text-sm font-semibold text-content-primary">聊天上下文</h3>
                      <span className="font-mono text-xs text-content-primary/50">{chatEvidence.conversation.id}</span>
                    </div>
                    <Badge tone="neutral">{chatEvidence.messages.length} messages</Badge>
                  </div>
                  <div className="grid gap-2">
                    {chatEvidence.messages.map((message) => {
                      const isFocused = message.id === chatEvidenceFocusMessageId;
                      return (
                        <div
                          key={message.id}
                          className={`grid gap-1 border-l-2 px-3 py-2 ${
                            isFocused
                              ? 'border-accent-primary bg-accent-primary/10'
                              : 'border-content-primary/10 bg-surface-base/40'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs text-content-primary/60">
                            <span className="font-mono text-content-primary/50">{message.id}</span>
                            <span>{message.authorDisplayName || message.authorUserId || 'Unknown'}</span>
                            <Badge
                              tone={
                                message.moderationStatus === 'blocked'
                                  ? 'vermilion'
                                  : message.moderationStatus === 'pending_review'
                                    ? 'gold'
                                    : message.deletedAt
                                      ? 'neutral'
                                      : 'jade'
                              }
                            >
                              {message.deletedAt ? 'deleted' : message.moderationStatus}
                            </Badge>
                            <span>{new Date(message.createdAt).toLocaleString()}</span>
                            <div className="ml-auto flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={
                                  chatModeratingMessageId === message.id || message.moderationStatus === 'visible'
                                }
                                onClick={() => void moderateChatMessage(message, 'visible')}
                              >
                                放行
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={
                                  chatModeratingMessageId === message.id || message.moderationStatus === 'blocked'
                                }
                                onClick={() => void moderateChatMessage(message, 'blocked')}
                              >
                                封鎖
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={
                                  chatModeratingMessageId === message.id || message.moderationStatus === 'deleted'
                                }
                                onClick={() => void moderateChatMessage(message, 'deleted')}
                              >
                                刪除
                              </Button>
                            </div>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-content-primary">
                            {message.content || '（空白訊息）'}
                          </p>
                          {message.moderationReason && (
                            <span className="text-xs text-content-primary/50">{message.moderationReason}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'about' && (
        <section className="admin-main flex-1 overflow-y-auto p-4">
          <AboutSettingsEditor />
        </section>
      )}

      {activeTab === 'operations' && (
        <section className="admin-main flex-1 overflow-y-auto p-4">
          <AdminOperationsPanel token={token} />
        </section>
      )}

      {CardModal}
    </PageShell>
  );
}
