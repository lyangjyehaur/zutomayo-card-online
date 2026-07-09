import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Link2, Mail, Save, ShieldCheck, Trophy } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ApiError,
  getAuthConfig,
  getLinkedOAuthIdentities,
  getLogtoAccountCenter,
  getOAuthStartUrl,
  getProfile,
  isLoggedIn,
  unlinkOAuthIdentity,
  updateLogtoPassword,
  updatePassword,
  updateProfile,
  verifyLogtoPassword,
  type LogtoAccountCenterResponse,
  type OAuthProviderId,
  type OAuthIdentity,
  type OAuthProvider,
  type ProfileResponse,
} from '../api/client';
import { UserAvatar } from '../components/UserAvatar';
import { t } from '../i18n';
import {
  Alert,
  AppHeader,
  Badge,
  Button,
  Dialog,
  FormActions,
  FormField,
  Input,
  LoadingState,
  PageShell,
  Panel,
} from '../ui';

function accountErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return t('profile.currentPasswordInvalid');
  if (error instanceof ApiError && error.status === 400) return t('profile.validationError');
  return t('profile.saveError');
}

function accountCenterTarget(url: string): string {
  if (!url) return '';
  try {
    const target = new URL(url);
    if (!target.searchParams.has('redirect')) {
      target.searchParams.set('redirect', `${window.location.origin}/profile`);
    }
    if (!target.searchParams.has('show_success')) {
      target.searchParams.set('show_success', 'true');
    }
    return target.toString();
  } catch {
    return url;
  }
}

function accountValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '-';
}

