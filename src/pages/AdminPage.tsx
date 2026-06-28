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
const TRIGGERS = ['all', 'onUse', 'onTurnStart', 'onTurnEnd', 'onDamageReceived', 'onChronosChanged', 'onZoneEntered', 'onBattle'];
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
  name: string; element: Element; type: CardType; rarity: string;
  clock: string; attackNight: string; attackDay: string;
  powerCost: string; sendToPower: string;
  effect: string; image: string; errata: string;
  pack: string; song: string; illustrator: string;
};

function cardToDraft(card: CardDef): CardEditDraft {
  return {
    name: card.name, element: card.element, type: card.type, rarity: card.rarity,
    clock: String(card.clock),
    attackNight: card.attack ? String(card.attack.night) : '',
    attackDay: card.attack ? String(card.attack.day) : '',
    powerCost: String(card.powerCost), sendToPower: String(card.sendToPower),
    effect: card.effect, image: card.image, errata: card.errata,
    pack: card.pack, song: card.song, illustrator: card.illustrator,
  };
}

function draftToPatch(draft: CardEditDraft): Partial<CardDef> {
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
  return {
    name: draft.name, element: draft.element, type: draft.type, rarity: draft.rarity,
    clock: num(draft.clock),
    attack: draft.type === 'Character' ? { night: num(draft.attackNight), day: num(draft.attackDay) } : null,
    powerCost: num(draft.powerCost), sendToPower: num(draft.sendToPower),
    effect: draft.effect, image: draft.image.trim(), errata: draft.errata,
    pack: draft.pack, song: draft.song, illustrator: draft.illustrator,
  };
}

