import { useEffect, useState, type FormEvent } from 'react';
import { LogOut, AlertCircle } from 'lucide-react';
import { ApiError, getProfile, isLoggedIn, login, logout as logoutAccount, register } from '../../api/client';
import { getRegistrationNickname } from '../../anonymousIdentity';
import { t } from '../../i18n';
import { Alert, Button, Dialog, Input, SegmentedControl } from '../../ui';

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

export const PUBLIC_AUTH_ENTRYPOINTS_ENABLED = true;

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
  const [logoutPromptOpen, setLogoutPromptOpen] = useState(false);

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

  const confirmLogout = () => {
    logoutAccount();
    setUser(null);
    setStatus('');
    setExpanded(false);
    resetForm();
    setLogoutPromptOpen(false);
    void onAuthChanged();
  };

  const handleLogout = () => {
    setLogoutPromptOpen(true);
  };

  if (user) {
    const stats = profileStats(user);
    return (
      <>
        <section
          className="rounded-sm bg-gradient-to-br from-surface-base via-surface-base to-surface-canvas p-3 ring-1 ring-content-primary/10 shadow-floating md:p-5"
          aria-label={user.nickname || t('auth.guest')}
        >
          <div className="flex flex-col gap-4">
            {/* 用戶信息頭部 */}
            <div className="flex items-center gap-3">
              {/* 用戶頭像（首字母） */}
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-primary/20 to-accent-action/20 ring-1 ring-accent-primary/30">
                <span className="font-display text-lg text-accent-primary">{user.nickname?.[0]?.toUpperCase() || 'G'}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-bold leading-none text-content-primary">
                  {user.nickname || t('auth.guest')}
                </p>
                <p className="mt-1 font-mono text-caption text-accent-primary/60">ELO {user.elo}</p>
              </div>
            </div>

            {/* 戰績統計（視覺化進度條） */}
            <div className="space-y-2">
              <div className="flex justify-between text-caption">
                <span className="text-content-primary/40">{t('auth.winRate')}</span>
                <span className="font-mono text-accent-primary/70">{stats.winRate}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-content-primary/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-primary to-accent-action transition-all duration-[var(--motion-duration-page)]"
                  style={{ width: `${stats.winRate}%` }}
                />
              </div>
              <div className="flex justify-between text-caption text-content-primary/40">
                <span>
                  {t('auth.wins')} {stats.wins}
                </span>
                <span>
                  {stats.matchCount} {t('auth.matches')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-content-primary/10 pt-3">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                leftIcon={<LogOut strokeWidth={1.25} className="size-3" aria-hidden="true" />}
                onClick={handleLogout}
              >
                {t('auth.logout')}
              </Button>
              {status && <span className="font-mono text-caption text-accent-primary/70">{status}</span>}
            </div>
          </div>
        </section>
        <Dialog
          open={logoutPromptOpen}
          onOpenChange={setLogoutPromptOpen}
          title={t('auth.logout')}
          description={t('auth.logoutConfirm')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLogoutPromptOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={confirmLogout}>
                {t('auth.logout')}
              </Button>
            </>
          }
        />
      </>
    );
  }

  return (
    <section className="max-w-md rounded-sm bg-gradient-to-br from-surface-base via-surface-base to-surface-canvas p-3 ring-1 ring-content-primary/10 shadow-floating md:p-5">
      <div className="flex flex-col gap-3">
        <Button
          className="whitespace-nowrap"
          variant="secondary"
          size="md"
          type="button"
          aria-expanded={expanded}
          aria-disabled={!PUBLIC_AUTH_ENTRYPOINTS_ENABLED}
          disabled={!PUBLIC_AUTH_ENTRYPOINTS_ENABLED}
          onClick={() => {
            if (!PUBLIC_AUTH_ENTRYPOINTS_ENABLED) return;
            setExpanded((value) => !value);
          }}
        >
          {t('auth.login')} / {t('auth.register')}
        </Button>
        {!expanded && error && (
          <Alert tone="danger" role="alert" aria-live="polite" className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-3 shrink-0 text-accent-action/80" />
            <p className="text-caption leading-relaxed text-accent-action/90">{error}</p>
          </Alert>
        )}
        {!expanded && status && <p className="font-mono text-caption text-accent-primary/70">{status}</p>}

        {expanded && (
          <form
            className="flex flex-col gap-3 animate-in slide-in-from-top-4 fade-in duration-[var(--motion-duration-slow)]"
            onSubmit={handleSubmit}
            aria-label={mode === 'login' ? t('auth.loginForm') : t('auth.registerForm')}
          >
            <SegmentedControl
              className="border-b border-content-primary/10 pb-2"
              behavior="tabs"
              size="sm"
              ariaLabel={`${t('auth.login')} / ${t('auth.register')}`}
              options={[
                { value: 'login', label: t('auth.login') },
                { value: 'register', label: t('auth.register') },
              ]}
              value={mode}
              onChange={switchMode}
            />
            <label className="group flex flex-col gap-1">
              <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40 transition-colors duration-[var(--motion-duration-base)] group-focus-within:text-accent-primary/70">
                {t('auth.email')}
              </span>
              <Input
                className="min-h-11"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode === 'register' && (
              <label className="group flex flex-col gap-1">
                <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40 transition-colors duration-[var(--motion-duration-base)] group-focus-within:text-accent-primary/70">
                  {t('auth.nickname')}
                </span>
                <Input
                  className="min-h-11"
                  type="text"
                  value={nickname}
                  autoComplete="nickname"
                  required
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label className="group flex flex-col gap-1">
              <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40 transition-colors duration-[var(--motion-duration-base)] group-focus-within:text-accent-primary/70">
                {t('auth.password')}
              </span>
              <Input
                className="min-h-11"
                type="password"
                value={password}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && (
              <Alert
                tone="danger"
                role="alert"
                aria-live="polite"
                className="flex items-start gap-2 animate-in slide-in-from-top-2 fade-in duration-[var(--motion-duration-slow)]"
              >
                <AlertCircle className="mt-0.5 size-3 shrink-0 text-accent-action/80" />
                <p className="text-caption leading-relaxed text-accent-action/90">{error}</p>
              </Alert>
            )}
            <Button
              className="relative overflow-hidden"
              variant="primary"
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              aria-label={submitting ? t('auth.submitting') : undefined}
            >
              {submitting && (
                <>
                  <span className="absolute inset-0 animate-pulse bg-accent-primary/10" />
                  <span className="absolute inset-x-0 bottom-0 h-0.5 animate-[shimmer_1.5s_ease-in-out_infinite] bg-accent-primary/40" />
                </>
              )}
              <span className={submitting ? 'opacity-50' : ''}>
                {submitting ? t('auth.submitting') : mode === 'login' ? t('auth.login') : t('auth.register')}
              </span>
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