export function ProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [oauthIdentities, setOauthIdentities] = useState<OAuthIdentity[]>([]);
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [accountLinkingEnabled, setAccountLinkingEnabled] = useState(true);
  const [accountCenterUrl, setAccountCenterUrl] = useState('');
  const [logtoAccountCenter, setLogtoAccountCenter] = useState<LogtoAccountCenterResponse | null>(null);
  const [logtoAccountError, setLogtoAccountError] = useState('');
  const [nickname, setNickname] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [error, setError] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState<OAuthProvider | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProviderId | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    Promise.all([getProfile(), getAuthConfig().catch(() => null), getLinkedOAuthIdentities().catch(() => [])])
      .then(async ([data, authConfig, identities]) => {
        const shouldLoadAccountCenter = Boolean(
          authConfig && !authConfig.localAuthEnabled && !authConfig.accountLinkingEnabled,
        );
        const accountCenter = shouldLoadAccountCenter
          ? await getLogtoAccountCenter().catch((err) => (err instanceof Error ? err : new Error(String(err))))
          : null;
        if (cancelled) return;
        setProfile(data);
        setNickname(data.nickname);
        setOauthProviders(authConfig?.providers || []);
        setLocalAuthEnabled(authConfig?.localAuthEnabled ?? true);
        setAccountLinkingEnabled(authConfig?.accountLinkingEnabled ?? true);
        setAccountCenterUrl(authConfig?.accountCenterUrl || '');
        setOauthIdentities(identities);
        if (accountCenter instanceof Error) {
          setLogtoAccountCenter(null);
          setLogtoAccountError(accountCenter.message);
        } else if (accountCenter) {
          setLogtoAccountCenter(accountCenter);
          setLogtoAccountError('');
        } else {
          setLogtoAccountCenter(null);
          setLogtoAccountError('');
        }
        const oauthStatus = new URLSearchParams(location.search).get('oauth');
        if (oauthStatus === 'linked') setProfileStatus(t('profile.oauthLinked'));
        if (oauthStatus === 'error') setError(t('profile.oauthError'));
      })
      .catch(() => {
        if (!cancelled) setError(t('auth.profileUnavailable'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    setProfileStatus('');
    setPasswordStatus('');
    try {
      const updated = await updateProfile(nickname);
      setProfile(updated);
      setNickname(updated.nickname);
      setProfileStatus(t('profile.nicknameSaved'));
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingPassword(true);
    setError('');
    setProfileStatus('');
    setPasswordStatus('');
    try {
      if (newPassword !== confirmPassword) {
        setError(t('profile.passwordMismatch'));
        return;
      }
      if (localAuthEnabled) {
        await updatePassword(currentPassword, newPassword);
      } else {
        const verification = await verifyLogtoPassword(currentPassword);
        await updateLogtoPassword(newPassword, verification.verificationRecordId);
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatus(t('profile.passwordSaved'));
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  const linkedProviderIds = new Set(oauthIdentities.map((identity) => identity.provider));
  const handleOAuthLink = (provider: OAuthProvider) => {
    window.location.assign(getOAuthStartUrl(provider.provider, 'link', '/profile'));
  };

  const handleOAuthUnlink = async () => {
    if (!unlinkTarget) return;
    setUnlinkingProvider(unlinkTarget.provider);
    setError('');
    setProfileStatus('');
    setPasswordStatus('');
    try {
      await unlinkOAuthIdentity(unlinkTarget.provider);
      setOauthIdentities(await getLinkedOAuthIdentities());
      setProfileStatus(t('profile.oauthUnlinked'));
      setUnlinkTarget(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t('profile.oauthCannotUnlinkLast'));
      } else {
        setError(t('profile.oauthUnlinkError'));
      }
    } finally {
      setUnlinkingProvider(null);
    }
  };

  const accountCenterMode = !localAuthEnabled && !accountLinkingEnabled;
  const logtoIdentityEntries = Object.entries(logtoAccountCenter?.account.identities || {});
  const logtoReconnectProvider = oauthProviders.find((provider) => provider.provider === 'logto' && provider.enabled);

  if (loading) {
    return (
      <PageShell glow={{ color: 'gold', size: 'md' }}>
        <AppHeader title={t('profile.title')} backTo="/" />
        <main className="relative z-[var(--z-dropdown)] grid h-full place-items-center px-4 pt-20">
          <LoadingState label={t('profile.loading')} />
        </main>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell glow={{ color: 'gold', size: 'md' }}>
        <AppHeader title={t('profile.title')} backTo="/" />
        <main className="relative z-[var(--z-dropdown)] grid h-full place-items-center px-4 pt-20">
          <Panel className="grid max-w-md gap-4 text-center" size="lg">
            <h1 className="font-display text-title-md font-bold">{t('profile.loginRequiredTitle')}</h1>
            <p className="text-body-sm text-content-muted">{t('profile.loginRequiredBody')}</p>
            <Button variant="primary" type="button" onClick={() => navigate('/')}>
              {t('common.backToLobby')}
            </Button>
          </Panel>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'md' }}>
      <AppHeader title={t('profile.title')} backTo="/" />
      <main className="relative z-[var(--z-dropdown)] px-4 pb-10 pt-20 md:pt-24">
        <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Panel className="self-start" size="lg">
            <div className="flex items-start gap-4">
              <UserAvatar
                className="size-16 text-2xl"
                nickname={profile.nickname}
                avatarUrl={profile.avatarUrl}
                avatarFallbackUrls={profile.avatarFallbackUrls}
              />
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-title-md font-bold">{profile.nickname}</h1>
                <p className="mt-1 flex items-center gap-2 text-body-sm text-content-muted">
                  <Mail className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{profile.email}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="gold">ELO {profile.elo}</Badge>
                  <Badge tone="jade">
                    {profile.winRate}% {t('auth.winRate')}
                  </Badge>
                </div>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-sm bg-surface-canvas/45 p-3">
                <dt className="font-mono text-minutia uppercase tracking-[var(--tracking-compact)] text-content-dim">
                  ELO
                </dt>
                <dd className="mt-1 font-display text-title-sm font-bold text-accent-primary">{profile.elo}</dd>
              </div>
              <div className="rounded-sm bg-surface-canvas/45 p-3">
                <dt className="font-mono text-minutia uppercase tracking-[var(--tracking-compact)] text-content-dim">
                  {t('auth.wins')}
                </dt>
                <dd className="mt-1 font-display text-title-sm font-bold">{profile.wins}</dd>
              </div>
              <div className="rounded-sm bg-surface-canvas/45 p-3">
                <dt className="font-mono text-minutia uppercase tracking-[var(--tracking-compact)] text-content-dim">
                  {t('auth.matches')}
                </dt>
                <dd className="mt-1 font-display text-title-sm font-bold">{profile.matchCount}</dd>
              </div>
            </dl>
          </Panel>

          <div className="grid gap-4">
            {error && (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            )}
            {profileStatus && <Alert tone="success">{profileStatus}</Alert>}
            {passwordStatus && <Alert tone="success">{passwordStatus}</Alert>}

            <Panel size="lg">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="size-5 text-accent-primary" aria-hidden="true" />
                <h2 className="font-display text-title-sm font-bold">{t('profile.basicInfo')}</h2>
              </div>
              <form className="grid gap-4" onSubmit={handleProfileSubmit}>
                <FormField label={t('auth.nickname')}>
                  <Input
                    value={nickname}
                    autoComplete="nickname"
                    maxLength={30}
                    required
                    onChange={(event) => setNickname(event.target.value)}
                  />
                </FormField>
                <FormActions>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={savingProfile || nickname.trim() === profile.nickname}
                    leftIcon={<Save className="size-4" aria-hidden="true" />}
                  >
                    {savingProfile ? t('auth.submitting') : t('profile.saveNickname')}
                  </Button>
                </FormActions>
              </form>
            </Panel>

            {!accountCenterMode && (
              <Panel size="lg">
                <div className="mb-4 flex items-center gap-2">
                  <Link2 className="size-5 text-accent-primary" aria-hidden="true" />
                  <h2 className="font-display text-title-sm font-bold">{t('profile.oauthTitle')}</h2>
                </div>
                <div className="grid gap-3">
                  {oauthProviders.map((provider) => {
                    const linked = linkedProviderIds.has(provider.provider);
                    const identity = oauthIdentities.find((item) => item.provider === provider.provider);
                    return (
                      <div
                        key={provider.provider}
                        className="flex flex-col gap-3 rounded-sm border border-border-soft bg-surface-canvas/45 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="font-display text-body-lg">{provider.label}</strong>
                            {linked && (
                              <Badge tone="jade" className="gap-1">
                                <CheckCircle2 className="size-3" aria-hidden="true" />
                                {t('profile.oauthLinkedBadge')}
                              </Badge>
                            )}
                            {!provider.enabled && <Badge tone="neutral">{t('profile.oauthNotConfigured')}</Badge>}
                          </div>
                          <p className="mt-1 truncate text-body-sm text-content-muted">
                            {linked
                              ? identity?.email || identity?.displayName || t('profile.oauthLinkedDescription')
                              : t('profile.oauthDescription')}
                          </p>
                        </div>
                        <Button
                          className="shrink-0"
                          variant={linked ? 'danger' : 'primary'}
                          type="button"
                          disabled={!provider.enabled || unlinkingProvider === provider.provider}
                          onClick={() => (linked ? setUnlinkTarget(provider) : handleOAuthLink(provider))}
                        >
                          {linked
                            ? unlinkingProvider === provider.provider
                              ? t('auth.submitting')
                              : t('profile.oauthUnlinkAction')
                            : t('profile.oauthLinkAction')}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            )}

            {localAuthEnabled ? (
              <Panel size="lg">
                <div className="mb-4 flex items-center gap-2">
                  <KeyRound className="size-5 text-accent-primary" aria-hidden="true" />
                  <h2 className="font-display text-title-sm font-bold">{t('profile.password')}</h2>
                </div>
                <form className="grid gap-4" onSubmit={handlePasswordSubmit}>
                  <FormField label={t('profile.currentPassword')}>
                    <Input
                      type="password"
                      value={currentPassword}
                      autoComplete="current-password"
                      required
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </FormField>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label={t('profile.newPassword')}>
                      <Input
                        type="password"
                        value={newPassword}
                        autoComplete="new-password"
                        minLength={6}
                        required
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                    </FormField>
                    <FormField label={t('profile.confirmPassword')}>
                      <Input
                        type="password"
                        value={confirmPassword}
                        autoComplete="new-password"
                        minLength={6}
                        required
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </FormField>
                  </div>
                  <FormActions>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={savingPassword}
                      leftIcon={<Trophy className="size-4" aria-hidden="true" />}
                    >
                      {savingPassword ? t('auth.submitting') : t('profile.savePassword')}
                    </Button>
                  </FormActions>
                </form>
              </Panel>
            ) : (
              <Panel size="lg">
                <div className="mb-3 flex items-center gap-2">
                  <KeyRound className="size-5 text-accent-primary" aria-hidden="true" />
                  <h2 className="font-display text-title-sm font-bold">{t('profile.accountSecurity')}</h2>
                </div>
                <p className="text-body-sm leading-relaxed text-content-muted">
                  {t('profile.accountSecurityIntegrated')}
                </p>
                {logtoAccountError && (
                  <Alert className="mt-4" tone="warning">
                    {t('profile.logtoReconnectRequired')}
                  </Alert>
                )}
                {logtoAccountCenter && (
                  <div className="mt-4 grid gap-3">
                    <div className="grid gap-2 rounded-sm border border-border-soft bg-surface-canvas/45 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-body-sm text-content-muted">{t('profile.logtoPrimaryEmail')}</span>
                        <strong className="truncate text-body-sm">
                          {accountValue(logtoAccountCenter.account.primaryEmail)}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-body-sm text-content-muted">{t('profile.logtoUsername')}</span>
                        <strong className="truncate text-body-sm">
                          {accountValue(logtoAccountCenter.account.username)}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-body-sm text-content-muted">{t('profile.logtoSocialConnections')}</span>
                        <strong className="truncate text-body-sm">
                          {logtoIdentityEntries.length > 0
                            ? logtoIdentityEntries.map(([target]) => target).join(', ')
                            : t('profile.logtoNoSocialConnections')}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}
                <form className="mt-5 grid gap-4" onSubmit={handlePasswordSubmit}>
                  <FormField label={t('profile.currentPassword')}>
                    <Input
                      type="password"
                      value={currentPassword}
                      autoComplete="current-password"
                      required
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </FormField>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label={t('profile.newPassword')}>
                      <Input
                        type="password"
                        value={newPassword}
                        autoComplete="new-password"
                        minLength={6}
                        required
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                    </FormField>
                    <FormField label={t('profile.confirmPassword')}>
                      <Input
                        type="password"
                        value={confirmPassword}
                        autoComplete="new-password"
                        minLength={6}
                        required
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </FormField>
                  </div>
                  <FormActions>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={savingPassword || Boolean(logtoAccountError)}
                      leftIcon={<ShieldCheck className="size-4" aria-hidden="true" />}
                    >
                      {savingPassword ? t('auth.submitting') : t('profile.savePassword')}
                    </Button>
                    {logtoReconnectProvider && logtoAccountError && (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          window.location.assign(getOAuthStartUrl(logtoReconnectProvider.provider, 'login', '/profile'))
                        }
                      >
                        {t('profile.logtoReconnectAction')}
                      </Button>
                    )}
                  </FormActions>
                </form>
                {accountCenterUrl && (
                  <FormActions className="mt-4">
                    <Button
                      variant="secondary"
                      type="button"
                      leftIcon={<ExternalLink className="size-4" aria-hidden="true" />}
                      onClick={() =>
                        window.open(accountCenterTarget(accountCenterUrl), '_blank', 'noopener,noreferrer')
                      }
                    >
                      {t('profile.manageAccountSecurity')}
                    </Button>
                  </FormActions>
                )}
              </Panel>
            )}
          </div>
        </div>
      </main>
      <Dialog
        open={Boolean(unlinkTarget)}
        onOpenChange={(open) => {
          if (!open && !unlinkingProvider) setUnlinkTarget(null);
        }}
        title={t('profile.oauthUnlinkTitle')}
        description={t('profile.oauthUnlinkConfirm')}
        footer={
          <>
            <Button variant="secondary" disabled={Boolean(unlinkingProvider)} onClick={() => setUnlinkTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={Boolean(unlinkingProvider)} onClick={handleOAuthUnlink}>
              {unlinkingProvider ? t('auth.submitting') : t('profile.oauthUnlinkAction')}
            </Button>
          </>
        }
      />
    </PageShell>
  );
}
