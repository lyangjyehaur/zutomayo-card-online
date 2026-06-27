import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getAllCardDefs } from '../game/cards/loader';
import { parseEffect } from '../game/effects/parser';
import type { ParsedEffect } from '../game/effects';
import type { CardDef, Element, CardType } from '../game/types';
import { ApiError, adminGetMatches, adminGetUsers, adminLogin, adminResetElo } from '../api/client';
import type { AdminMatch, AdminUser } from '../api/client';
import '../components/AdminPanel.css';

const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';

const ELEMENTS: (Element | 'all')[] = ['all', '闇', '炎', '電気', '風', 'カオス'];
const TYPES: (CardType | 'all')[] = ['all', 'Character', 'Enchant', 'Area Enchant'];
const PACKS = ['all', 'THE WORLD IS CHANGING', 'ALL ALONG THE WATCHTOWER', 'Off Minor', 'Fantasy Is Reality'];
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

function effectLines(card: CardDef): string[] {
  return card.effect
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function conditionTypes(effect: ParsedEffect): string[] {
  const collect = (conditions: ParsedEffect['conditions']): string[] =>
    conditions.flatMap((condition) =>
      condition.type === 'and' || condition.type === 'or'
        ? [condition.type, ...collect(condition.value)]
        : [condition.type],
    );
  return collect(effect.conditions);
}

function parseCardMeta(card: CardDef): ParsedCardMeta {
  const lines = effectLines(card);
  const parsed = lines.map((line) => parseEffect(line)).filter((item): item is ParsedEffect => Boolean(item));
  const unparsedLines = lines.filter((line) => !parseEffect(line));
  const allEffects = parsed.flatMap((effect) => (effect.expiry ? [effect, effect.expiry] : [effect]));
  const actions = [...new Set(allEffects.map((effect) => effect.action.type))];
  const triggers = [...new Set(allEffects.map((effect) => effect.trigger))];
  const conditions = [...new Set(allEffects.flatMap(conditionTypes))];
  const hasPendingChoice = actions.some((action) => /choose|reveal|recover|move|swap|reorder|useFrom/i.test(action));
  const hasAreaExpiry =
    card.type === 'Area Enchant' &&
    allEffects.some(
      (effect) =>
        Boolean(effect.expiry) ||
        effect.action.type === 'moveSelfAreaEnchant' ||
        effect.rawText.includes('ターンの終了時') ||
        effect.rawText.includes('アビスに置く'),
    );
  return { card, lines, parsed, unparsedLines, triggers, actions, conditions, hasPendingChoice, hasAreaExpiry };
}

function badgeList(items: string[], empty = '—') {
  if (items.length === 0) return <span className="engine-badge muted">{empty}</span>;
  return items.map((item) => (
    <span className="engine-badge" key={item}>
      {item}
    </span>
  ));
}

function EffectInspector({ meta }: { meta: ParsedCardMeta }) {
  const astJson = JSON.stringify(meta.parsed, null, 2);
  if (meta.lines.length === 0)
    return (
      <section className="effect-inspector">
        <h4>效果引擎</h4>
        <p className="admin-empty-copy">無效果</p>
      </section>
    );

  return (
    <section className="effect-inspector">
      <div className="inspector-heading">
        <div>
          <h4>效果引擎</h4>
          <p>
            {meta.parsed.length}/{meta.lines.length} 行已解析
            {meta.unparsedLines.length ? `，未解析 ${meta.unparsedLines.length} 行` : ''}
          </p>
        </div>
        <button className="filter-chip" type="button" onClick={() => navigator.clipboard?.writeText(astJson)}>
          複製 AST
        </button>
      </div>
      <div className="effect-original">
        <strong>原文</strong>
        {meta.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div className="engine-badge-grid">
        <div>
          <span>Trigger</span>
          <div>{badgeList(meta.triggers)}</div>
        </div>
        <div>
          <span>Action</span>
          <div>{badgeList(meta.actions)}</div>
        </div>
        <div>
          <span>Condition</span>
          <div>{badgeList(meta.conditions)}</div>
        </div>
      </div>
      {meta.parsed.map((effect, index) => (
        <article className="parsed-effect-card" key={`${effect.rawText}-${index}`}>
          <div>{badgeList([effect.trigger, effect.action.type])}</div>
          <p>{effect.rawText}</p>
          {effect.conditions.length > 0 && <small>條件：{conditionTypes(effect).join(', ')}</small>}
          {effect.expiry && (
            <small>
              附帶 expiry：{effect.expiry.trigger} / {effect.expiry.action.type}
            </small>
          )}
        </article>
      ))}
      <details className="ast-details">
        <summary>查看完整 AST JSON</summary>
        <pre>{astJson}</pre>
      </details>
      {meta.unparsedLines.length > 0 && (
        <div className="admin-unparsed-lines">
          <strong>未解析行</strong>
          {meta.unparsedLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}

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

  const adminToken = () => sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';

  const handleLogin = useCallback(async () => {
    setError('');
    setLoggingIn(true);
    try {
      const { token } = await adminLogin(password);
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
      setAuthenticated(true);
      setPassword('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '登入失敗';
      setError(msg === 'Invalid password' ? '密碼錯誤' : msg);
    } finally {
      setLoggingIn(false);
    }
  }, [password]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAuthenticated(false);
    setUsers([]);
    setMatches([]);
    setAdminError('');
    setEloEdits({});
  }, []);

  const refreshUsers = useCallback(async () => {
    const token = adminToken();
    if (!token) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const data = await adminGetUsers(token);
      setUsers(data.users);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '無法取得使用者列表';
      setAdminError(msg === 'Unauthorized' ? '驗證失效，請重新登入' : msg);
      if (err instanceof ApiError && err.status === 401) handleLogout();
    } finally {
      setAdminLoading(false);
    }
  }, [handleLogout]);

  const refreshMatches = useCallback(async () => {
    const token = adminToken();
    if (!token) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const data = await adminGetMatches(token);
      setMatches(data.matches);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '無法取得對戰列表';
      setAdminError(msg === 'Unauthorized' ? '驗證失效，請重新登入' : msg);
      if (err instanceof ApiError && err.status === 401) handleLogout();
    } finally {
      setAdminLoading(false);
    }
  }, [handleLogout]);

  const handleResetElo = useCallback(
    async (userId: string) => {
      const token = adminToken();
      if (!token) return;
      const raw = eloEdits[userId];
      const newElo = Number(raw);
      if (raw === '' || Number.isNaN(newElo)) {
        setAdminError('請輸入有效的 ELO 數值');
        return;
      }
      setEloSavingId(userId);
      setAdminError('');
      try {
        const result = await adminResetElo(token, userId, newElo);
        setUsers((prev) => prev.map((u) => (u.id === result.id ? { ...u, elo: result.elo } : u)));
        setEloEdits((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'ELO 重置失敗';
        setAdminError(msg === 'Unauthorized' ? '驗證失效，請重新登入' : msg);
        if (err instanceof ApiError && err.status === 401) handleLogout();
      } finally {
        setEloSavingId(null);
      }
    },
    [eloEdits, handleLogout],
  );

  useEffect(() => {
    if (!authenticated) return;
    if (activeTab === 'users' && users.length === 0) void refreshUsers();
    if (activeTab === 'matches' && matches.length === 0) void refreshMatches();
  }, [activeTab, authenticated, matches.length, refreshMatches, refreshUsers, users.length]);

  const allCards = useMemo(() => getAllCardDefs(), []);
  const metaById = useMemo(() => new Map(allCards.map((card) => [card.id, parseCardMeta(card)])), [allCards]);
  const audit = useMemo(() => {
    const metas = [...metaById.values()];
    const effectCards = metas.filter((meta) => meta.lines.length > 0);
    return {
      totalCards: metas.length,
      effectCards: effectCards.length,
      effectLines: metas.reduce((sum, meta) => sum + meta.lines.length, 0),
      parsedLines: metas.reduce((sum, meta) => sum + meta.parsed.length, 0),
      unparsedLines: metas.reduce((sum, meta) => sum + meta.unparsedLines.length, 0),
      runtimeParsedEffects: metas.reduce(
        (sum, meta) =>
          sum + meta.parsed.flatMap((effect) => (effect.expiry ? [effect, effect.expiry] : [effect])).length,
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
        metaById.get(c.id)?.actions.some((action) => action.toLowerCase().includes(filterAction.toLowerCase())),
      );
    if (filterCondition)
      cards = cards.filter((c) =>
        metaById
          .get(c.id)
          ?.conditions.some((condition) => condition.toLowerCase().includes(filterCondition.toLowerCase())),
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

  if (!authenticated) {
    return (
      <main className="admin-page app-screen">
        <header className="screen-header">
          <button className="back-btn" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
          <h1>管理員驗證</h1>
        </header>
        <section className="admin-login">
          <input
            type="password"
            placeholder="輸入管理密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loggingIn) void handleLogin();
            }}
            disabled={loggingIn}
          />
          <button onClick={() => void handleLogin()} disabled={loggingIn || !password}>
            {loggingIn ? '驗證中…' : '登入'}
          </button>
          {error && <p className="admin-error">{error}</p>}
        </section>
      </main>
    );
  }

  const selectedMeta = selectedCard ? metaById.get(selectedCard.id) : null;
  const CardModal =
    selectedCard && selectedMeta ? (
      <div className="admin-modal-overlay" onClick={() => setSelectedCard(null)}>
        <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
          <button className="admin-modal-close" onClick={() => setSelectedCard(null)}>
            ✕
          </button>
          <div className="admin-modal-content admin-modal-inspector-content">
            <div className="admin-card-profile">
              <img src={selectedCard.image} alt={selectedCard.name} referrerPolicy="no-referrer" />
              <h3>{selectedCard.name}</h3>
              <p className="admin-card-id">{selectedCard.id}</p>
              <table className="admin-detail-table">
                <tbody>
                  <tr>
                    <td>屬性</td>
                    <td>{selectedCard.element}</td>
                  </tr>
                  <tr>
                    <td>類型</td>
                    <td>{selectedCard.type}</td>
                  </tr>
                  <tr>
                    <td>稀有度</td>
                    <td>{selectedCard.rarity}</td>
                  </tr>
                  <tr>
                    <td>時計</td>
                    <td>{selectedCard.clock}</td>
                  </tr>
                  {selectedCard.attack && (
                    <tr>
                      <td>攻擊力</td>
                      <td>
                        🌙{selectedCard.attack.night} / ☀️{selectedCard.attack.day}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>Power Cost</td>
                    <td>{selectedCard.powerCost}</td>
                  </tr>
                  <tr>
                    <td>SEND TO POWER</td>
                    <td>{selectedCard.sendToPower}</td>
                  </tr>
                  <tr>
                    <td>歌曲</td>
                    <td>{selectedCard.song || '—'}</td>
                  </tr>
                  <tr>
                    <td>畫師</td>
                    <td>{selectedCard.illustrator || '—'}</td>
                  </tr>
                  <tr>
                    <td>卡包</td>
                    <td>{selectedCard.pack}</td>
                  </tr>
                  {selectedCard.errata && (
                    <tr>
                      <td>勘誤</td>
                      <td className="admin-errata">{selectedCard.errata}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <EffectInspector meta={selectedMeta} />
          </div>
        </div>
      </div>
    ) : null;

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </button>
        <h1>管理員面板</h1>
        {activeTab === 'cards' && (
          <span className="admin-count">
            {filtered.length} / {allCards.length} 張
          </span>
        )}
        <div className="admin-tabs">
          <button
            className={`filter-chip ${activeTab === 'cards' ? 'active' : ''}`}
            onClick={() => setActiveTab('cards')}
          >
            卡牌資料
          </button>
          <button
            className={`filter-chip ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            使用者
          </button>
          <button
            className={`filter-chip ${activeTab === 'matches' ? 'active' : ''}`}
            onClick={() => setActiveTab('matches')}
          >
            對戰
          </button>
        </div>
        <button className="nav-link" onClick={() => navigate('/admin/i18n')}>
          🌐 i18n
        </button>
        <button className="logout-btn" onClick={handleLogout}>
          登出
        </button>
      </header>

      {activeTab === 'cards' && (
        <>
          <section className="admin-audit-summary">
            <div>
              <span>總卡</span>
              <strong>{audit.totalCards}</strong>
            </div>
            <div>
              <span>效果卡</span>
              <strong>{audit.effectCards}</strong>
            </div>
            <div>
              <span>效果行</span>
              <strong>
                {audit.parsedLines}/{audit.effectLines}
              </strong>
            </div>
            <div>
              <span>未解析</span>
              <strong>{audit.unparsedLines}</strong>
            </div>
            <div>
              <span>Runtime effects</span>
              <strong>{audit.runtimeParsedEffects}</strong>
            </div>
          </section>

          <div className="admin-filters">
            <input
              type="text"
              placeholder="搜尋卡名/效果/ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="admin-search"
            />
            <div className="admin-filter-row">
              <label>屬性</label>
              {ELEMENTS.map((el) => (
                <button
                  key={el}
                  className={`filter-chip ${filterElement === el ? 'active' : ''}`}
                  onClick={() => setFilterElement(el)}
                >
                  {el === 'all' ? '全部' : el}
                </button>
              ))}
            </div>
            <div className="admin-filter-row">
              <label>類型</label>
              {TYPES.map((type) => (
                <button
                  key={type}
                  className={`filter-chip ${filterType === type ? 'active' : ''}`}
                  onClick={() => setFilterType(type)}
                >
                  {type === 'all' ? '全部' : type === 'Character' ? '角色' : type === 'Enchant' ? '附魔' : '區域'}
                </button>
              ))}
            </div>
            <div className="admin-filter-row">
              <label>Trigger</label>
              {TRIGGERS.map((trigger) => (
                <button
                  key={trigger}
                  className={`filter-chip ${filterTrigger === trigger ? 'active' : ''}`}
                  onClick={() => setFilterTrigger(trigger)}
                >
                  {trigger === 'all' ? '全部' : trigger}
                </button>
              ))}
            </div>
            <div className="admin-filter-row admin-engine-searches">
              <label>引擎</label>
              <input placeholder="Action type" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} />
              <input
                placeholder="Condition type"
                value={filterCondition}
                onChange={(e) => setFilterCondition(e.target.value)}
              />
              <button
                className={`filter-chip ${pendingOnly ? 'active' : ''}`}
                onClick={() => setPendingOnly((v) => !v)}
              >
                待選卡
              </button>
              <button
                className={`filter-chip ${areaExpiryOnly ? 'active' : ''}`}
                onClick={() => setAreaExpiryOnly((v) => !v)}
              >
                Area expiry
              </button>
            </div>
            <div className="admin-filter-row">
              <label>卡包</label>
              {PACKS.map((pack) => (
                <button
                  key={pack}
                  className={`filter-chip ${filterPack === pack ? 'active' : ''}`}
                  onClick={() => setFilterPack(pack)}
                >
                  {pack === 'all' ? '全部' : pack}
                </button>
              ))}
            </div>
            <div className="admin-filter-row">
              <label>排序</label>
              {(['id', 'name', 'cost', 'attack'] as const).map((sort) => (
                <button
                  key={sort}
                  className={`filter-chip ${sortBy === sort ? 'active' : ''}`}
                  onClick={() => setSortBy(sort)}
                >
                  {sort === 'id' ? '編號' : sort === 'name' ? '名稱' : sort === 'cost' ? '能量' : '攻擊'}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-grid">
            {filtered.map((card) => {
              const meta = metaById.get(card.id);
              return (
                <div key={card.id} className="admin-card" onClick={() => setSelectedCard(card)}>
                  <img src={card.image} alt={card.name} loading="lazy" referrerPolicy="no-referrer" />
                  <div className="admin-card-overlay">
                    <span className="admin-card-name">{card.name}</span>
                    <span className="admin-card-id">{card.id}</span>
                    <span className="admin-card-meta">
                      {card.element} • {card.type === 'Character' ? '角' : card.type === 'Enchant' ? '附' : '域'}
                      {card.type === 'Character' && card.attack && ` • 🌙${card.attack.night}/☀️${card.attack.day}`}
                      {card.powerCost > 0 && ` • ⚡${card.powerCost}`}
                    </span>
                  </div>
                  {card.effect && (
                    <div className={`admin-card-effect-badge ${meta?.unparsedLines.length ? 'warning' : ''}`}>
                      {meta?.parsed.length ?? 0}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'users' && (
        <section className="admin-section">
          <div className="admin-section-heading">
            <h2>使用者列表</h2>
            <button className="filter-chip" onClick={() => void refreshUsers()} disabled={adminLoading}>
              {adminLoading ? '載入中…' : '重新載入'}
            </button>
          </div>
          {adminError && <p className="admin-error">{adminError}</p>}
          {users.length === 0 && !adminLoading && <p className="admin-empty-copy">尚無使用者資料</p>}
          {users.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>暱稱</th>
                  <th>Email</th>
                  <th>ELO</th>
                  <th>對戰</th>
                  <th>勝場</th>
                  <th>勝率</th>
                  <th>建立時間</th>
                  <th>重置 ELO</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.nickname || '—'}</td>
                    <td className="admin-table-muted">{user.email}</td>
                    <td>
                      <strong>{user.elo}</strong>
                    </td>
                    <td>{user.matchCount}</td>
                    <td>{user.wins}</td>
                    <td>{user.winRate}%</td>
                    <td className="admin-table-muted">{new Date(user.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="admin-elo-cell">
                        <input
                          type="number"
                          placeholder={String(user.elo)}
                          value={eloEdits[user.id] ?? ''}
                          onChange={(e) => setEloEdits((prev) => ({ ...prev, [user.id]: e.target.value }))}
                          disabled={eloSavingId === user.id}
                        />
                        <button
                          className="filter-chip"
                          onClick={() => void handleResetElo(user.id)}
                          disabled={eloSavingId === user.id || !eloEdits[user.id]}
                        >
                          {eloSavingId === user.id ? '儲存中…' : '重置'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {activeTab === 'matches' && (
        <section className="admin-section">
          <div className="admin-section-heading">
            <h2>對戰列表</h2>
            <button className="filter-chip" onClick={() => void refreshMatches()} disabled={adminLoading}>
              {adminLoading ? '載入中…' : '重新載入'}
            </button>
          </div>
          {adminError && <p className="admin-error">{adminError}</p>}
          {matches.length === 0 && !adminLoading && <p className="admin-empty-copy">尚無對戰紀錄</p>}
          {matches.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>勝者</th>
                  <th>敗者</th>
                  <th>ELO 變動</th>
                  <th>回合數</th>
                  <th>時長</th>
                  <th>對戰 ID</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id}>
                    <td className="admin-table-muted">{new Date(match.createdAt).toLocaleString()}</td>
                    <td>
                      {match.winnerNickname || '—'}{' '}
                      <span className="admin-table-muted">({match.winnerId.slice(0, 8)})</span>
                    </td>
                    <td>
                      {match.loserNickname || '—'}{' '}
                      <span className="admin-table-muted">({match.loserId.slice(0, 8)})</span>
                    </td>
                    <td>
                      <span className="admin-elo-up">+{match.winnerEloChange}</span> /{' '}
                      <span className="admin-elo-down">{match.loserEloChange}</span>
                    </td>
                    <td>{match.turns}</td>
                    <td>
                      {match.duration
                        ? `${Math.floor(match.duration / 60)}:${String(match.duration % 60).padStart(2, '0')}`
                        : '—'}
                    </td>
                    <td className="admin-table-muted">{match.id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {CardModal}
    </main>
  );
}