function changedFields(card: CardDef, draft: CardEditDraft): Partial<CardDef> {
  const next = draftToPatch(draft);
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (k === 'attack') {
      const a = card.attack, b = v as CardDef['attack'];
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
  return card.effect.split('\n').map((l) => l.trim()).filter(Boolean);
}

function conditionTypes(effect: ParsedEffect): string[] {
  const collect = (conditions: ParsedEffect['conditions']): string[] =>
    conditions.flatMap((c) => c.type === 'and' || c.type === 'or' ? [c.type, ...collect(c.value)] : [c.type]);
  return collect(effect.conditions);
}

function parseCardMeta(card: CardDef): ParsedCardMeta {
  const lines = effectLines(card);
  const parsed = lines.map((l) => parseEffect(l)).filter((x): x is ParsedEffect => Boolean(x));
  const unparsedLines = lines.filter((l) => !parseEffect(l));
  const all = parsed.flatMap((e) => e.expiry ? [e, e.expiry] : [e]);
  const actions = [...new Set(all.map((e) => e.action.type))];
  const triggers = [...new Set(all.map((e) => e.trigger))];
  const conditions = [...new Set(all.flatMap(conditionTypes))];
  const hasPendingChoice = actions.some((a) => /choose|reveal|recover|move|swap|reorder|useFrom/i.test(a));
  const hasAreaExpiry = card.type === 'Area Enchant' && all.some((e) =>
    Boolean(e.expiry) || e.action.type === 'moveSelfAreaEnchant' || e.rawText.includes('ターンの終了時') || e.rawText.includes('アビスに置く'));
  return { card, lines, parsed, unparsedLines, triggers, actions, conditions, hasPendingChoice, hasAreaExpiry };
}

function badgeList(items: string[], empty = '—') {
  if (items.length === 0) return <span className="engine-badge muted">{empty}</span>;
  return items.map((item) => <span className="engine-badge" key={item}>{item}</span>);
}

// ===== EffectInspector (read-only) =====
function EffectInspector({ meta }: { meta: ParsedCardMeta }) {
  const astJson = JSON.stringify(meta.parsed, null, 2);
  if (meta.lines.length === 0) return <section className="effect-inspector"><h4>效果引擎</h4><p className="admin-empty-copy">無效果</p></section>;
  return (
    <section className="effect-inspector">
      <div className="inspector-heading">
        <div><h4>效果引擎</h4><p>{meta.parsed.length}/{meta.lines.length} 行已解析{meta.unparsedLines.length ? `，未解析 ${meta.unparsedLines.length} 行` : ''}</p></div>
        <button className="filter-chip" type="button" onClick={() => navigator.clipboard?.writeText(astJson)}>複製 AST</button>
      </div>
      <div className="effect-original"><strong>原文</strong>{meta.lines.map((l) => <p key={l}>{l}</p>)}</div>
      <div className="engine-badge-grid">
        <div><span>Trigger</span><div>{badgeList(meta.triggers)}</div></div>
        <div><span>Action</span><div>{badgeList(meta.actions)}</div></div>
        <div><span>Condition</span><div>{badgeList(meta.conditions)}</div></div>
      </div>
      {meta.parsed.map((effect, i) => (
        <article className="parsed-effect-card" key={`${effect.rawText}-${i}`}>
          <div>{badgeList([effect.trigger, effect.action.type])}</div>
          <p>{effect.rawText}</p>
          {effect.conditions.length > 0 && <small>條件：{conditionTypes(effect).join(', ')}</small>}
          {effect.expiry && <small>附帶 expiry：{effect.expiry.trigger} / {effect.expiry.action.type}</small>}
        </article>
      ))}
      <details className="ast-details"><summary>查看完整 AST JSON</summary><pre>{astJson}</pre></details>
      {meta.unparsedLines.length > 0 && <div className="admin-unparsed-lines"><strong>未解析行</strong>{meta.unparsedLines.map((l) => <p key={l}>{l}</p>)}</div>}
    </section>
  );
}

// ===== Card Edit Form =====
function CardEditForm({ card, onSaved }: { card: CardDef; onSaved: (updated: CardDef) => void }) {
  const [draft, setDraft] = useState<CardEditDraft>(() => cardToDraft(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => { setDraft(cardToDraft(card)); setSuccess(false); setError(''); }, [card]);

  const set = (field: keyof CardEditDraft, value: string) => setDraft((d) => ({ ...d, [field]: value }));

  const handleSave = async () => {
    const patch = changedFields(card, draft);
    if (Object.keys(patch).length === 0) { setSuccess(true); return; }
    setSaving(true); setError(''); setSuccess(false);
    try {
      await adminUpdateCard(card.id, patch);
      setSuccess(true);
      onSaved({ ...card, ...patch } as CardDef);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally { setSaving(false); }
  };

  return (
    <div className="card-edit-form">
      <div className="edit-field"><label>名稱</label><input value={draft.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="edit-row">
        <div className="edit-field"><label>屬性</label><select value={draft.element} onChange={(e) => set('element', e.target.value)}>{ELEMENT_OPTIONS.map((el) => <option key={el}>{el}</option>)}</select></div>
        <div className="edit-field"><label>類型</label><select value={draft.type} onChange={(e) => set('type', e.target.value)}>{TYPE_OPTIONS.map((tp) => <option key={tp}>{tp}</option>)}</select></div>
        <div className="edit-field"><label>稀有度</label><select value={draft.rarity} onChange={(e) => set('rarity', e.target.value)}>{RARITY_OPTIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
      </div>
      <div className="edit-row">
        <div className="edit-field"><label>時計</label><input type="number" value={draft.clock} onChange={(e) => set('clock', e.target.value)} /></div>
        <div className="edit-field"><label>Power Cost</label><input type="number" value={draft.powerCost} onChange={(e) => set('powerCost', e.target.value)} /></div>
        <div className="edit-field"><label>SEND TO POWER</label><input type="number" value={draft.sendToPower} onChange={(e) => set('sendToPower', e.target.value)} /></div>
      </div>
      {draft.type === 'Character' && (
        <div className="edit-row">
          <div className="edit-field"><label>🌙 夜間攻擊</label><input type="number" value={draft.attackNight} onChange={(e) => set('attackNight', e.target.value)} /></div>
          <div className="edit-field"><label>☀️ 日間攻擊</label><input type="number" value={draft.attackDay} onChange={(e) => set('attackDay', e.target.value)} /></div>
        </div>
      )}
      <div className="edit-field"><label>效果原文</label><textarea value={draft.effect} onChange={(e) => set('effect', e.target.value)} rows={4} /></div>
      <div className="edit-field"><label>圖片 URL</label><input value={draft.image} onChange={(e) => set('image', e.target.value)} /></div>
      <div className="edit-row">
        <div className="edit-field"><label>歌曲</label><input value={draft.song} onChange={(e) => set('song', e.target.value)} /></div>
        <div className="edit-field"><label>畫師</label><input value={draft.illustrator} onChange={(e) => set('illustrator', e.target.value)} /></div>
      </div>
      <div className="edit-field"><label>卡包</label><select value={draft.pack} onChange={(e) => set('pack', e.target.value)}>{FALLBACK_PACKS.map((p) => <option key={p}>{p}</option>)}</select></div>
      <div className="edit-field"><label>勘誤</label><textarea value={draft.errata} onChange={(e) => set('errata', e.target.value)} rows={2} /></div>
      <div className="edit-actions">
        <button className="primary-action" type="button" disabled={saving} onClick={() => void handleSave()}>{saving ? '儲存中…' : '儲存'}</button>
        {success && <span className="save-success">✓ 已儲存</span>}
        {error && <span className="save-error">{error}</span>}
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
    setSaving(true); setError(''); setSuccess(false);
    try {
      for (const lang of I18N_LANGS) {
        await adminUpdateCardI18n(cardId, lang.code, draft[lang.code] ?? '');
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally { setSaving(false); }
  };

  if (loading) return <p>載入翻譯中…</p>;

  return (
    <div className="i18n-editor">
      {I18N_LANGS.map((lang) => (
        <div className="i18n-field" key={lang.code}>
          <label>{lang.label} <span className="i18n-code">({lang.code})</span></label>
          <textarea value={draft[lang.code] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [lang.code]: e.target.value }))} rows={3} placeholder={`${lang.label} 翻譯…`} />
        </div>
      ))}
      <div className="edit-actions">
        <button className="primary-action" type="button" disabled={saving} onClick={() => void handleSave()}>{saving ? '儲存中…' : '儲存翻譯'}</button>
        {success && <span className="save-success">✓ 已儲存</span>}
        {error && <span className="save-error">{error}</span>}
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
  const [cardVersion, setCardVersion] = useState(0);

  const allCards = useMemo(() => getAllCardDefs(), [cardVersion]);
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '';

  const metaById = useMemo(() => new Map(allCards.map((card) => [card.id, parseCardMeta(card)])), [allCards]);
  const audit = useMemo(() => {
    const metas = [...metaById.values()];
    const effectCards = metas.filter((m) => m.lines.length > 0);
    return {
      totalCards: metas.length, effectCards: effectCards.length,
      effectLines: metas.reduce((s, m) => s + m.lines.length, 0),
      parsedLines: metas.reduce((s, m) => s + m.parsed.length, 0),
      unparsedLines: metas.reduce((s, m) => s + m.unparsedLines.length, 0),
      runtimeParsedEffects: metas.reduce((s, m) => s + m.parsed.flatMap((e) => e.expiry ? [e, e.expiry] : [e]).length, 0),
    };
  }, [metaById]);

  const filtered = useMemo(() => {
    let cards = allCards;
    if (filterElement !== 'all') cards = cards.filter((c) => c.element === filterElement);
    if (filterType !== 'all') cards = cards.filter((c) => c.type === filterType);
    if (filterPack !== 'all') cards = cards.filter((c) => c.pack === filterPack);
    if (filterTrigger !== 'all') cards = cards.filter((c) => metaById.get(c.id)?.triggers.includes(filterTrigger));
    if (filterAction) cards = cards.filter((c) => metaById.get(c.id)?.actions.some((a) => a.toLowerCase().includes(filterAction.toLowerCase())));
    if (filterCondition) cards = cards.filter((c) => metaById.get(c.id)?.conditions.some((cond) => cond.toLowerCase().includes(filterCondition.toLowerCase())));
    if (pendingOnly) cards = cards.filter((c) => metaById.get(c.id)?.hasPendingChoice);
    if (areaExpiryOnly) cards = cards.filter((c) => metaById.get(c.id)?.hasAreaExpiry);
    if (searchText) {
      const q = searchText.toLowerCase();
      cards = cards.filter((c) => c.name.toLowerCase().includes(q) || c.effect.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.song.toLowerCase().includes(q));
    }
    return [...cards].sort((a, b) => {
      if (sortBy === 'cost') return a.powerCost - b.powerCost;
      if (sortBy === 'attack') return ((b.attack ? Math.max(b.attack.night, b.attack.day) : 0) - (a.attack ? Math.max(a.attack.night, a.attack.day) : 0));
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    });
  }, [allCards, areaExpiryOnly, filterAction, filterCondition, filterElement, filterPack, filterTrigger, filterType, pendingOnly, searchText, sortBy, metaById]);

  const handleLogin = useCallback(async () => {
    setLoggingIn(true); setError('');
    try {
      const { token: tok } = await adminLogin(password);
      sessionStorage.setItem(ADMIN_TOKEN_KEY, tok);
      setAuthenticated(true);
    } catch (e) { setError(e instanceof ApiError ? e.message : '登入失敗'); }
    finally { setLoggingIn(false); }
  }, [password]);

  const handleLogout = useCallback(() => { sessionStorage.removeItem(ADMIN_TOKEN_KEY); setAuthenticated(false); }, []);

  const refreshUsers = useCallback(async () => {
    if (!token) return;
    setAdminLoading(true); setAdminError('');
    try { const { users: u } = await adminGetUsers(token); setUsers(u); }
    catch (e) { setAdminError(e instanceof Error ? e.message : '載入失敗'); }
    finally { setAdminLoading(false); }
  }, [token]);

  const refreshMatches = useCallback(async () => {
    if (!token) return;
    setAdminLoading(true); setAdminError('');
    try { const { matches: m } = await adminGetMatches(token); setMatches(m); }
    catch (e) { setAdminError(e instanceof Error ? e.message : '載入失敗'); }
    finally { setAdminLoading(false); }
  }, [token]);

  useEffect(() => {
    if (activeTab === 'users' && users.length === 0) void refreshUsers();
    if (activeTab === 'matches' && matches.length === 0) void refreshMatches();
  }, [activeTab, matches.length, refreshMatches, refreshUsers, users.length]);

  if (!authenticated) {
    return (
      <main className="admin-page app-screen">
        <header className="screen-header"><button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button><h1>管理員驗證</h1></header>
        <section className="admin-login">
          <input type="password" placeholder="輸入管理密碼" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !loggingIn) void handleLogin(); }} disabled={loggingIn} />
          <button onClick={() => void handleLogin()} disabled={loggingIn || !password}>{loggingIn ? '驗證中…' : '登入'}</button>
          {error && <p className="admin-error">{error}</p>}
        </section>
      </main>
    );
  }

  const selectedMeta = selectedCard ? metaById.get(selectedCard.id) : null;
  const CardModal = selectedCard && selectedMeta ? (
    <div className="admin-modal-overlay" onClick={() => setSelectedCard(null)}>
      <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-close" onClick={() => setSelectedCard(null)}>✕</button>
        <div className="modal-header">
          <img src={selectedCard.image} alt={selectedCard.name} className="modal-thumb" referrerPolicy="no-referrer" />
          <div><h3>{selectedCard.name}</h3><p className="admin-card-id">{selectedCard.id}</p></div>
        </div>
        <div className="modal-tabs">
          {([['basic', '📝 基本資訊'], ['engine', '⚙️ 效果引擎'], ['i18n', '🌐 多語言']] as const).map(([key, label]) => (
            <button key={key} className={`modal-tab ${modalTab === key ? 'active' : ''}`} onClick={() => setModalTab(key)}>{label}</button>
          ))}
        </div>
        <div className="modal-tab-content">
          {modalTab === 'basic' && <CardEditForm card={selectedCard} onSaved={(updated) => { setSelectedCard(updated); setCardVersion((v) => v + 1); void refreshCards(); }} />}
          {modalTab === 'engine' && <EffectInspector meta={selectedMeta} />}
          {modalTab === 'i18n' && <I18nEditor cardId={selectedCard.id} />}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <h1>管理員面板</h1>
        {activeTab === 'cards' && <span className="admin-count">{filtered.length} / {allCards.length} 張</span>}
        <div className="admin-tabs">
          <button className={`filter-chip ${activeTab === 'cards' ? 'active' : ''}`} onClick={() => setActiveTab('cards')}>卡牌資料</button>
          <button className={`filter-chip ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>使用者</button>
          <button className={`filter-chip ${activeTab === 'matches' ? 'active' : ''}`} onClick={() => setActiveTab('matches')}>對戰</button>
        </div>
        <button className="logout-btn" onClick={handleLogout}>登出</button>
      </header>

      {activeTab === 'cards' && (
        <div className="admin-card-area">
          <section className="admin-audit-summary">
            <div><span>總卡</span><strong>{audit.totalCards}</strong></div>
            <div><span>效果卡</span><strong>{audit.effectCards}</strong></div>
            <div><span>效果行</span><strong>{audit.parsedLines}/{audit.effectLines}</strong></div>
            <div><span>未解析</span><strong>{audit.unparsedLines}</strong></div>
            <div><span>Runtime effects</span><strong>{audit.runtimeParsedEffects}</strong></div>
          </section>
          <div className="admin-filters">
            <input type="text" placeholder="搜尋卡名/效果/ID..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="admin-search" />
            <div className="admin-filter-row"><label>屬性</label>{ELEMENTS.map((el) => <button key={el} className={`filter-chip ${filterElement === el ? 'active' : ''}`} onClick={() => setFilterElement(el)}>{el === 'all' ? '全部' : el}</button>)}</div>
            <div className="admin-filter-row"><label>類型</label>{TYPES.map((type) => <button key={type} className={`filter-chip ${filterType === type ? 'active' : ''}`} onClick={() => setFilterType(type)}>{type === 'all' ? '全部' : type === 'Character' ? '角色' : type === 'Enchant' ? '附魔' : '區域'}</button>)}</div>
            <div className="admin-filter-row"><label>Trigger</label>{TRIGGERS.map((trigger) => <button key={trigger} className={`filter-chip ${filterTrigger === trigger ? 'active' : ''}`} onClick={() => setFilterTrigger(trigger)}>{trigger === 'all' ? '全部' : trigger}</button>)}</div>
            <div className="admin-filter-row admin-engine-searches"><label>引擎</label><input placeholder="Action type" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} /><input placeholder="Condition type" value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)} /><button className={`filter-chip ${pendingOnly ? 'active' : ''}`} onClick={() => setPendingOnly((v) => !v)}>待選卡</button><button className={`filter-chip ${areaExpiryOnly ? 'active' : ''}`} onClick={() => setAreaExpiryOnly((v) => !v)}>Area expiry</button></div>
            <div className="admin-filter-row"><label>卡包</label>{FALLBACK_PACKS.map((pack) => <button key={pack} className={`filter-chip ${filterPack === pack ? 'active' : ''}`} onClick={() => setFilterPack(pack)}>{pack === 'all' ? '全部' : pack}</button>)}</div>
            <div className="admin-filter-row"><label>排序</label>{(['id', 'name', 'cost', 'attack'] as const).map((sort) => <button key={sort} className={`filter-chip ${sortBy === sort ? 'active' : ''}`} onClick={() => setSortBy(sort)}>{sort === 'id' ? '編號' : sort === 'name' ? '名稱' : sort === 'cost' ? '能量' : '攻擊'}</button>)}</div>
          </div>
          <div className="admin-grid">
            {filtered.map((card) => {
              const meta = metaById.get(card.id);
              return (
                <div key={card.id} className="admin-card" onClick={() => { setSelectedCard(card); setModalTab('basic'); }}>
                  <img src={card.image} alt={card.name} loading="lazy" referrerPolicy="no-referrer" />
                  <div className="admin-card-overlay">
                    <span className="admin-card-name">{card.name}</span>
                    <span className="admin-card-id">{card.id}</span>
                    <span className="admin-card-meta">{card.element} • {card.type === 'Character' ? '角' : card.type === 'Enchant' ? '附' : '域'}{card.type === 'Character' && card.attack && ` • 🌙${card.attack.night}/☀️${card.attack.day}`}{card.powerCost > 0 && ` • ⚡${card.powerCost}`}</span>
                  </div>
                  {card.effect && <div className={`admin-card-effect-badge ${meta?.unparsedLines.length ? 'warning' : ''}`}>{meta?.parsed.length ?? 0}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <section className="admin-data-section">
          {adminLoading && <p>載入中…</p>}
          {adminError && <p className="admin-error">{adminError}</p>}
          <table className="admin-data-table"><thead><tr><th>ID</th><th>Email</th><th>暱稱</th><th>ELO</th><th>場次</th><th>勝率</th><th>操作</th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}><td className="id-cell">{u.id}</td><td>{u.email}</td><td>{u.nickname}</td><td>{eloEdits[u.id] ?? u.elo}<input className="elo-input" value={eloEdits[u.id] ?? ''} placeholder={String(u.elo)} onChange={(e) => setEloEdits((prev) => ({ ...prev, [u.id]: e.target.value }))} /></td><td>{u.matchCount}</td><td>{u.winRate}%</td><td><button className="filter-chip" disabled={eloSavingId === u.id} onClick={() => { const v = Number(eloEdits[u.id]); if (!Number.isFinite(v)) return; void adminResetElo(token, u.id, Math.trunc(v)).then(refreshUsers).then(() => setEloEdits((p) => { const n = { ...p }; delete n[u.id]; return n; })); setEloSavingId(u.id); setTimeout(() => setEloSavingId(null), 1500); }}>{eloSavingId === u.id ? '已更新' : '更新 ELO'}</button></td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {activeTab === 'matches' && (
        <section className="admin-data-section">
          {adminLoading && <p>載入中…</p>}
          {adminError && <p className="admin-error">{adminError}</p>}
          <table className="admin-data-table"><thead><tr><th>ID</th><th>勝者</th><th>敗者</th><th>ELO Δ</th><th>回合</th><th>時長</th><th>時間</th></tr></thead>
            <tbody>{matches.map((m) => (
              <tr key={m.id}><td className="id-cell">{m.id}</td><td>{m.winnerNickname ?? m.winnerId}</td><td>{m.loserNickname ?? m.loserId}</td><td>{m.winnerEloChange >= 0 ? '+' : ''}{m.winnerEloChange} / {m.loserEloChange}</td><td>{m.turns ?? '—'}</td><td>{m.duration != null ? `${Math.round(m.duration / 60)}m` : '—'}</td><td>{new Date(m.createdAt).toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {CardModal}
    </main>
  );
}
