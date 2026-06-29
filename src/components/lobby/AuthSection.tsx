import { useEffect, useState } from 'react';
import { useLogto, type UserInfoResponse } from '@logto/react';
import { LogIn, LogOut } from 'lucide-react';
import { ApiError, getProfile, logout as logoutAccount, syncLogtoProfile } from '../../api/client';
import { isLogtoConfigured, logtoPostLogoutRedirectUri, logtoRedirectUri } from '../../auth/logto';
import { t } from '../../i18n';

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
  return t('auth.invalidCredentials');
}

function profileStats(user: AuthUser): { matchCount: number; wins: number; winRate: number } {
  const matchCount = user.matchCount ?? 0;
  const wins = user.wins ?? 0;
  const winRate = user.winRate ?? (matchCount > 0 ? Math.round((wins / matchCount) * 100) : 0);
  return { matchCount, wins, winRate };
}

function displayNameFromUserInfo(userInfo: UserInfoResponse | undefined): string | null {
  return userInfo?.name ?? userInfo?.username ?? userInfo?.email?.split('@')[0] ?? null;
}

function ProfileCard({
  user,
  status,
  onLogout,
}: {
  user: AuthUser;
  status: string;
  onLogout: () => void | Promise<void>;
}) {
  const stats = profileStats(user);
  return (
    <section
      className="rounded-sm bg-lacquer p-2 ring-1 ring-bone/10 sm:p-4"
      aria-label={user.nickname || t('auth.guest')}
    >
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
            onClick={onLogout}
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

function LogtoAuthSection({ onAuthChanged }: { onAuthChanged: () => void | Promise<void> }) {
  const { error: logtoError, fetchUserInfo, isAuthenticated, isLoading, signIn, signOut } = useLogto();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setUser(null);
      setStatus('');
      return;
    }

    let cancelled = false;
    setSubmitting(true);
    setError('');

    const loadProfile = async () => {
      try {
        const userInfo = await fetchUserInfo();
        const profile = userInfo
          ? await syncLogtoProfile({
              email: userInfo.email,
              nickname: displayNameFromUserInfo(userInfo),
            })
          : await getProfile();
        if (cancelled) return;
        setUser(profile);
        setStatus(t('auth.loginSuccess'));
        void onAuthChanged();
      } catch (err) {
        if (cancelled) return;
        setError(authErrorMessage(err));
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [fetchUserInfo, isAuthenticated, onAuthChanged]);

  const handleLogin = async () => {
    setSubmitting(true);
    setError('');
    try {
      await signIn(logtoRedirectUri());
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (typeof window !== 'undefined' && !window.confirm(t('auth.logoutConfirm'))) return;
    setSubmitting(true);
    setError('');
    setStatus('');
    logoutAccount();
    setUser(null);
    void onAuthChanged();
    try {
      await signOut(logtoPostLogoutRedirectUri());
    } catch (err) {
      setError(authErrorMessage(err));
      setSubmitting(false);
    }
  };

  if (user) return <ProfileCard user={user} status={status} onLogout={handleLogout} />;

  return (
    <section className="rounded-sm bg-lacquer p-2 ring-1 ring-bone/10 sm:p-4">
      <div className="flex flex-col gap-3">
        <button
          className="whitespace-nowrap border border-bone/20 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.12em] text-bone/60 transition hover:bg-bone/5 disabled:opacity-50 sm:px-4 sm:text-[10px] sm:tracking-[0.3em]"
          type="button"
          disabled={isLoading || submitting}
          onClick={handleLogin}
        >
          <span className="inline-flex items-center gap-1.5">
            <LogIn strokeWidth={1.25} className="size-3" />
            {t('auth.login')}
          </span>
        </button>
        {(error || logtoError) && (
          <p className="text-[10px] text-vermilion/80">{error || authErrorMessage(logtoError)}</p>
        )}
        {status && <p className="font-mono text-[10px] text-gold/70">{status}</p>}
      </div>
    </section>
  );
}

function MissingLogtoConfigSection() {
  return (
    <section className="rounded-sm bg-lacquer p-2 ring-1 ring-bone/10 sm:p-4">
      <p className="text-[10px] text-vermilion/80">{t('auth.serviceUnavailable')}</p>
    </section>
  );
}

export function AuthSection({ onAuthChanged }: { onAuthChanged: () => void | Promise<void> }) {
  if (!isLogtoConfigured) return <MissingLogtoConfigSection />;
  return <LogtoAuthSection onAuthChanged={onAuthChanged} />;
}
