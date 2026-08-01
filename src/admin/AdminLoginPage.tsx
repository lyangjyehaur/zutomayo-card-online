import { useEffect, useState, type FormEvent } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useLogin } from '@refinedev/core';
import { Link } from 'react-router-dom';
import { Alert, Button, FormField, Input, LoadingState, PageShell, Panel } from '../ui';
import { ADMIN_TOKEN_KEY } from './providers';

export function AdminLoginPage() {
  const { mutate: login, isPending } = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [checkingAccount, setCheckingAccount] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_TOKEN_KEY)) {
      setCheckingAccount(false);
      return;
    }
    let cancelled = false;
    login(
      { accountSession: true },
      {
        onError: (reason) => {
          if (cancelled) return;
          const status = Number((reason as { statusCode?: unknown }).statusCode);
          if (![401, 403, 404].includes(status)) {
            setError(reason instanceof Error ? reason.message : '無法驗證已登入帳號');
          }
        },
        onSettled: () => {
          if (!cancelled) setCheckingAccount(false);
        },
      },
    );
    return () => {
      cancelled = true;
    };
  }, [login]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    login(
      { username: username.trim(), password, totpCode },
      { onError: (reason) => setError(reason instanceof Error ? reason.message : '登入失敗') },
    );
  };

  if (checkingAccount) {
    return (
      <PageShell className="flex min-h-screen items-center justify-center p-4">
        <LoadingState label="驗證管理員身分中…" />
      </PageShell>
    );
  }

  return (
    <PageShell className="flex min-h-screen items-center justify-center p-4">
      <Panel className="w-full max-w-md" size="lg">
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <span className="flex size-10 items-center justify-center rounded-sm bg-accent-primary/15 text-accent-primary">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <h1 className="font-display text-2xl font-bold">管理後台</h1>
            <p className="text-body-sm text-content-muted">使用管理員帳密與 TOTP 驗證碼登入。</p>
          </div>
          <FormField label="管理員帳號" htmlFor="admin-username">
            <Input
              id="admin-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={isPending}
            />
          </FormField>
          <FormField label="管理員密碼" htmlFor="admin-password">
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isPending}
            />
          </FormField>
          <FormField label="六位數驗證碼" htmlFor="admin-totp">
            <Input
              id="admin-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={isPending}
            />
          </FormField>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={isPending || !username.trim() || !password || totpCode.length !== 6}>
            <LogIn className="size-4" aria-hidden="true" />
            {isPending ? '登入中…' : '登入'}
          </Button>
          <Link className="text-center text-body-sm text-content-muted hover:text-content-primary" to="/">
            返回首頁
          </Link>
        </form>
      </Panel>
    </PageShell>
  );
}
