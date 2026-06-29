import { useEffect, useState, type FormEvent } from 'react';
import { LogOut } from 'lucide-react';
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
      <section className="rounded-sm bg-lacquer p-2 ring-1 ring-bone/10 sm:p-4" aria-label={user.nickname || t('auth.guest')}>
        <div className="flex flex-col gap-3">
          <p className="font-display text-sm italic text-bone">{user.nickname || t('auth.guest')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono text-[10px] text-gold/70">ELO {user.elo}</span>
            <span className="font-mono text-[10px] text-bone/40">
              {t('auth.winRate')} {stats.winRate}%
            </span>
            <span className="font-mono text-[10px] text-bone/40">
              {t('auth.wins')} {stats.wins}/{stats.matchCount}
            </span>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              className="border border-bone/20 px-2.5 py-1 text-[9px] uppercase tracking-[0.12em] text-bone/60 transition hover:bg-bone/5 sm:px-3 sm:text-[10px] sm:tracking-[0.3em]"
              type="button"
              onClick={handleLogout}
            >
              <span className="inline-flex items-center gap-1.5">
                <LogOut strokeWidth={1.25} className="size-3" />
                {t('auth.logout')}
              </span>
            </button>
            {status && <span className="font-mono text-[10px] text-gold/70">{status}</span>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-sm bg-lacquer p-2 ring-1 ring-bone/10 sm:p-4">
      <div className="flex flex-col gap-3">
        <button
          className="whitespace-nowrap border border-bone/20 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.12em] text-bone/60 transition hover:bg-bone/5 sm:px-4 sm:text-[10px] sm:tracking-[0.3em]"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="sm:hidden">{t('auth.login')}</span>
          <span className="hidden sm:inline">
            {t('auth.login')} / {t('auth.register')}
          </span>
        </button>
        {!expanded && error && <p className="text-[10px] text-vermilion/80">{error}</p>}
        {!expanded && status && <p className="font-mono text-[10px] text-gold/70">{status}</p>}

        {expanded && (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div
              className="flex gap-4 border-b border-bone/10 pb-2"
              role="tablist"
              aria-label={`${t('auth.login')} / ${t('auth.register')}`}
            >
              <button
                className={`text-[10px] uppercase tracking-[0.3em] transition ${mode === 'login' ? 'text-gold' : 'text-bone/40 hover:text-bone/60'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => switchMode('login')}
              >
                {t('auth.login')}
              </button>
              <button
                className={`text-[10px] uppercase tracking-[0.3em] transition ${mode === 'register' ? 'text-gold' : 'text-bone/40 hover:text-bone/60'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => switchMode('register')}
              >
                {t('auth.register')}
              </button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('auth.email')}</span>
              <input
                className="border border-bone/10 bg-lacquer-deep px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:outline-none focus:ring-1 focus:ring-gold/40"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode === 'register' && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('auth.nickname')}</span>
                <input
                  className="border border-bone/10 bg-lacquer-deep px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:outline-none focus:ring-1 focus:ring-gold/40"
                  type="text"
                  value={nickname}
                  autoComplete="nickname"
                  required
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('auth.password')}</span>
              <input
                className="border border-bone/10 bg-lacquer-deep px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:outline-none focus:ring-1 focus:ring-gold/40"
                type="password"
                value={password}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="text-[10px] text-vermilion/80">{error}</p>}
            <button
              className="bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition active:scale-95 disabled:opacity-50"
              type="submit"
              disabled={submitting}
            >
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
