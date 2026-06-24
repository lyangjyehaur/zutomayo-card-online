import { useState } from 'react';
import { register, login, logout, isLoggedIn } from '../api/client';

interface AuthPanelProps {
  onAuth: (user: { id: string; email: string; nickname: string; elo: number }) => void;
  onSkip: () => void;
}

export function AuthPanel({ onAuth, onSkip }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = mode === 'register'
        ? await register(email, password, nickname || undefined)
        : await login(email, password);
      onAuth(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-panel">
      <h2>{mode === 'login' ? '🔑 Login' : '📝 Register'}</h2>

      <form onSubmit={handleSubmit}>
        <div className="auth-field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>

        <div className="auth-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
          />
        </div>

        {mode === 'register' && (
          <div className="auth-field">
            <label>Nickname</label>
            <input
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="Optional"
            />
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Loading...' : mode === 'login' ? 'Login' : 'Register'}
        </button>
      </form>

      <div className="auth-switch">
        {mode === 'login' ? (
          <span>Don't have an account? <button onClick={() => setMode('register')}>Register</button></span>
        ) : (
          <span>Already have an account? <button onClick={() => setMode('login')}>Login</button></span>
        )}
      </div>

      <button className="auth-skip" onClick={onSkip}>
        Continue as Guest →
      </button>

      <p className="auth-hint">
        Guest accounts can play locally. Register to save stats and appear on the leaderboard.
      </p>
    </div>
  );
}

export function UserBadge({ nickname, elo, onLogout }: { nickname: string; elo: number; onLogout: () => void }) {
  return (
    <div className="user-badge">
      <span className="user-name">👤 {nickname}</span>
      <span className="user-elo">⭐ {elo}</span>
      <button className="logout-btn" onClick={onLogout}>Logout</button>
    </div>
  );
}
