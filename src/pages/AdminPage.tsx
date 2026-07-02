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
import {
  Badge,
  BackButton,
  Button,
  Card as UiCard,
  Dialog,
  Input,
  PageShell,
  Panel,
  Select,
  Textarea,
} from '../components/ui';
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
      <details className="rounded-sm bg-lacquer p-4 ring-1 ring-bone/10">
        <summary className="cursor-pointer font-bold">查看完整 AST JSON</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{astJson}</pre>
      </details>
      {meta.unparsedLines.length > 0 && (
        <Panel className="border-l-2 border-gold/40 bg-gold/10 text-xs text-gold">
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
        <span className="text-xs text-bone/50">名稱</span>
        <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">屬性</span>
          <Select value={draft.element} onChange={(e) => set('element', e.target.value)}>
            {ELEMENT_OPTIONS.map((el) => (
              <option key={el}>{el}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">類型</span>
          <Select value={draft.type} onChange={(e) => set('type', e.target.value)}>
            {TYPE_OPTIONS.map((tp) => (
              <option key={tp}>{tp}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">稀有度</span>
          <Select value={draft.rarity} onChange={(e) => set('rarity', e.target.value)}>
            {RARITY_OPTIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">時計</span>
          <Input type="number" value={draft.clock} onChange={(e) => set('clock', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">Power Cost</span>
          <Input type="number" value={draft.powerCost} onChange={(e) => set('powerCost', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">SEND TO POWER</span>
          <Input type="number" value={draft.sendToPower} onChange={(e) => set('sendToPower', e.target.value)} />
        </label>
      </div>
      {draft.type === 'Character' && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-bone/50">夜間攻擊</span>
            <Input type="number" value={draft.attackNight} onChange={(e) => set('attackNight', e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-bone/50">日間攻擊</span>
            <Input type="number" value={draft.attackDay} onChange={(e) => set('attackDay', e.target.value)} />
          </label>
        </div>
      )}
      <label className="grid gap-1">
        <span className="text-xs text-bone/50">效果原文</span>
        <Textarea value={draft.effect} onChange={(e) => set('effect', e.target.value)} rows={4} />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-bone/50">圖片 URL</span>
        <Input value={draft.image} onChange={(e) => set('image', e.target.value)} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">歌曲</span>
          <Input value={draft.song} onChange={(e) => set('song', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-bone/50">畫師</span>
          <Input value={draft.illustrator} onChange={(e) => set('illustrator', e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-xs text-bone/50">卡包</span>
        <Select value={draft.pack} onChange={(e) => set('pack', e.target.value)}>
          {FALLBACK_PACKS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-bone/50">勘誤</span>
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
        <label className="grid gap-1" key={lang.code}>
          <span className="text-xs text-bone/50">
            {lang.label} <span className="opacity-60">({lang.code})</span>
          </span>
          <Textarea
            value={draft[lang.code] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [lang.code]: e.target.value }))}
            rows={3}
            placeholder={`${lang.label} 翻譯…`}
          />
        </label>
      ))}
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
      <PageShell className="flex items-center justify-center p-4">
        <BackButton className="absolute left-4 top-4" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </BackButton>
        <Panel className="w-96 max-w-full" size="lg">
          <div className="grid gap-4">
            <h2 className="font-display text-xl italic">管理員驗證</h2>
            <Input
              type="password"
              placeholder="輸入管理密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loggingIn) void handleLogin();
              }}
              disabled={loggingIn}
            />
            <Button fullWidth onClick={() => void handleLogin()} disabled={loggingIn || !password}>
              {loggingIn ? '驗證中…' : '登入'}
            </Button>
            {error && (
              <Panel className="border-l-2 border-vermilion/50 bg-vermilion/10 text-xs text-vermilion/80">
                {error}
              </Panel>
            )}
          </div>
        </Panel>
      </PageShell>
    );
  }

  const selectedMeta = selectedCard ? metaById.get(selectedCard.id) : null;
  const CardModal =
    selectedCard && selectedMeta ? (
      <Dialog open onOpenChange={(open) => !open && setSelectedCard(null)} title={selectedCard.name} size="lg">
        <div className="grid gap-4">
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
          <div role="tablist" className="mt-4 flex flex-wrap gap-2">
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
          <div className="flex justify-end">
            <Button variant="secondary" type="button" onClick={() => setSelectedCard(null)}>
              關閉
            </Button>
          </div>
        </div>
      </Dialog>
    ) : null;

  return (
    <PageShell className="flex flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-bone/5 bg-lacquer-deep/80 px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-2">
          <BackButton onClick={() => navigate('/')}>{t('common.backToLobby')}</BackButton>
          <h1 className="font-display text-xl italic text-gold">管理員面板</h1>
          {activeTab === 'cards' && (
            <Badge>
              {filtered.length} / {allCards.length} 張
            </Badge>
          )}
        </div>
        <div role="tablist" className="flex items-center gap-2">
          <Button
            role="tab"
            size="sm"
            variant={activeTab === 'cards' ? 'primary' : 'ghost'}
            onClick={() => setActiveTab('cards')}
          >
            卡牌資料
          </Button>
          <Button
            role="tab"
            size="sm"
            variant={activeTab === 'users' ? 'primary' : 'ghost'}
            onClick={() => setActiveTab('users')}
          >
            使用者
          </Button>
          <Button
            role="tab"
            size="sm"
            variant={activeTab === 'matches' ? 'primary' : 'ghost'}
            onClick={() => setActiveTab('matches')}
          >
            對戰
          </Button>
        </div>
        <div>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            登出
          </Button>
        </div>
      </header>

      {activeTab === 'cards' && (
        <div className="flex-1 overflow-y-auto p-4">
          <section className="grid gap-3 lg:grid-cols-5">
            <Panel>
              <div className="text-xs text-bone/50">總卡</div>
              <div className="font-mono text-2xl text-gold">{audit.totalCards}</div>
            </Panel>
            <Panel>
              <div className="text-xs text-bone/50">效果卡</div>
              <div className="font-mono text-2xl text-gold">{audit.effectCards}</div>
            </Panel>
            <Panel>
              <div className="text-xs text-bone/50">效果行</div>
              <div className="font-mono text-2xl text-gold">
                {audit.parsedLines}/{audit.effectLines}
              </div>
            </Panel>
            <Panel>
              <div className="text-xs text-bone/50">未解析</div>
              <div className="font-mono text-2xl text-gold">{audit.unparsedLines}</div>
            </Panel>
            <Panel>
              <div className="text-xs text-bone/50">Runtime effects</div>
              <div className="font-mono text-2xl text-gold">{audit.runtimeParsedEffects}</div>
            </Panel>
          </section>
          <div className="grid gap-3 py-4">
            <Input
              type="text"
              placeholder="搜尋卡名/效果/ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="max-w-md"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-bone/50">屬性</span>
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-bone/50">類型</span>
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-bone/50">Trigger</span>
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-bone/50">引擎</span>
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-bone/50">卡包</span>
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-bone/50">排序</span>
              {(['id', 'name', 'cost', 'attack'] as const).map((sort) => (
                <Button
                  key={sort}
                  size="sm"
                  variant={sortBy === sort ? 'primary' : 'ghost'}
                  onClick={() => setSortBy(sort)}
                >
                  {sort === 'id' ? '編號' : sort === 'name' ? '名稱' : sort === 'cost' ? '能量' : '攻擊'}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filtered.map((card) => {
              const meta = metaById.get(card.id);
              return (
                <button
                  key={card.id}
                  className="group relative overflow-hidden rounded-sm bg-lacquer text-left ring-1 ring-bone/10 transition hover:-translate-y-1 hover:ring-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/60"
                  onClick={() => {
                    setSelectedCard(card);
                    setModalTab('basic');
                  }}
                >
                  <img
                    className="aspect-[5/7] w-full object-cover opacity-80 transition group-hover:opacity-100"
                    src={card.image}
                    alt={card.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-lacquer-deep/80 p-3 backdrop-blur">
                    <h2 className="block truncate text-sm font-bold">{card.name}</h2>
                    <p className="font-mono text-xs opacity-80">{card.id}</p>
                    <p className="text-xs opacity-80">
                      {card.element} • {card.type === 'Character' ? '角' : card.type === 'Enchant' ? '附' : '域'}
                      {card.type === 'Character' && card.attack && ` • ${card.attack.night}/${card.attack.day}`}
                      {card.powerCost > 0 && ` • ${card.powerCost}`}
                    </p>
                  </div>
                  {card.effect && (
                    <Badge tone={meta?.unparsedLines.length ? 'vermilion' : 'gold'} className="absolute right-2 top-2">
                      {meta?.parsed.length ?? 0}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <section className="flex-1 overflow-auto p-4">
          {adminLoading && <Panel className="mb-3 text-sm text-bone/60">載入中…</Panel>}
          {adminError && (
            <Panel className="mb-3 border-l-2 border-vermilion/50 bg-vermilion/10 text-xs text-vermilion/80">
              {adminError}
            </Panel>
          )}
          <table className="w-full border-collapse text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
              <tr className="border-b border-bone/10">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">暱稱</th>
                <th className="px-3 py-2">ELO</th>
                <th className="px-3 py-2">場次</th>
                <th className="px-3 py-2">勝率</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="odd:bg-lacquer/50">
                  <td className="max-w-32 truncate px-3 py-2 font-mono text-xs opacity-70">{u.id}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.nickname}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {eloEdits[u.id] ?? u.elo}
                      <Input
                        className="w-20"
                        value={eloEdits[u.id] ?? ''}
                        placeholder={String(u.elo)}
                        onChange={(e) => setEloEdits((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">{u.matchCount}</td>
                  <td className="px-3 py-2">{u.winRate}%</td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
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
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'matches' && (
        <section className="flex-1 overflow-auto p-4">
          {adminLoading && <Panel className="mb-3 text-sm text-bone/60">載入中…</Panel>}
          {adminError && (
            <Panel className="mb-3 border-l-2 border-vermilion/50 bg-vermilion/10 text-xs text-vermilion/80">
              {adminError}
            </Panel>
          )}
          <table className="w-full border-collapse text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
              <tr className="border-b border-bone/10">
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
                <tr key={m.id} className="odd:bg-lacquer/50">
                  <td className="max-w-32 truncate px-3 py-2 font-mono text-xs opacity-70">{m.id}</td>
                  <td className="px-3 py-2">{m.winnerNickname ?? m.winnerId}</td>
                  <td className="px-3 py-2">{m.loserNickname ?? m.loserId}</td>
                  <td className="px-3 py-2">
                    {m.winnerEloChange >= 0 ? '+' : ''}
                    {m.winnerEloChange} / {m.loserEloChange}
                  </td>
                  <td className="px-3 py-2">{m.turns ?? '—'}</td>
                  <td className="px-3 py-2">{m.duration != null ? `${Math.round(m.duration / 60)}m` : '—'}</td>
                  <td className="px-3 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {CardModal}
    </PageShell>
  );
}
