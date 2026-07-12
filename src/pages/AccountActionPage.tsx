import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, MailCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { confirmEmailVerification, confirmPasswordReset, requestPasswordReset } from '../api/client';
import { t } from '../i18n';
import { Alert, AppHeader, Button, FormActions, FormField, Input, LoadingState, PageShell, Panel } from '../ui';

function AccountActionLayout({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <PageShell variant="status" glow={{ color: 'gold', size: 'md' }}>
      <AppHeader title={title} backTo="/" />
      <div className="relative z-[var(--z-dropdown)] grid min-h-dvh place-items-center px-4 py-24">
        <Panel className="grid w-full max-w-md gap-5" size="lg">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent-primary/10 text-accent-primary">
              {icon}
            </span>
            <h1 className="font-display text-title-md font-bold">{title}</h1>
          </div>
          {children}
        </Panel>
      </div>
    </PageShell>
  );
}

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState<'loading' | 'success' | 'error'>(token ? 'loading' : 'error');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    confirmEmailVerification(token)
      .then(() => {
        if (!cancelled) setState('success');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AccountActionLayout
      title={t('accountAction.verifyTitle')}
      icon={<MailCheck className="size-5" aria-hidden="true" />}
    >
      {state === 'loading' && <LoadingState label={t('accountAction.verifyPending')} />}
      {state === 'success' && <Alert tone="success">{t('accountAction.verifySuccess')}</Alert>}
      {state === 'error' && <Alert tone="danger">{t('accountAction.verifyInvalid')}</Alert>}
      {state !== 'loading' && (
        <FormActions>
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </Button>
        </FormActions>
      )}
    </AccountActionLayout>
  );
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      await requestPasswordReset(email);
      setSuccess(true);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccountActionLayout
      title={t('accountAction.forgotTitle')}
      icon={<KeyRound className="size-5" aria-hidden="true" />}
    >
      <p className="text-body-sm leading-relaxed text-content-muted">{t('accountAction.forgotBody')}</p>
      {success ? (
        <>
          <Alert tone="success">{t('accountAction.forgotSuccess')}</Alert>
          <FormActions>
            <Button variant="primary" onClick={() => navigate('/')}>
              {t('common.backToLobby')}
            </Button>
          </FormActions>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <FormField label={t('auth.email')}>
            <Input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          {error && <Alert tone="danger">{t('auth.serviceUnavailable')}</Alert>}
          <FormActions>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? t('auth.submitting') : t('accountAction.forgotAction')}
            </Button>
          </FormActions>
        </form>
      )}
    </AccountActionLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(token ? '' : t('accountAction.resetInvalid'));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError(t('accountAction.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(token, newPassword);
      setSuccess(true);
    } catch {
      setError(t('accountAction.resetInvalid'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccountActionLayout
      title={t('accountAction.resetTitle')}
      icon={<KeyRound className="size-5" aria-hidden="true" />}
    >
      <p className="text-body-sm leading-relaxed text-content-muted">{t('accountAction.resetBody')}</p>
      {success ? (
        <>
          <Alert tone="success">{t('accountAction.resetSuccess')}</Alert>
          <FormActions>
            <Button variant="primary" onClick={() => navigate('/')}>
              {t('auth.login')}
            </Button>
          </FormActions>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <FormField label={t('profile.newPassword')}>
            <Input
              type="password"
              value={newPassword}
              autoComplete="new-password"
              minLength={12}
              required
              disabled={!token}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </FormField>
          <FormField label={t('accountAction.confirmPassword')}>
            <Input
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              minLength={12}
              required
              disabled={!token}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </FormField>
          {error && <Alert tone="danger">{error}</Alert>}
          <FormActions>
            <Button variant="primary" type="submit" disabled={submitting || !token}>
              {submitting ? t('auth.submitting') : t('accountAction.resetAction')}
            </Button>
          </FormActions>
        </form>
      )}
    </AccountActionLayout>
  );
}
