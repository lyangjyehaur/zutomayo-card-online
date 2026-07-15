/* global module, require */

const crypto = require('crypto');

const DEFAULT_STEP_UP_TTL_SECONDS = 5 * 60;

function stepUpKey(token) {
  const digest = crypto
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
  return `account:step-up:${digest}`;
}

async function issueAccountStepUp({
  redis,
  userId,
  providerVerificationRecordId,
  purpose = 'account-sensitive-action',
  ttlSeconds = DEFAULT_STEP_UP_TTL_SECONDS,
  generateToken = () => crypto.randomBytes(32).toString('base64url'),
}) {
  if (!userId || !providerVerificationRecordId) throw new Error('Verified provider step-up is required');
  const token = generateToken();
  const ttl = Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_STEP_UP_TTL_SECONDS, 15 * 60));
  const value = JSON.stringify({ userId, providerVerificationRecordId, purpose });
  const stored = await redis.set(stepUpKey(token), value, 'EX', ttl, 'NX');
  if (stored !== 'OK') throw new Error('Unable to issue account step-up');
  return { token, expiresIn: ttl };
}

async function consumeAccountStepUp({ redis, token, userId, purpose = 'account-sensitive-action' }) {
  if (!token || !userId) return null;
  const value = await redis.getdel(stepUpKey(token));
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed.userId !== userId || parsed.purpose !== purpose) return null;
    return typeof parsed.providerVerificationRecordId === 'string' && parsed.providerVerificationRecordId
      ? parsed.providerVerificationRecordId
      : null;
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_STEP_UP_TTL_SECONDS,
  consumeAccountStepUp,
  issueAccountStepUp,
  stepUpKey,
};
