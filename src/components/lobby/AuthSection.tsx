import { useEffect, useState, type FormEvent } from 'react';
import { LogOut, AlertCircle } from 'lucide-react';
import { ApiError, getProfile, isLoggedIn, login, logout as logoutAccount, register } from '../../api/client';
import { getRegistrationNickname } from '../../anonymousIdentity';
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

export const PUBLIC_AUTH_ENTRYPOINTS_ENABLED = false;

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
    if (nextMode === 'register' && !nickname) setNickname(getRegistrationNickname());
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
      <section
        className="rounded-sm bg-gradient-to-br from-lacquer via-lacquer to-lacquer-deep p-3 ring-1 ring-bone/10 shadow-[0_8px_32px_-8px] shadow-black/40 sm:p-4 md:p-5"
        aria-label={user.nickname || t('auth.guest')}
      >
        <div className="flex flex-col gap-4">
          {/* 用戶信息頭部 */}
          <div className="flex items-center gap-3">
            {/* 用戶頭像（首字母） */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold/20 to-vermilion/20 ring-1 ring-gold/30">
              <span className="font-display text-lg text-gold">{user.nickname?.[0]?.toUpperCase() || 'G'}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base italic leading-none text-bone">{user.nickname || t('auth.guest')}</p>
              <p className="mt-1 font-mono text-[10px] text-gold/60">ELO {user.elo}</p>
            </div>
          </div>

          {/* 戰績統計（視覺化進度條） */}
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-bone/40">{t('auth.winRate')}</span>
              <span className="font-mono text-gold/70">{stats.winRate}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-bone/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold to-vermilion transition-all duration-500"
                style={{ width: `${stats.winRate}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-bone/40">
              <span>
                {t('auth.wins')} {stats.wins}
              </span>
              <span>
                {stats.matchCount} {t('auth.matches')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-bone/10 pt-3">
            <button
              className="inline-flex items-center gap-1.5 border border-bone/20 px-2.5 py-1 text-[9px] uppercase tracking-[0.12em] text-bone/60 transition hover:bg-bone/5 focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer sm:px-3 sm:text-[10px] sm:tracking-[0.3em]"
              type="button"
              onClick={handleLogout}
            >
              <LogOut strokeWidth={1.25} className="size-3" />
              {t('auth.logout')}
            </button>
            {status && <span className="font-mono text-[10px] text-gold/70">{status}</span>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-sm rounded-sm bg-gradient-to-br from-lacquer via-lacquer to-lacquer-deep p-3 ring-1 ring-bone/10 shadow-[0_8px_32px_-8px] shadow-black/40 sm:max-w-md sm:p-4 md:p-5">
      <div className="flex flex-col gap-3">
        <button
          className={`whitespace-nowrap border border-bone/20 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.12em] text-bone/60 transition focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer sm:px-4 sm:text-[10px] sm:tracking-[0.3em] ${
            PUBLIC_AUTH_ENTRYPOINTS_ENABLED ? 'hover:bg-bone/5' : 'cursor-not-allowed opacity-45'
          }`}
          type="button"
          aria-expanded={expanded}
          aria-disabled={!PUBLIC_AUTH_ENTRYPOINTS_ENABLED}
          disabled={!PUBLIC_AUTH_ENTRYPOINTS_ENABLED}
          onClick={() => {
            if (!PUBLIC_AUTH_ENTRYPOINTS_ENABLED) return;
            setExpanded((value) => !value);
          }}
        >
          <span className="sm:hidden">{t('auth.login')}</span>
          <span className="hidden sm:inline">
            {t('auth.login')} / {t('auth.register')}
          </span>
        </button>
        {!expanded && error && (
          <div
            className="flex items-start gap-2 rounded-sm border-l-2 border-vermilion/50 bg-vermilion/10 px-3 py-2"
            role="alert"
            aria-live="polite"
          >
            <AlertCircle className="mt-0.5 size-3 shrink-0 text-vermilion/80" />
            <p className="text-[10px] leading-relaxed text-vermilion/90">{error}</p>
          </div>
        )}
        {!expanded && status && <p className="font-mono text-[10px] text-gold/70">{status}</p>}

        {expanded && (
          <form
            className="flex flex-col gap-3 animate-in slide-in-from-top-4 fade-in duration-300"
            onSubmit={handleSubmit}
            aria-label={mode === 'login' ? t('auth.loginForm') : t('auth.registerForm')}
          >
            <div
              className="relative flex gap-4 border-b border-bone/10 pb-2"
              role="tablist"
              aria-label={`${t('auth.login')} / ${t('auth.register')}`}
            >
              <button
                className={`text-[10px] uppercase tracking-[0.3em] transition focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer ${mode === 'login' ? 'text-gold' : 'text-bone/40 hover:text-bone/60'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => switchMode('login')}
              >
                {t('auth.login')}
              </button>
              <button
                className={`text-[10px] uppercase tracking-[0.3em] transition focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer ${mode === 'register' ? 'text-gold' : 'text-bone/40 hover:text-bone/60'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => switchMode('register')}
              >
                {t('auth.register')}
              </button>
              {/* 滑動指示條 */}
              <span
                className={`absolute bottom-0 h-0.5 bg-gold transition-all duration-300 ${mode === 'login' ? 'left-0 w-[60px]' : 'left-[76px] w-[80px]'}`}
              />
            </div>
            <label className="group flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40 transition-colors duration-200 group-focus-within:text-gold/70">
                {t('auth.email')}
              </span>
              <input
                className="border border-bone/10 bg-gradient-to-b from-lacquer-deep/80 to-lacquer-deep px-3 py-2 text-sm text-bone shadow-inner shadow-black/20 placeholder:text-bone/30 transition-all duration-300 focus:border-gold/30 focus:shadow-[0_0_16px_-4px] focus:shadow-gold/20 focus:outline-none focus:ring-2 focus:ring-gold/40"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode === 'register' && (
              <label className="group flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40 transition-colors duration-200 group-focus-within:text-gold/70">
                  {t('auth.nickname')}
                </span>
                <input
                  className="border border-bone/10 bg-gradient-to-b from-lacquer-deep/80 to-lacquer-deep px-3 py-2 text-sm text-bone shadow-inner shadow-black/20 placeholder:text-bone/30 transition-all duration-300 focus:border-gold/30 focus:shadow-[0_0_16px_-4px] focus:shadow-gold/20 focus:outline-none focus:ring-2 focus:ring-gold/40"
                  type="text"
                  value={nickname}
                  autoComplete="nickname"
                  required
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label className="group flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40 transition-colors duration-200 group-focus-within:text-gold/70">
                {t('auth.password')}
              </span>
              <input
                className="border border-bone/10 bg-gradient-to-b from-lacquer-deep/80 to-lacquer-deep px-3 py-2 text-sm text-bone shadow-inner shadow-black/20 placeholder:text-bone/30 transition-all duration-300 focus:border-gold/30 focus:shadow-[0_0_16px_-4px] focus:shadow-gold/20 focus:outline-none focus:ring-2 focus:ring-gold/40"
                type="password"
                value={password}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && (
              <div
                className="flex items-start gap-2 animate-in slide-in-from-top-2 fade-in rounded-sm border-l-2 border-vermilion/50 bg-vermilion/10 px-3 py-2 duration-300"
                role="alert"
                aria-live="polite"
              >
                <AlertCircle className="mt-0.5 size-3 shrink-0 text-vermilion/80" />
                <p className="text-[10px] leading-relaxed text-vermilion/90">{error}</p>
              </div>
            )}
            <button
              className="relative overflow-hidden bg-gradient-to-b from-bone to-bone/95 px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer shadow-[0_4px_12px_-4px] shadow-bone/30 transition-all duration-300 hover:from-gold/90 hover:to-gold/80 hover:shadow-[0_6px_20px_-4px] hover:shadow-gold/40 focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer active:scale-[0.98] disabled:opacity-50"
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              aria-label={submitting ? t('auth.submitting') : undefined}
            >
              {submitting && (
                <>
                  <span className="absolute inset-0 animate-pulse bg-gold/10" />
                  <span className="absolute inset-x-0 bottom-0 h-0.5 animate-[shimmer_1.5s_ease-in-out_infinite] bg-gold/40" />
                </>
              )}
              <span className={submitting ? 'opacity-50' : ''}>
                {submitting ? t('auth.submitting') : mode === 'login' ? t('auth.login') : t('auth.register')}
              </span>
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
