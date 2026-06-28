import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, getProfile, isLoggedIn, login, logout as logoutAccount, register } from '../../api/client';
import { t } from '../../i18n';

export type AuthMode = 'login' | 'register';
export type AuthUser = {
  id: string;
  email: string;
  nickname: string;
  elo: number;
  matchCount?: number;
  wins?: number;
  winRate?: number;
};

function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    error instanceof TypeError ||
    (error instanceof ApiError && error.status !== undefined && error.status >= 500) ||
    message.includes('fetch') ||
    message.includes('network')
  ) {
    return t('auth.serviceUnavailable');
  }
  if (message.includes('exists') || message.includes('registered')) return t('auth.emailExists');
  return t('auth.invalidCredentials');
}

function profileStats(user: AuthUser): { matchCount: number; wins: number; winRate: number } {
  const matchCount = user.matchCount ?? 0;
  const wins = user.wins ?? 0;
  const winRate = user.winRate ?? (matchCount > 0 ? Math.round((wins / matchCount) * 100) : 0);
  return { matchCount, wins, winRate };
}

export function AuthSection({ onAuthChanged }: { onAuthChanged: () => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) return;
    let cancelled = false;
    getProfile()
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) logoutAccount();
        if (!cancelled) setError(t('auth.profileUnavailable'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setEmail('');
    setNickname('');
    setPassword('');
    setError('');
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setStatus('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setStatus('');

    try {
      const authUser = mode === 'login' ? await login(email, password) : await register(email, password, nickname);
      let nextUser = authUser as AuthUser;
      try {
        nextUser = await getProfile();
      } catch {
        // Login/register responses are enough to keep guest fallback and auth state usable.
      }
      setUser(nextUser);
      setStatus(mode === 'login' ? t('auth.loginSuccess') : t('auth.registerSuccess'));
      setExpanded(false);
      resetForm();
      void onAuthChanged();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    if (typeof window !== 'undefined' && !window.confirm(t('auth.logoutConfirm'))) return;
    logoutAccount();
    setUser(null);
    setStatus('');
    setExpanded(false);
    resetForm();
    void onAuthChanged();
  };

  if (user) {
    const stats = profileStats(user);
    return (
      <section className="card bg-base-200 shadow-xl" aria-label={user.nickname || t('auth.guest')}>
        <div className="card-body gap-3 p-4">
          <div>
            <strong>{user.nickname || t('auth.guest')}</strong>
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="badge badge-primary">ELO {user.elo}</span>
              <span className="badge badge-success">
                {t('auth.winRate')} {stats.winRate}%
              </span>
              <span className="badge badge-warning">
                {t('auth.wins')} {stats.wins}/{stats.matchCount}
              </span>
            </div>
          </div>
          <div className="card-actions items-center">
            <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>
              {t('auth.logout')}
            </button>
            {status && <span className="badge badge-success">{status}</span>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card bg-base-200 shadow-xl">
      <div className="card-body gap-3 p-4">
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t('auth.login')} / {t('auth.register')}
        </button>
        {!expanded && error && <div className="alert alert-error">{error}</div>}

        {expanded && (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="join" role="tablist" aria-label={`${t('auth.login')} / ${t('auth.register')}`}>
              <button
                className={`btn btn-sm join-item ${mode === 'login' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => switchMode('login')}
              >
                {t('auth.login')}
              </button>
              <button
                className={`btn btn-sm join-item ${mode === 'register' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => switchMode('register')}
              >
                {t('auth.register')}
              </button>
            </div>
            <label className="form-control">
              <span>{t('auth.email')}</span>
              <input
                className="input input-bordered"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode === 'register' && (
              <label className="form-control">
                <span>{t('auth.nickname')}</span>
                <input
                  className="input input-bordered"
                  type="text"
                  value={nickname}
                  autoComplete="nickname"
                  required
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label className="form-control">
              <span>{t('auth.password')}</span>
              <input
                className="input input-bordered"
                type="password"
                value={password}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
