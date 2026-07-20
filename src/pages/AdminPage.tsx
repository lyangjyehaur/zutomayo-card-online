import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpenText,
  Database,
  ExternalLink,
  Info,
  Languages,
  Library,
  Lock,
  LockOpen,
  LogOut,
  MessageSquareWarning,
  Megaphone,
  Music2,
  Save,
  Search,
  Share2,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Users,
  ZoomIn,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getAllCardDefs, loadConfigFromAPI, refreshCards } from '../game/cards/loader';
import { matchesLocalizedCardSearch } from '../game/cards/i18n';
import {
  CARD_SONG_TITLES_I18N_CONFIG_KEY,
  normalizeSongTitleConfig,
  type SongTitleConfig,
} from '../game/cards/songTitleConfig';
import { parseEffect } from '../game/effects/parser';
import type { ParsedEffect } from '../game/effects';
import type { CardDef, CardType, Element } from '../game/types';
import {
  ApiError,
  adminCreateChatUserSanction,
  adminGetChatConversationMessages,
  adminGetChatReports,
  adminGetCardOfficialErrata,
  adminGetMatches,
  adminGetUsers,
  adminLogin,
  adminLoginWithAccount,
  adminLogout,
  adminRevokeChatUserSanction,
  adminReviewChatMessageModeration,
  adminReviewChatReport,
  adminUpdateUserRole,
  adminUpdateAboutPage,
  adminUpdateCard,
  adminUpdateCardI18n,
  adminUpdateConfig,
  DEFAULT_ABOUT_PAGE_I18N_CONFIG,
  fetchAboutPageI18n,
  fetchCardTextsI18n,
  fetchGameConfig,
} from '../api/client';
import type {
  AboutPageConfig,
  AboutPageI18nConfig,
  AboutPageLocale,
  AdminMatch,
  AdminRole,
  AdminUser,
  CardOfficialErrata,
  ChatConversation,
  ChatMessage,
  ChatReport,
} from '../api/client';
import {
  Badge,
  BackButton,
  Button,
  Checkbox,
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
  Textarea,
} from '../ui';
import { CardImage } from '../components/CardImage';
import { AdminOperationsPanel } from '../components/AdminOperationsPanel';
import { AdminAnnouncementsPanel } from '../components/AdminAnnouncementsPanel';
import { AdminTranslationSettingsPanel } from '../components/AdminTranslationSettingsPanel';
import { AdminDeckShareReportsPanel } from '../components/AdminDeckShareReportsPanel';
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
const PACK_FILTERS = ['all', ...FALLBACK_PACKS];
const CARD_ID_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
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

type AdminTab =
  | 'cards'
  | 'songs'
  | 'users'
  | 'matches'
  | 'chat'
  | 'deck-shares'
  | 'operations'
  | 'about'
  | 'announcements'
  | 'translation';
type CardEditorTab = 'overview' | 'official' | 'i18n' | 'engine';
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

type SongTitleLocale = Exclude<(typeof I18N_LANGS)[number]['code'], 'ja'>;

const SONG_TITLE_LANGS = I18N_LANGS.filter((lang) => lang.code !== 'ja');

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
      <div className="admin-engine-block">
        <div className="grid gap-2">
          <strong>原文</strong>
          {meta.lines.map((l) => (
            <p className="whitespace-pre-wrap" key={l}>
              {l}
            </p>
          ))}
        </div>
      </div>
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
        <article className="admin-engine-block" key={`${effect.rawText}-${i}`}>
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
        </article>
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
const ERRATA_ENGLISH_SOURCE_LABELS: Record<string, string> = {
  official_errata_notice: '官方勘誤公告',
  official_card_print_unaffected: '卡面英文未受影響',
  official_card_print_corrected: '卡面英文最小修正',
  official_japanese_errata_translation: '依修正後日文翻譯',
};

