/* global module */

function accountActionPath(actionType) {
  if (actionType === 'verify_email') return '/verify-email';
  if (actionType === 'reset_password') return '/reset-password';
  throw new Error('Unsupported account action');
}

function createActionUrl({ publicBaseUrl, actionType, token }) {
  const base = String(publicBaseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('PUBLIC_BASE_URL is required for account email delivery');
  const url = new URL(accountActionPath(actionType), `${base}/`);
  url.searchParams.set('token', String(token || ''));
  return url.toString();
}

async function deliverAccountAction({ env = process.env, fetchImpl = fetch, actionType, email, token, expiresIn }) {
  const webhookUrl = String(env.ACCOUNT_EMAIL_WEBHOOK_URL || '');
  const webhookSecret = String(env.ACCOUNT_EMAIL_WEBHOOK_SECRET || '');
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || env.OAUTH_PUBLIC_BASE_URL || '');
  if (!webhookUrl || !webhookSecret || !publicBaseUrl) {
    return {
      ok: false,
      status: 503,
      error: 'Account email delivery is not configured',
    };
  }

  const actionUrl = createActionUrl({
    publicBaseUrl,
    actionType,
    token,
  });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookSecret}` };
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ actionType, email, actionUrl, expiresIn }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return { ok: false, status: 502, error: 'Account email delivery failed' };
  }
  return { ok: true };
}

module.exports = {
  accountActionPath,
  createActionUrl,
  deliverAccountAction,
};
