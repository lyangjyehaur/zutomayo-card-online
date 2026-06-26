import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getAllCardDefs } from '../game/cards/loader';
import type { CardDef, Element, CardType } from '../game/types';
import '../components/AdminPanel.css';

const ELEMENTS: (Element | 'all')[] = ['all', '闇', '炎', '電気', '風', 'カオス'];
const TYPES: (CardType | 'all')[] = ['all', 'Character', 'Enchant', 'Area Enchant'];
const PACKS = ['all', 'THE WORLD IS CHANGING', 'ALL ALONG THE WATCHTOWER', 'Off Minor', 'Fantasy Is Reality'];

export function AdminPage() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem('admin_auth') === 'true');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [filterPack, setFilterPack] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'id' | 'name' | 'cost' | 'attack'>('id');
  const [selectedCard, setSelectedCard] = useState<CardDef | null>(null);

  const allCards = useMemo(() => getAllCardDefs(), []);

  const filtered = useMemo(() => {
    let cards = allCards;
    if (filterElement !== 'all') cards = cards.filter(c => c.element === filterElement);
    if (filterType !== 'all') cards = cards.filter(c => c.type === filterType);
    if (filterPack !== 'all') cards = cards.filter(c => c.pack === filterPack);
    if (searchText) {
      const q = searchText.toLowerCase();
      cards = cards.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.effect.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.song.toLowerCase().includes(q)
      );
    }
    return [...cards].sort((a, b) => {
      if (sortBy === 'cost') return a.powerCost - b.powerCost;
      if (sortBy === 'attack') {
        const aAtk = a.attack ? Math.max(a.attack.night, a.attack.day) : 0;
        const bAtk = b.attack ? Math.max(b.attack.night, b.attack.day) : 0;
        return bAtk - aAtk;
      }
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    });
  }, [allCards, filterElement, filterType, searchText, sortBy]);

  // Auth gate
  if (!authenticated) {
    return (
      <main className="admin-page app-screen">
        <header className="screen-header">
          <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
          <h1>管理員驗證</h1>
        </header>
        <section className="admin-login">
          <input
            type="password"
            placeholder="輸入管理密碼"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const adminPwd = import.meta.env.VITE_ADMIN_PASSWORD || 'zutomayo2026';
                if (password === adminPwd) {
                  sessionStorage.setItem('admin_auth', 'true');
                  setAuthenticated(true);
                } else {
                  setError('密碼錯誤');
                }
              }
            }}
          />
          <button onClick={() => {
            const adminPwd = import.meta.env.VITE_ADMIN_PASSWORD || 'zutomayo2026';
            if (password === adminPwd) {
              sessionStorage.setItem('admin_auth', 'true');
              setAuthenticated(true);
            } else {
              setError('密碼錯誤');
            }
          }}>登入</button>
          {error && <p className="admin-error">{error}</p>}
        </section>
      </main>
    );
  }

  // Card detail modal
  const CardModal = selectedCard ? (
    <div className="admin-modal-overlay" onClick={() => setSelectedCard(null)}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <button className="admin-modal-close" onClick={() => setSelectedCard(null)}>✕</button>
        <div className="admin-modal-content">
          <img src={selectedCard.image} alt={selectedCard.name} referrerPolicy="no-referrer" />
          <div className="admin-modal-info">
            <h3>{selectedCard.name}</h3>
            <p className="admin-card-id">{selectedCard.id}</p>
            <table className="admin-detail-table">
              <tbody>
                <tr><td>屬性</td><td>{selectedCard.element}</td></tr>
                <tr><td>類型</td><td>{selectedCard.type}</td></tr>
                <tr><td>稀有度</td><td>{selectedCard.rarity}</td></tr>
                <tr><td>時計</td><td>{selectedCard.clock}</td></tr>
                {selectedCard.attack && (
                  <tr><td>攻擊力</td><td>🌙{selectedCard.attack.night} / ☀️{selectedCard.attack.day}</td></tr>
                )}
                <tr><td>Power Cost</td><td>{selectedCard.powerCost}</td></tr>
                <tr><td>SEND TO POWER</td><td>{selectedCard.sendToPower}</td></tr>
                <tr><td>歌曲</td><td>{selectedCard.song || '—'}</td></tr>
                <tr><td>畫師</td><td>{selectedCard.illustrator || '—'}</td></tr>
                <tr><td>卡包</td><td>{selectedCard.pack}</td></tr>
                {selectedCard.effect && (
                  <tr><td>效果</td><td className="admin-effect-text">{selectedCard.effect}</td></tr>
                )}
                {selectedCard.errata && (
                  <tr><td>勘誤</td><td className="admin-errata">{selectedCard.errata}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <h1>卡牌資料管理</h1>
        <span className="admin-count">{filtered.length} / {allCards.length} 張</span>
        <button className="nav-link" onClick={() => navigate('/admin/i18n')}>🌐 i18n</button>
        <button className="logout-btn" onClick={() => {
          sessionStorage.removeItem('admin_auth');
          setAuthenticated(false);
        }}>登出</button>
      </header>

      <div className="admin-filters">
        <input
          type="text"
          placeholder="搜尋卡名/效果/ID..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="admin-search"
        />
        <div className="admin-filter-row">
          <label>屬性</label>
          {ELEMENTS.map(el => (
            <button key={el} className={`filter-chip ${filterElement === el ? 'active' : ''}`}
              onClick={() => setFilterElement(el)}>{el === 'all' ? '全部' : el}</button>
          ))}
        </div>
        <div className="admin-filter-row">
          <label>類型</label>
          {TYPES.map(t => (
            <button key={t} className={`filter-chip ${filterType === t ? 'active' : ''}`}
              onClick={() => setFilterType(t)}>{t === 'all' ? '全部' : t === 'Character' ? '角色' : t === 'Enchant' ? '附魔' : '區域'}</button>
          ))}
        </div>
        <div className="admin-filter-row">
          <label>卡包</label>
          {PACKS.map(p => (
            <button key={p} className={`filter-chip ${filterPack === p ? 'active' : ''}`}
              onClick={() => setFilterPack(p)}>{p === 'all' ? '全部' : p}</button>
          ))}
        </div>
        <div className="admin-filter-row">
          <label>排序</label>
          {(['id', 'name', 'cost', 'attack'] as const).map(s => (
            <button key={s} className={`filter-chip ${sortBy === s ? 'active' : ''}`}
              onClick={() => setSortBy(s)}>{s === 'id' ? '編號' : s === 'name' ? '名稱' : s === 'cost' ? '能量' : '攻擊'}</button>
          ))}
        </div>
      </div>

      <div className="admin-grid">
        {filtered.map(card => (
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
            {card.effect && <div className="admin-card-effect-badge">E</div>}
          </div>
        ))}
      </div>

      {CardModal}
    </main>
  );
}
