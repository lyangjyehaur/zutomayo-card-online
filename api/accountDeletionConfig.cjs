/* global module */

const LOGTO_ACCOUNT_DELETION_SCOPE = 'delete:users';

function accountDeletionRecoveryEnabled(env = process.env) {
  return (
    String(env.ACCOUNT_DELETION_RECOVERY_ENABLED || 'true')
      .trim()
      .toLowerCase() !== 'false'
  );
}

function logtoBaseUrl(env) {
  const endpoint = String(env.LOGTO_ENDPOINT || '')
    .trim()
    .replace(/\/$/, '');
  if (endpoint) return endpoint;
  return String(env.LOGTO_ISSUER || '')
    .trim()
    .replace(/\/oidc\/?$/, '')
    .replace(/\/$/, '');
}

function validateLogtoAccountDeletionConfig(env = process.env) {
  if (!accountDeletionRecoveryEnabled(env)) return true;

  const baseUrl = logtoBaseUrl(env);
  const appId = String(env.LOGTO_M2M_APP_ID || '').trim();
  const appSecret = String(env.LOGTO_M2M_APP_SECRET || '').trim();
  const resource = String(env.LOGTO_MANAGEMENT_RESOURCE || '').trim();
  const scope = String(env.LOGTO_MANAGEMENT_SCOPE || '').trim();

  if (Boolean(appId) !== Boolean(appSecret)) {
    throw new Error('LOGTO_M2M_APP_ID and LOGTO_M2M_APP_SECRET must be configured together');
  }
  if ((appId || appSecret || resource || scope) && !baseUrl) {
    throw new Error('Logto account deletion recovery requires LOGTO_ENDPOINT or LOGTO_ISSUER');
  }
  if (env.NODE_ENV !== 'production' || !baseUrl) return true;

  if (!appId || !appSecret) {
    throw new Error('Logto account deletion recovery requires LOGTO_M2M_APP_ID and LOGTO_M2M_APP_SECRET');
  }
  if (!resource) throw new Error('LOGTO_MANAGEMENT_RESOURCE is required for Logto account deletion recovery');
  try {
    const resourceUrl = new URL(resource);
    if (resourceUrl.protocol !== 'https:') throw new Error('not https');
  } catch {
    throw new Error('LOGTO_MANAGEMENT_RESOURCE must be an absolute HTTPS URL');
  }
  if (scope !== LOGTO_ACCOUNT_DELETION_SCOPE) {
    throw new Error(`LOGTO_MANAGEMENT_SCOPE must be exactly ${LOGTO_ACCOUNT_DELETION_SCOPE}`);
  }
  return true;
}

module.exports = {
  LOGTO_ACCOUNT_DELETION_SCOPE,
  accountDeletionRecoveryEnabled,
  logtoBaseUrl,
  validateLogtoAccountDeletionConfig,
};