function OfficialErrataPanel({ card, legacyNote }: { card: CardDef; legacyNote: string }) {
  const [errata, setErrata] = useState<CardOfficialErrata | null>(null);
  const [loading, setLoading] = useState(card.hasOfficialErrata);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setErrata(null);
    setError('');
    if (!card.hasOfficialErrata) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    adminGetCardOfficialErrata(card.id)
      .then((value) => {
        if (active) setErrata(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '載入官方勘誤失敗');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [card.hasOfficialErrata, card.id]);

  if (loading) return <LoadingState label="載入官方勘誤中…" />;
  if (error) {
    return (
      <Alert tone="danger" role="alert">
        {error}
      </Alert>
    );
  }
  if (!errata) {
    return legacyNote ? (
      <div className="admin-errata-legacy">
        <span>舊卡牌備註</span>
        <p>{legacyNote}</p>
      </div>
    ) : (
      <p className="admin-errata-empty">此卡沒有官方勘誤</p>
    );
  }

  const sourceLabel = ERRATA_ENGLISH_SOURCE_LABELS[errata.correctedEnglishSource] || errata.correctedEnglishSource;
  const englishStatus =
    errata.correctedEnglishStatus === 'official'
      ? '官方'
      : errata.correctedEnglishStatus === 'verified'
        ? '已複核'
        : '待複核';

  return (
    <div className="admin-errata-detail">
      <div className="admin-errata-meta">
        <div>
          {errata.affectsName && <Badge tone="gold">影響名稱</Badge>}
          {errata.affectsEffect && <Badge tone="gold">影響效果</Badge>}
          {errata.publishedAt && <Badge>{errata.publishedAt}</Badge>}
        </div>
        <a
          href={errata.sourceUrl || card.officialErrataUrl}
          target="_blank"
          rel="noreferrer"
          className="admin-errata-source-link"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          官方來源
        </a>
      </div>
      <div className="admin-errata-text-grid">
        <div className="admin-reference-block">
          <span>勘誤前</span>
          <p>{errata.incorrectText || '—'}</p>
        </div>
        <div className="admin-reference-block">
          <span>修正後日文</span>
          <p>{errata.correctedJapaneseText || '—'}</p>
        </div>
        <div className="admin-reference-block">
          <span>修正後英文 · {englishStatus}</span>
          <p>{errata.correctedEnglishText || '—'}</p>
          {sourceLabel && <small>{sourceLabel}</small>}
        </div>
      </div>
    </div>
  );
}

function CardEditForm({
  card,
  section,
  locked,
  onSaved,
  onDirtyChange,
}: {
  card: CardDef;
  section: 'overview' | 'official';
  locked: boolean;
  onSaved: (updated: CardDef) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<CardEditDraft>(() => cardToDraft(card));
  const [savedDraft, setSavedDraft] = useState<CardEditDraft>(() => cardToDraft(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  useEffect(() => {
    const nextDraft = cardToDraft(card);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setSuccess(false);
    setError('');
  }, [card]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const set = (field: keyof CardEditDraft, value: string) => {
    setSuccess(false);
    setDraft((d) => ({ ...d, [field]: value }));
  };

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
      setSavedDraft(draft);
      setSuccess(true);
      onSaved({ ...card, ...patch } as CardDef);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-card-form">
      <fieldset className="admin-card-core-fields" disabled={locked}>
        {section === 'overview' ? (
          <div className="admin-editor-section-grid">
            <section className="admin-editor-section">
              <div className="admin-editor-section-heading">
                <h3>卡牌規格</h3>
                <span>{card.id}</span>
              </div>
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
                    <Input
                      type="number"
                      value={draft.attackNight}
                      onChange={(e) => set('attackNight', e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-content-primary/50">日間攻擊</span>
                    <Input type="number" value={draft.attackDay} onChange={(e) => set('attackDay', e.target.value)} />
                  </label>
                </div>
              )}
            </section>

            <section className="admin-editor-section">
              <div className="admin-editor-section-heading">
                <h3>來源資訊</h3>
              </div>
              <label className="grid gap-1">
                <span className="text-xs text-content-primary/50">歌曲</span>
                <Input value={draft.song} onChange={(e) => set('song', e.target.value)} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs text-content-primary/50">畫師</span>
                  <Input value={draft.illustrator} onChange={(e) => set('illustrator', e.target.value)} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-content-primary/50">卡包</span>
                  <Select value={draft.pack} onChange={(e) => set('pack', e.target.value)}>
                    {FALLBACK_PACKS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-xs text-content-primary/50">圖片 URL</span>
                <Input value={draft.image} onChange={(e) => set('image', e.target.value)} />
              </label>
            </section>

            <section className="admin-editor-section admin-editor-section-wide">
              <div className="admin-editor-section-heading">
                <h3>官方勘誤</h3>
                {card.hasOfficialErrata && <Badge tone="gold">#{card.officialErrataId}</Badge>}
              </div>
              <OfficialErrataPanel card={card} legacyNote={draft.errata} />
            </section>
          </div>
        ) : (
          <div className="admin-editor-section-grid">
            <section className="admin-editor-section">
              <div className="admin-editor-section-heading">
                <h3>日本語</h3>
                <Badge>官方有效文本</Badge>
              </div>
              <label className="grid gap-1">
                <span className="text-xs text-content-primary/50">卡牌名稱</span>
                <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-content-primary/50">卡牌效果</span>
                <Textarea value={draft.effect} onChange={(e) => set('effect', e.target.value)} rows={12} />
              </label>
            </section>
            <section className="admin-editor-section">
              <div className="admin-editor-section-heading">
                <h3>English</h3>
                <Badge>官方有效文本</Badge>
              </div>
              <label className="grid gap-1">
                <span className="text-xs text-content-primary/50">Card name</span>
                <Input value={draft.enNameOfficial} onChange={(e) => set('enNameOfficial', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-content-primary/50">Card effect</span>
                <Textarea
                  value={draft.enEffectOfficial}
                  onChange={(e) => set('enEffectOfficial', e.target.value)}
                  rows={12}
                />
              </label>
            </section>
          </div>
        )}
      </fieldset>
      <div className="admin-editor-savebar">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {locked && <Badge>核心資料已鎖定</Badge>}
          {dirty && <Badge tone="gold">尚未儲存</Badge>}
          {success && <Badge tone="jade">已儲存</Badge>}
          {error && <Badge tone="vermilion">{error}</Badge>}
        </div>
        <Button
          type="button"
          leftIcon={<Save className="size-4" aria-hidden="true" />}
          disabled={locked || saving || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? '儲存中…' : '儲存卡牌'}
        </Button>
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

function I18nEditor({ card, onDirtyChange }: { card: CardDef; onDirtyChange?: (dirty: boolean) => void }) {
  const cardId = card.id;
  const [draft, setDraft] = useState<Record<string, CardTextDraft>>({});
  const [savedDraft, setSavedDraft] = useState<Record<string, CardTextDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
        setSavedDraft(init);
      })
      .catch(() => {
        const init: Record<string, CardTextDraft> = {};
        for (const lang of DERIVED_I18N_LANGS) {
          init[lang.code] = { name: '', effect: '', reviewStatus: 'pending_review', reviewNote: '' };
        }
        setDraft(init);
        setSavedDraft(init);
      })
      .finally(() => setLoading(false));
  }, [card.effect, card.enEffectOfficial, card.enNameOfficial, card.name, cardId]);

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
      setSavedDraft(draft);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="載入翻譯中…" />;

  return (
    <div className="admin-card-form">
      <section className="admin-i18n-reference" aria-label="官方日文與英文對照">
        <div className="admin-editor-section-heading">
          <h3>官方日英對照</h3>
          {card.hasOfficialErrata && <Badge tone="gold">含官方勘誤</Badge>}
        </div>
        <div className="admin-i18n-reference-grid">
          <div className="admin-i18n-reference-language">
            <div className="admin-i18n-reference-heading">
              <strong>日本語</strong>
              <span>{card.hasOfficialErrata ? '勘誤後有效日文' : '官方有效日文'}</span>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-content-primary/50">卡牌名稱</span>
              <Input readOnly value={card.name} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-content-primary/50">卡牌效果</span>
              <Textarea readOnly value={card.effect} rows={5} />
            </label>
          </div>
          <div className="admin-i18n-reference-language">
            <div className="admin-i18n-reference-heading">
              <strong>English</strong>
              <span>
                {card.officialErrataAffectsName || card.officialErrataAffectsEffect ? '勘誤後有效英文' : '官方有效英文'}
              </span>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-content-primary/50">Card name</span>
              <Input readOnly value={card.enNameOfficial || ''} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-content-primary/50">Card effect</span>
              <Textarea readOnly value={card.enEffectOfficial || ''} rows={5} />
            </label>
          </div>
        </div>
      </section>
      <div className="admin-editor-section-grid">
        {DERIVED_I18N_LANGS.map((lang) => {
          const entry = draft[lang.code] ?? { name: '', effect: '', reviewStatus: 'pending_review', reviewNote: '' };
          const update = (patch: Partial<CardTextDraft>) =>
            setDraft((current) => ({ ...current, [lang.code]: { ...entry, ...patch } }));
          return (
            <section className="admin-editor-section" key={lang.code}>
              <div className="admin-editor-section-heading">
                <h3>{lang.label}</h3>
                <span>{lang.code}</span>
              </div>
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
            </section>
          );
        })}
      </div>
      <div className="admin-editor-savebar">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {dirty && <Badge tone="gold">尚未儲存</Badge>}
          {success && <Badge tone="jade">已儲存</Badge>}
          {error && <Badge tone="vermilion">{error}</Badge>}
        </div>
        <Button
          type="button"
          leftIcon={<Save className="size-4" aria-hidden="true" />}
          disabled={saving || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? '儲存中…' : '儲存翻譯'}
        </Button>
      </div>
    </div>
  );
}

function SongTitleEditor({ cards }: { cards: CardDef[] }) {
  const [draft, setDraft] = useState<SongTitleConfig>({});
  const [savedDraft, setSavedDraft] = useState<SongTitleConfig>({});
  const [activeLocale, setActiveLocale] = useState<SongTitleLocale>('zh-TW');
  const [searchText, setSearchText] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const songCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const song = card.song.trim();
      if (song) counts.set(song, (counts.get(song) ?? 0) + 1);
    }
    return counts;
  }, [cards]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetchGameConfig()
      .then((config) => {
        if (cancelled) return;
        const next = normalizeSongTitleConfig(config[CARD_SONG_TITLES_I18N_CONFIG_KEY]);
        for (const song of songCounts.keys()) next[song] ??= {};
        setDraft(next);
        setSavedDraft(next);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        const next = Object.fromEntries([...songCounts.keys()].map((song) => [song, {}]));
        setDraft(next);
        setSavedDraft(next);
        setError(loadError instanceof Error ? loadError.message : '歌名翻譯載入失敗');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [songCounts]);

  const songs = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return Object.keys(draft)
      .filter((song) => {
        const translations = draft[song] ?? {};
        if (missingOnly && translations[activeLocale]?.trim()) return false;
        if (!query) return true;
        return (
          song.toLowerCase().includes(query) ||
          Object.values(translations).some((value) => value.toLowerCase().includes(query))
        );
      })
      .sort((left, right) => left.localeCompare(right, 'ja'));
  }, [activeLocale, draft, missingOnly, searchText]);

  const filledCount = useMemo(
    () => Object.values(draft).filter((translations) => translations[activeLocale]?.trim()).length,
    [activeLocale, draft],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  const updateTitle = (song: string, value: string) => {
    setSuccess(false);
    setDraft((current) => ({
      ...current,
      [song]: { ...current[song], [activeLocale]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await adminUpdateConfig(CARD_SONG_TITLES_I18N_CONFIG_KEY, draft);
      await loadConfigFromAPI();
      setSavedDraft(draft);
      setSuccess(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '歌名翻譯儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingState className="min-h-48" label="載入歌名翻譯中…" />;
  }

  return (
    <section className="admin-table-section flex-1 overflow-auto p-4">
      <div className="admin-song-toolbar mb-4 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <SegmentedControl
              className="admin-song-locale-tabs"
              size="sm"
              ariaLabel="歌名翻譯語言"
              options={SONG_TITLE_LANGS.map((lang) => ({ value: lang.code, label: lang.label }))}
              value={activeLocale}
              onChange={setActiveLocale}
            />
            <Badge>
              {filledCount} / {Object.keys(draft).length}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {dirty && <Badge tone="gold">尚未儲存</Badge>}
            <Button
              leftIcon={<Save className="size-4" aria-hidden="true" />}
              disabled={saving || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? '儲存中…' : '儲存歌名翻譯'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            className="min-w-0"
            containerClassName="admin-search-input"
            icon={<Search className="size-4 shrink-0 text-content-dim" aria-hidden="true" />}
            aria-label="搜尋歌名翻譯"
            placeholder="搜尋日文或任一語言歌名"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Checkbox checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)}>
            只看缺失
          </Checkbox>
        </div>
      </div>

      {error && (
        <Alert className="mb-3" tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {success && (
        <Alert className="mb-3" tone="success">
          歌名翻譯已儲存
        </Alert>
      )}

      {songs.length === 0 ? (
        <EmptyState className="min-h-48" title="沒有符合條件的歌名" />
      ) : (
        <DataListTable className="admin-responsive-table admin-song-table">
          <thead className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
            <tr className="border-b border-content-primary/10">
              <th className="px-3 py-2">官方日文歌名</th>
              <th className="px-3 py-2">卡牌</th>
              <th className="px-3 py-2">{SONG_TITLE_LANGS.find((lang) => lang.code === activeLocale)?.label}</th>
            </tr>
          </thead>
          <tbody>
            {songs.map((song) => (
              <tr key={song} className="odd:bg-surface-base/50">
                <DataListCell label="官方日文歌名" className="font-medium">
                  {song}
                </DataListCell>
                <DataListCell label="卡牌">{songCounts.get(song) ?? 0}</DataListCell>
                <DataListCell
                  label={SONG_TITLE_LANGS.find((lang) => lang.code === activeLocale)?.label ?? activeLocale}
                >
                  <Input
                    aria-label={`${song} 的 ${activeLocale} 歌名`}
                    value={draft[song]?.[activeLocale] ?? ''}
                    onChange={(event) => updateTitle(song, event.target.value)}
                  />
                </DataListCell>
              </tr>
            ))}
          </tbody>
        </DataListTable>
      )}
    </section>
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
  const [cardEditorTab, setCardEditorTab] = useState<CardEditorTab>('overview');
  const [cardCoreUnlocked, setCardCoreUnlocked] = useState(false);
  const [cardUnlockConfirmOpen, setCardUnlockConfirmOpen] = useState(false);
  const [cardPreviewOpen, setCardPreviewOpen] = useState(false);
  const [cardDraftDirty, setCardDraftDirty] = useState(false);
  const [cardI18nDirty, setCardI18nDirty] = useState(false);
  const [mobileCardEditorOpen, setMobileCardEditorOpen] = useState(false);
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
      cards = cards.filter((card) =>
        matchesLocalizedCardSearch(
          card,
          searchText,
          I18N_LANGS.map((lang) => lang.code),
        ),
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
      return CARD_ID_COLLATOR.compare(a.id, b.id);
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
  const hasUnsavedCardChanges = cardDraftDirty || cardI18nDirty;

  const selectCard = useCallback(
    (card: CardDef) => {
      const changingCard = selectedCard?.id !== card.id;
      if (changingCard && hasUnsavedCardChanges && !window.confirm('目前卡牌有尚未儲存的變更，確定切換？')) {
        return;
      }
      setSelectedCard(card);
      setMobileCardEditorOpen(true);
      setCardUnlockConfirmOpen(false);
      setCardPreviewOpen(false);
      if (changingCard) {
        setCardCoreUnlocked(false);
        setCardDraftDirty(false);
        setCardI18nDirty(false);
      }
    },
    [hasUnsavedCardChanges, selectedCard?.id],
  );

  const switchAdminTab = useCallback(
    (tab: AdminTab) => {
      if (activeTab === 'cards' && tab !== 'cards' && hasUnsavedCardChanges) {
        if (!window.confirm('目前卡牌有尚未儲存的變更，確定離開卡牌維護？')) return;
      }
      setActiveTab(tab);
      setMobileCardEditorOpen(false);
      setCardUnlockConfirmOpen(false);
      setCardPreviewOpen(false);
      if (tab !== 'cards') setCardCoreUnlocked(false);
    },
    [activeTab, hasUnsavedCardChanges],
  );

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
    if (!authenticated || !['cards', 'songs'].includes(activeTab)) return;
    if (allCards.length > 0) {
      setCardLoadStatus('loaded');
      return;
    }
    if (cardLoadStatus === 'idle') void loadAdminCards();
  }, [activeTab, allCards.length, authenticated, cardLoadStatus, loadAdminCards]);

  useEffect(() => {
    if (filtered.length === 0 || hasUnsavedCardChanges) return;
    if (selectedCard && filtered.some((card) => card.id === selectedCard.id)) return;
    setSelectedCard(filtered[0]);
    setCardCoreUnlocked(false);
    setCardUnlockConfirmOpen(false);
    setCardPreviewOpen(false);
    setCardDraftDirty(false);
    setCardI18nDirty(false);
  }, [filtered, hasUnsavedCardChanges, selectedCard]);

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
  const navGroups: Array<{
    label: string;
    items: Array<{ value: AdminTab; label: string; icon: typeof Library }>;
  }> = [
    {
      label: '內容',
      items: [
        { value: 'cards', label: '卡牌維護', icon: Library },
        { value: 'songs', label: '歌名翻譯', icon: Music2 },
        { value: 'about', label: 'About 設定', icon: Info },
        { value: 'announcements', label: '公告', icon: Megaphone },
        { value: 'translation', label: '翻譯服務', icon: Languages },
      ],
    },
    {
      label: '社群',
      items: [
        { value: 'users', label: '使用者', icon: Users },
        { value: 'matches', label: '對戰紀錄', icon: Swords },
        { value: 'chat', label: '聊天審核', icon: MessageSquareWarning },
        { value: 'deck-shares', label: '牌組分享', icon: Share2 },
      ],
    },
    {
      label: '系統',
      items: [{ value: 'operations', label: '營運工具', icon: Settings2 }],
    },
  ];

  const activeSection = navGroups.flatMap((group) => group.items).find((item) => item.value === activeTab);

  return (
    <PageShell className="card-admin-page admin-page flex flex-col">
      <div className="admin-shell-body">
        <nav className="admin-sidebar" aria-label="管理員功能">
          <div className="admin-sidebar-meta">
            <div className="admin-sidebar-identity">
              <Database className="size-4" aria-hidden="true" />
              <div>
                <strong>管理員面板</strong>
                {currentAdminRole && <span>{currentAdminRole}</span>}
              </div>
            </div>
            <Button
              aria-label="登出"
              title="登出"
              className="admin-sidebar-logout"
              variant="ghost"
              size="sm"
              onClick={() => void handleLogout()}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {navGroups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <span className="admin-nav-label">{group.label}</span>
              <div className="admin-nav-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      className={`admin-nav-item${activeTab === item.value ? ' admin-nav-item-active' : ''}`}
                      aria-current={activeTab === item.value ? 'page' : undefined}
                      aria-label={item.label}
                      title={item.label}
                      key={item.value}
                      onClick={() => switchAdminTab(item.value)}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="admin-mobile-logout"
            aria-label="登出"
            title="登出"
            onClick={() => void handleLogout()}
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </nav>

        <main className="admin-content">
          {activeTab !== 'cards' && (
            <div className="admin-section-header">
              <div>
                <span className="admin-section-kicker">管理員面板</span>
                <h1>{activeSection?.label}</h1>
              </div>
            </div>
          )}

          {activeTab === 'cards' && (
            <section className={`admin-card-workspace${mobileCardEditorOpen ? ' admin-card-workspace-editing' : ''}`}>
              <aside className="admin-card-browser">
                <div className="admin-card-browser-toolbar">
                  <div className="admin-card-browser-title">
                    <div>
                      <span className="admin-section-kicker">內容</span>
                      <h1>卡牌維護</h1>
                    </div>
                    <Badge>
                      {filtered.length} / {allCards.length}
                    </Badge>
                  </div>
                  <SearchInput
                    containerClassName="admin-card-search"
                    icon={<Search className="size-4 shrink-0 text-content-dim" aria-hidden="true" />}
                    aria-label="搜尋卡牌"
                    placeholder="搜尋任一語言卡名、歌名、效果或 ID"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                  />
                  <div className="admin-card-browser-actions">
                    <span className="font-mono text-caption text-content-primary/50">
                      {activeCardFilterCount > 0 ? `${activeCardFilterCount} 個篩選` : '全部卡牌'}
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
                          {type === 'all'
                            ? '全部'
                            : type === 'Character'
                              ? '角色'
                              : type === 'Enchant'
                                ? '附魔'
                                : '區域'}
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
                      <Button
                        size="sm"
                        variant={pendingOnly ? 'primary' : 'ghost'}
                        onClick={() => setPendingOnly((v) => !v)}
                      >
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
                      {PACK_FILTERS.map((pack) => (
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
                  <div className="admin-card-audit" aria-label="卡牌效果資料摘要">
                    <span>效果 {audit.effectCards}</span>
                    <span>
                      解析 {audit.parsedLines}/{audit.effectLines}
                    </span>
                    <span className={audit.unparsedLines > 0 ? 'text-accent-action' : ''}>
                      未解析 {audit.unparsedLines}
                    </span>
                    <span>Runtime {audit.runtimeParsedEffects}</span>
                  </div>
                </div>

                <div className="admin-card-list" role="listbox" aria-label="卡牌列表">
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
                    <EmptyState className="min-h-48" title="沒有符合條件的卡牌" />
                  )}
                  {filtered.map((card) => {
                    const meta = metaById.get(card.id);
                    return (
                      <button
                        key={card.id}
                        type="button"
                        role="option"
                        aria-selected={selectedCard?.id === card.id}
                        className={`admin-card-list-item${selectedCard?.id === card.id ? ' admin-card-list-item-active' : ''}`}
                        onClick={() => selectCard(card)}
                      >
                        <CardImage
                          className="admin-card-list-image"
                          cardId={card.id}
                          context="thumbnail"
                          alt={card.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <div className="admin-card-list-copy">
                          <div className="admin-card-list-name-row">
                            <strong>{card.name}</strong>
                            {card.hasOfficialErrata && <span className="admin-card-status-dot" title="官方勘誤" />}
                          </div>
                          <span className="font-mono text-xs text-content-primary/45">{card.id}</span>
                          <span className="admin-card-list-meta">
                            {card.element} ·{' '}
                            {card.type === 'Character' ? '角色' : card.type === 'Enchant' ? '附魔' : '區域'}
                            {card.song ? ` · ${card.song}` : ''}
                          </span>
                        </div>
                        {card.effect && (
                          <Badge
                            tone={meta?.unparsedLines.length ? 'vermilion' : 'gold'}
                            className="admin-card-engine-count"
                          >
                            {meta?.parsed.length ?? 0}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="admin-card-editor">
                {selectedCard && selectedMeta ? (
                  <>
                    <header className="admin-card-editor-header">
                      <Button
                        className="admin-card-editor-back"
                        size="sm"
                        variant="ghost"
                        leftIcon={<ArrowLeft className="size-4" aria-hidden="true" />}
                        onClick={() => {
                          if (hasUnsavedCardChanges && !window.confirm('目前卡牌有尚未儲存的變更，確定返回列表？'))
                            return;
                          setMobileCardEditorOpen(false);
                        }}
                      >
                        卡牌列表
                      </Button>
                      <div className="admin-card-editor-summary">
                        <CardImage
                          cardId={selectedCard.id}
                          context="thumbnail"
                          alt={selectedCard.name}
                          className="admin-card-editor-image"
                          loading="eager"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2>{selectedCard.name}</h2>
                            {selectedCard.hasOfficialErrata && <Badge tone="gold">官方勘誤</Badge>}
                          </div>
                          <p>
                            <span className="font-mono">{selectedCard.id}</span>
                            <span>{selectedCard.pack}</span>
                            {selectedCard.song && <span>{selectedCard.song}</span>}
                          </p>
                        </div>
                        <div className="admin-card-editor-controls">
                          <Button
                            className="admin-card-preview-open"
                            size="sm"
                            variant="ghost"
                            aria-label="預覽卡牌大圖"
                            title="預覽卡牌大圖"
                            leftIcon={<ZoomIn className="size-4" aria-hidden="true" />}
                            onClick={() => setCardPreviewOpen(true)}
                          >
                            <span>大圖</span>
                          </Button>
                          <Button
                            className="admin-card-lock-control"
                            size="sm"
                            variant={cardCoreUnlocked ? 'secondary' : 'ghost'}
                            aria-label={cardCoreUnlocked ? '鎖定核心資料' : '解鎖核心資料'}
                            title={cardCoreUnlocked ? '鎖定核心資料' : '解鎖核心資料'}
                            leftIcon={
                              cardCoreUnlocked ? (
                                <LockOpen className="size-4" aria-hidden="true" />
                              ) : (
                                <Lock className="size-4" aria-hidden="true" />
                              )
                            }
                            onClick={() => {
                              if (cardCoreUnlocked) {
                                setCardCoreUnlocked(false);
                                return;
                              }
                              setCardUnlockConfirmOpen(true);
                            }}
                          >
                            <span>{cardCoreUnlocked ? '重新鎖定' : '解鎖核心資料'}</span>
                          </Button>
                        </div>
                      </div>
                      <div className="admin-card-editor-tabs" role="tablist" aria-label="卡牌維護區段">
                        {(
                          [
                            ['overview', '資料', Database],
                            ['official', '官方文本', BookOpenText],
                            ['i18n', '多語翻譯', Languages],
                            ['engine', '效果診斷', Activity],
                          ] as const
                        ).map(([value, label, Icon]) => (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={cardEditorTab === value}
                            className={cardEditorTab === value ? 'admin-card-editor-tab-active' : ''}
                            key={value}
                            onClick={() => setCardEditorTab(value)}
                          >
                            <Icon className="size-4" aria-hidden="true" />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </header>
                    <div className="admin-card-editor-content">
                      <div className="admin-card-editor-body">
                        <div hidden={cardEditorTab !== 'overview' && cardEditorTab !== 'official'}>
                          <CardEditForm
                            card={selectedCard}
                            section={cardEditorTab === 'official' ? 'official' : 'overview'}
                            locked={!cardCoreUnlocked}
                            onDirtyChange={setCardDraftDirty}
                            onSaved={(updated) => {
                              setCardCoreUnlocked(false);
                              setSelectedCard(updated);
                              setAllCards((cards) => cards.map((card) => (card.id === updated.id ? updated : card)));
                              void refreshCards().then(() => setAllCards(getAllCardDefs()));
                            }}
                          />
                        </div>
                        <div hidden={cardEditorTab !== 'i18n'}>
                          <I18nEditor card={selectedCard} onDirtyChange={setCardI18nDirty} />
                        </div>
                        <div hidden={cardEditorTab !== 'engine'}>
                          <EffectInspector meta={selectedMeta} />
                        </div>
                      </div>
                      <aside className="admin-card-preview-pane" aria-label="卡牌大圖預覽">
                        <div className="admin-card-preview-heading">
                          <span>卡牌大圖</span>
                          <span>{selectedCard.id}</span>
                        </div>
                        <CardImage
                          cardId={selectedCard.id}
                          context="detail"
                          alt={selectedCard.name}
                          className="admin-card-preview-image"
                          loading="eager"
                          referrerPolicy="no-referrer"
                        />
                      </aside>
                    </div>
                  </>
                ) : (
                  <EmptyState className="min-h-full" title="選擇一張卡牌開始維護" />
                )}
              </section>
            </section>
          )}

          {activeTab === 'songs' && <SongTitleEditor cards={allCards} />}

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
                      <th className="px-3 py-2">場次</th>
                      <th className="px-3 py-2">勝率</th>
                      {currentAdminRole === 'admin' && <th className="px-3 py-2">管理權限</th>}
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
                                report.status === 'resolved'
                                  ? 'jade'
                                  : report.status === 'dismissed'
                                    ? 'neutral'
                                    : 'gold'
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
                          <span className="font-mono text-xs text-content-primary/50">
                            {chatEvidence.conversation.id}
                          </span>
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

          {activeTab === 'deck-shares' && (
            <section className="admin-main flex-1 overflow-y-auto p-4">
              <AdminDeckShareReportsPanel token={token} />
            </section>
          )}

          {activeTab === 'about' && (
            <section className="admin-main flex-1 overflow-y-auto p-4">
              <AboutSettingsEditor />
            </section>
          )}

          {activeTab === 'announcements' && (
            <section className="admin-main flex-1 overflow-y-auto p-4">
              <AdminAnnouncementsPanel />
            </section>
          )}

          {activeTab === 'translation' && (
            <section className="admin-main flex-1 overflow-y-auto p-4">
              <AdminTranslationSettingsPanel token={token} />
            </section>
          )}

          {activeTab === 'operations' && (
            <section className="admin-main flex-1 overflow-y-auto p-4">
              <AdminOperationsPanel token={token} />
            </section>
          )}
        </main>
      </div>
      {selectedCard && (
        <Dialog
          open={cardUnlockConfirmOpen}
          onOpenChange={setCardUnlockConfirmOpen}
          title="解鎖核心資料"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCardUnlockConfirmOpen(false)}>
                取消
              </Button>
              <Button
                variant="danger"
                leftIcon={<LockOpen className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setCardCoreUnlocked(true);
                  setCardUnlockConfirmOpen(false);
                }}
              >
                確認解鎖
              </Button>
            </>
          }
        >
          <Alert tone="danger">
            {selectedCard.id} 的核心資料與官方效果會直接影響對戰規則。解鎖後請只修改已核對的內容。
          </Alert>
        </Dialog>
      )}
      {selectedCard && (
        <Dialog
          open={cardPreviewOpen}
          onOpenChange={setCardPreviewOpen}
          title={selectedCard.name}
          size="sm"
          className="admin-card-preview-dialog"
        >
          <CardImage
            cardId={selectedCard.id}
            context="detail"
            alt={selectedCard.name}
            className="admin-card-preview-dialog-image"
            loading="eager"
            referrerPolicy="no-referrer"
          />
        </Dialog>
      )}
    </PageShell>
  );
}
