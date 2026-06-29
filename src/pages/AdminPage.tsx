import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getAllCardDefs, refreshCards } from '../game/cards/loader';
import { parseEffect } from '../game/effects/parser';
import type { ParsedEffect } from '../game/effects';
import type { CardDef, CardType, Element } from '../game/types';
import {
  ApiError,
  adminGetMatches,
  adminGetUsers,
  adminLogin,
  adminResetElo,
  adminUpdateCard,
  adminUpdateCardI18n,
  fetchCardI18n,
} from '../api/client';
import type { AdminMatch, AdminUser } from '../api/client';
import '../components/AdminPanel.css';

const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';

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

const filterChipClass = (active: boolean) => `btn btn-sm ${active ? 'btn-accent' : 'btn-ghost'}`;
const tabClass = (active: boolean) => `tab ${active ? 'tab-active' : ''}`;

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
  element: Element;
  type: CardType;
  rarity: string;
  clock: string;
  attackNight: string;
  attackDay: string;
  powerCost: string;
  sendToPower: string;
  effect: string;
  image: string;
  errata: string;
  pack: string;
  song: string;
  illustrator: string;
};

function cardToDraft(card: CardDef): CardEditDraft {
  return {
    name: card.name,
    element: card.element,
    type: card.type,
    rarity: card.rarity,
    clock: String(card.clock),
    attackNight: card.attack ? String(card.attack.night) : '',
    attackDay: card.attack ? String(card.attack.day) : '',
    powerCost: String(card.powerCost),
    sendToPower: String(card.sendToPower),
    effect: card.effect,
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
    element: draft.element,
    type: draft.type,
    rarity: draft.rarity,
    clock: num(draft.clock),
    attack: draft.type === 'Character' ? { night: num(draft.attackNight), day: num(draft.attackDay) } : null,
    powerCost: num(draft.powerCost),
    sendToPower: num(draft.sendToPower),
    effect: draft.effect,
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
  if (items.length === 0) return <span className="badge badge-ghost">{empty}</span>;
  return items.map((item) => (
    <span className="badge badge-accent mr-1 mb-1" key={item}>
      {item}
    </span>
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
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigator.clipboard?.writeText(astJson)}>
          複製 AST
        </button>
      </div>
      <div className="card bg-base-200 shadow">
        <div className="card-body p-4">
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
        <article className="card bg-base-200 shadow" key={`${effect.rawText}-${i}`}>
          <div className="card-body p-4">
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
      <details className="collapse collapse-arrow bg-base-200 shadow">
        <summary className="collapse-title font-bold">查看完整 AST JSON</summary>
        <pre className="collapse-content max-h-72 overflow-auto whitespace-pre-wrap text-xs">{astJson}</pre>
      </details>
      {meta.unparsedLines.length > 0 && (
        <div className="alert alert-warning items-start">
          <span>
            <strong>未解析行</strong>
            {meta.unparsedLines.map((l) => (
              <p className="mt-1 whitespace-pre-wrap" key={l}>
                {l}
              </p>
            ))}
          </span>
        </div>
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
      <label className="label grid gap-1 p-0">
        <span className="label-text">名稱</span>
        <input
          className="input input-bordered w-full"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="label grid gap-1 p-0">
          <span className="label-text">屬性</span>
          <select
            className="select select-bordered w-full"
            value={draft.element}
            onChange={(e) => set('element', e.target.value)}
          >
            {ELEMENT_OPTIONS.map((el) => (
              <option key={el}>{el}</option>
            ))}
          </select>
        </label>
        <label className="label grid gap-1 p-0">
          <span className="label-text">類型</span>
          <select
            className="select select-bordered w-full"
            value={draft.type}
            onChange={(e) => set('type', e.target.value)}
          >
            {TYPE_OPTIONS.map((tp) => (
              <option key={tp}>{tp}</option>
            ))}
          </select>
        </label>
        <label className="label grid gap-1 p-0">
          <span className="label-text">稀有度</span>
          <select
            className="select select-bordered w-full"
            value={draft.rarity}
            onChange={(e) => set('rarity', e.target.value)}
          >
            {RARITY_OPTIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="label grid gap-1 p-0">
          <span className="label-text">時計</span>
          <input
            className="input input-bordered w-full"
            type="number"
            value={draft.clock}
            onChange={(e) => set('clock', e.target.value)}
          />
        </label>
        <label className="label grid gap-1 p-0">
          <span className="label-text">Power Cost</span>
          <input
            className="input input-bordered w-full"
            type="number"
            value={draft.powerCost}
            onChange={(e) => set('powerCost', e.target.value)}
          />
        </label>
        <label className="label grid gap-1 p-0">
          <span className="label-text">SEND TO POWER</span>
          <input
            className="input input-bordered w-full"
            type="number"
            value={draft.sendToPower}
            onChange={(e) => set('sendToPower', e.target.value)}
          />
        </label>
      </div>
      {draft.type === 'Character' && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="label grid gap-1 p-0">
            <span className="label-text">🌙 夜間攻擊</span>
            <input
              className="input input-bordered w-full"
              type="number"
              value={draft.attackNight}
              onChange={(e) => set('attackNight', e.target.value)}
            />
          </label>
          <label className="label grid gap-1 p-0">
            <span className="label-text">☀️ 日間攻擊</span>
            <input
              className="input input-bordered w-full"
              type="number"
              value={draft.attackDay}
              onChange={(e) => set('attackDay', e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="label grid gap-1 p-0">
        <span className="label-text">效果原文</span>
        <textarea
          className="textarea textarea-bordered w-full"
          value={draft.effect}
          onChange={(e) => set('effect', e.target.value)}
          rows={4}
        />
      </label>
      <label className="label grid gap-1 p-0">
        <span className="label-text">圖片 URL</span>
        <input
          className="input input-bordered w-full"
          value={draft.image}
          onChange={(e) => set('image', e.target.value)}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="label grid gap-1 p-0">
          <span className="label-text">歌曲</span>
          <input
            className="input input-bordered w-full"
            value={draft.song}
            onChange={(e) => set('song', e.target.value)}
          />
        </label>
        <label className="label grid gap-1 p-0">
          <span className="label-text">畫師</span>
          <input
            className="input input-bordered w-full"
            value={draft.illustrator}
            onChange={(e) => set('illustrator', e.target.value)}
          />
        </label>
      </div>
      <label className="label grid gap-1 p-0">
        <span className="label-text">卡包</span>
        <select
          className="select select-bordered w-full"
          value={draft.pack}
          onChange={(e) => set('pack', e.target.value)}
        >
          {FALLBACK_PACKS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="label grid gap-1 p-0">
        <span className="label-text">勘誤</span>
        <textarea
          className="textarea textarea-bordered w-full"
          value={draft.errata}
          onChange={(e) => set('errata', e.target.value)}
          rows={2}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        {success && (
          <div className="alert alert-success w-auto py-2">
            <span>已儲存</span>
          </div>
        )}
        {error && (
          <div className="alert alert-error w-auto py-2">
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== i18n Editor =====
function I18nEditor({ cardId }: { cardId: string }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchCardI18n(cardId)
      .then((data) => {
        const init: Record<string, string> = {};
        for (const lang of I18N_LANGS) init[lang.code] = data[lang.code] ?? '';
        setDraft(init);
      })
      .catch(() => {
        const init: Record<string, string> = {};
        for (const lang of I18N_LANGS) init[lang.code] = '';
        setDraft(init);
      })
      .finally(() => setLoading(false));
  }, [cardId]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      for (const lang of I18N_LANGS) {
        await adminUpdateCardI18n(cardId, lang.code, draft[lang.code] ?? '');
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="opacity-70">載入翻譯中…</p>;

  return (
    <div className="grid gap-3">
      {I18N_LANGS.map((lang) => (
        <label className="label grid gap-1 p-0" key={lang.code}>
          <span className="label-text">
            {lang.label} <span className="opacity-60">({lang.code})</span>
          </span>
          <textarea
            className="textarea textarea-bordered w-full"
            value={draft[lang.code] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [lang.code]: e.target.value }))}
            rows={3}
            placeholder={`${lang.label} 翻譯…`}
          />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '儲存中…' : '儲存翻譯'}
        </button>
        {success && (
          <div className="alert alert-success w-auto py-2">
            <span>已儲存</span>
          </div>
        )}
        {error && (
          <div className="alert alert-error w-auto py-2">
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Main Component =====
export function AdminPage() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem(ADMIN_TOKEN_KEY)));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'cards' | 'users' | 'matches'>('cards');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [eloEdits, setEloEdits] = useState<Record<string, string>>({});
  const [eloSavingId, setEloSavingId] = useState<string | null>(null);
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [filterPack, setFilterPack] = useState('all');
  const [filterTrigger, setFilterTrigger] = useState('all');
  const [filterAction, setFilterAction] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [areaExpiryOnly, setAreaExpiryOnly] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'id' | 'name' | 'cost' | 'attack'>('id');
  const [selectedCard, setSelectedCard] = useState<CardDef | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('basic');
  const [allCards, setAllCards] = useState(() => getAllCardDefs());
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
    pendingOnly,
    searchText,
    sortBy,
    metaById,
  ]);

  const handleLogin = useCallback(async () => {
    setLoggingIn(true);
    setError('');
    try {
      const { token: tok } = await adminLogin(password);
      sessionStorage.setItem(ADMIN_TOKEN_KEY, tok);
      setAuthenticated(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '登入失敗');
    } finally {
      setLoggingIn(false);
    }
  }, [password]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAuthenticated(false);
  }, []);

  const refreshUsers = useCallback(async () => {
    if (!token) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const { users: u } = await adminGetUsers(token);
      setUsers(u);
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setAdminLoading(false);
    }
  }, [token]);

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

  useEffect(() => {
    if (activeTab === 'users' && users.length === 0) void refreshUsers();
    if (activeTab === 'matches' && matches.length === 0) void refreshMatches();
  }, [activeTab, matches.length, refreshMatches, refreshUsers, users.length]);

  if (!authenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <button className="btn btn-ghost absolute left-4 top-4" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </button>
        <section className="card bg-base-200 w-96 max-w-full shadow-xl">
          <div className="card-body">
            <h2 className="card-title">管理員驗證</h2>
            <input
              className="input input-bordered w-full"
              type="password"
              placeholder="輸入管理密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loggingIn) void handleLogin();
              }}
              disabled={loggingIn}
            />
            <button
              className="btn btn-primary w-full"
              onClick={() => void handleLogin()}
              disabled={loggingIn || !password}
            >
              {loggingIn ? '驗證中…' : '登入'}
            </button>
            {error && (
              <div className="alert alert-error">
                <span>{error}</span>
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  const selectedMeta = selectedCard ? metaById.get(selectedCard.id) : null;
  const CardModal =
    selectedCard && selectedMeta ? (
      <dialog className="modal modal-open" onClick={() => setSelectedCard(null)}>
        <div className="modal-box max-w-4xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <img
              src={selectedCard.image}
              alt={selectedCard.name}
              className="h-20 w-14 rounded object-cover"
              referrerPolicy="no-referrer"
            />
            <div>
              <h3 className="text-lg font-bold">{selectedCard.name}</h3>
              <p className="font-mono text-xs opacity-70">{selectedCard.id}</p>
            </div>
          </div>
          <div role="tablist" className="tabs tabs-bordered mt-4">
            {(
              [
                ['basic', '📝 基本資訊'],
                ['engine', '⚙️ 效果引擎'],
                ['i18n', '🌐 多語言'],
              ] as const
            ).map(([key, label]) => (
              <a key={key} role="tab" className={tabClass(modalTab === key)} onClick={() => setModalTab(key)}>
                {label}
              </a>
            ))}
          </div>
          <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
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
            {modalTab === 'i18n' && <I18nEditor cardId={selectedCard.id} />}
          </div>
          <div className="modal-action">
            <form method="dialog">
              <button className="btn" type="button" onClick={() => setSelectedCard(null)}>
                關閉
              </button>
            </form>
          </div>
        </div>
      </dialog>
    ) : null;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-base-100">
      <header className="navbar shrink-0 bg-base-200 shadow">
        <div className="navbar-start gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
          <h1 className="text-xl font-bold">管理員面板</h1>
          {activeTab === 'cards' && (
            <span className="badge badge-ghost">
              {filtered.length} / {allCards.length} 張
            </span>
          )}
        </div>
        <div className="navbar-center">
          <div role="tablist" className="tabs tabs-boxed">
            <a role="tab" className={tabClass(activeTab === 'cards')} onClick={() => setActiveTab('cards')}>
              卡牌資料
            </a>
            <a role="tab" className={tabClass(activeTab === 'users')} onClick={() => setActiveTab('users')}>
              使用者
            </a>
            <a role="tab" className={tabClass(activeTab === 'matches')} onClick={() => setActiveTab('matches')}>
              對戰
            </a>
          </div>
        </div>
        <div className="navbar-end">
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            登出
          </button>
        </div>
      </header>

      {activeTab === 'cards' && (
        <div className="flex-1 overflow-y-auto p-4">
          <section className="stats stats-vertical w-full shadow lg:stats-horizontal">
            <div className="stat">
              <div className="stat-title">總卡</div>
              <div className="stat-value">{audit.totalCards}</div>
            </div>
            <div className="stat">
              <div className="stat-title">效果卡</div>
              <div className="stat-value">{audit.effectCards}</div>
            </div>
            <div className="stat">
              <div className="stat-title">效果行</div>
              <div className="stat-value">
                {audit.parsedLines}/{audit.effectLines}
              </div>
            </div>
            <div className="stat">
              <div className="stat-title">未解析</div>
              <div className="stat-value">{audit.unparsedLines}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Runtime effects</div>
              <div className="stat-value">{audit.runtimeParsedEffects}</div>
            </div>
          </section>
          <div className="grid gap-3 py-4">
            <input
              type="text"
              placeholder="搜尋卡名/效果/ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="input input-bordered w-full max-w-md"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-text w-12">屬性</span>
              {ELEMENTS.map((el) => (
                <button key={el} className={filterChipClass(filterElement === el)} onClick={() => setFilterElement(el)}>
                  {el === 'all' ? '全部' : el}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-text w-12">類型</span>
              {TYPES.map((type) => (
                <button key={type} className={filterChipClass(filterType === type)} onClick={() => setFilterType(type)}>
                  {type === 'all' ? '全部' : type === 'Character' ? '角色' : type === 'Enchant' ? '附魔' : '區域'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-text w-12">Trigger</span>
              {TRIGGERS.map((trigger) => (
                <button
                  key={trigger}
                  className={filterChipClass(filterTrigger === trigger)}
                  onClick={() => setFilterTrigger(trigger)}
                >
                  {trigger === 'all' ? '全部' : trigger}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-text w-12">引擎</span>
              <input
                className="input input-bordered input-sm w-36"
                placeholder="Action type"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
              />
              <input
                className="input input-bordered input-sm w-36"
                placeholder="Condition type"
                value={filterCondition}
                onChange={(e) => setFilterCondition(e.target.value)}
              />
              <button className={filterChipClass(pendingOnly)} onClick={() => setPendingOnly((v) => !v)}>
                待選卡
              </button>
              <button className={filterChipClass(areaExpiryOnly)} onClick={() => setAreaExpiryOnly((v) => !v)}>
                Area expiry
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-text w-12">卡包</span>
              {FALLBACK_PACKS.map((pack) => (
                <button key={pack} className={filterChipClass(filterPack === pack)} onClick={() => setFilterPack(pack)}>
                  {pack === 'all' ? '全部' : pack}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-text w-12">排序</span>
              {(['id', 'name', 'cost', 'attack'] as const).map((sort) => (
                <button key={sort} className={filterChipClass(sortBy === sort)} onClick={() => setSortBy(sort)}>
                  {sort === 'id' ? '編號' : sort === 'name' ? '名稱' : sort === 'cost' ? '能量' : '攻擊'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filtered.map((card) => {
              const meta = metaById.get(card.id);
              return (
                <button
                  key={card.id}
                  className="card image-full bg-base-200 shadow-xl transition hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-accent"
                  onClick={() => {
                    setSelectedCard(card);
                    setModalTab('basic');
                  }}
                >
                  <figure>
                    <img
                      className="aspect-[5/7] w-full object-cover"
                      src={card.image}
                      alt={card.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </figure>
                  <div className="card-body justify-end p-3 text-left">
                    <h2 className="card-title block truncate text-sm">{card.name}</h2>
                    <p className="font-mono text-xs opacity-80">{card.id}</p>
                    <p className="text-xs opacity-80">
                      {card.element} • {card.type === 'Character' ? '角' : card.type === 'Enchant' ? '附' : '域'}
                      {card.type === 'Character' && card.attack && ` • 🌙${card.attack.night}/☀️${card.attack.day}`}
                      {card.powerCost > 0 && ` • ⚡${card.powerCost}`}
                    </p>
                  </div>
                  {card.effect && (
                    <div
                      className={`badge absolute right-2 top-2 ${meta?.unparsedLines.length ? 'badge-error' : 'badge-primary'}`}
                    >
                      {meta?.parsed.length ?? 0}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <section className="flex-1 overflow-auto p-4">
          {adminLoading && (
            <div className="alert alert-info mb-3">
              <span>載入中…</span>
            </div>
          )}
          {adminError && (
            <div className="alert alert-error mb-3">
              <span>{adminError}</span>
            </div>
          )}
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th>ID</th>
                <th>Email</th>
                <th>暱稱</th>
                <th>ELO</th>
                <th>場次</th>
                <th>勝率</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="max-w-32 truncate font-mono text-xs opacity-70">{u.id}</td>
                  <td>{u.email}</td>
                  <td>{u.nickname}</td>
                  <td>
                    <div className="join">
                      {eloEdits[u.id] ?? u.elo}
                      <input
                        className="input input-bordered input-xs join-item ml-2 w-20"
                        value={eloEdits[u.id] ?? ''}
                        placeholder={String(u.elo)}
                        onChange={(e) => setEloEdits((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      />
                    </div>
                  </td>
                  <td>{u.matchCount}</td>
                  <td>{u.winRate}%</td>
                  <td>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={eloSavingId === u.id}
                      onClick={() => {
                        const v = Number(eloEdits[u.id]);
                        if (!Number.isFinite(v)) return;
                        void adminResetElo(token, u.id, Math.trunc(v))
                          .then(refreshUsers)
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
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'matches' && (
        <section className="flex-1 overflow-auto p-4">
          {adminLoading && (
            <div className="alert alert-info mb-3">
              <span>載入中…</span>
            </div>
          )}
          {adminError && (
            <div className="alert alert-error mb-3">
              <span>{adminError}</span>
            </div>
          )}
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th>ID</th>
                <th>勝者</th>
                <th>敗者</th>
                <th>ELO Δ</th>
                <th>回合</th>
                <th>時長</th>
                <th>時間</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td className="max-w-32 truncate font-mono text-xs opacity-70">{m.id}</td>
                  <td>{m.winnerNickname ?? m.winnerId}</td>
                  <td>{m.loserNickname ?? m.loserId}</td>
                  <td>
                    {m.winnerEloChange >= 0 ? '+' : ''}
                    {m.winnerEloChange} / {m.loserEloChange}
                  </td>
                  <td>{m.turns ?? '—'}</td>
                  <td>{m.duration != null ? `${Math.round(m.duration / 60)}m` : '—'}</td>
                  <td>{new Date(m.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {CardModal}
    </main>
  );
}
