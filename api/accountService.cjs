/* global module */

function normalizeEmail(email) {
  return String(email || '')
    .slice(0, 120)
    .trim()
    .toLowerCase();
}

function createAvatarUrls(email, country, hashEmail) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || typeof hashEmail !== 'function') return { avatarUrl: '', avatarFallbackUrls: [] };

  const hash = hashEmail(cleanEmail);
  const qq = cleanEmail.endsWith('@qq.com') ? cleanEmail.split('@')[0] : '';
  const qqAvatar = /^\d{5,12}$/.test(qq) ? `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100` : '';
  const gravatar = `https://www.gravatar.com/avatar/${hash}?d=mp&s=160`;
  const cravatar = `https://cravatar.cn/avatar/${hash}?d=mp&s=160`;
  const primaryUrls =
    String(country || '').toUpperCase() === 'CN' ? [cravatar, qqAvatar, gravatar] : [gravatar, qqAvatar, cravatar];
  const urls = primaryUrls.filter(Boolean);

  return {
    avatarUrl: urls[0] || '',
    avatarFallbackUrls: urls.slice(1),
  };
}

function mapAccountProfile(user, options = {}) {
  const avatar = createAvatarUrls(user.email, options.country, options.hashEmail);
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatarUrl: avatar.avatarUrl,
    avatarFallbackUrls: avatar.avatarFallbackUrls,
    elo: user.elo,
    matchCount: user.match_count,
    wins: user.wins,
    winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
    createdAt: user.created_at,
  };
}

function normalizeOAuthProfile(profile) {
  return {
    provider: String(profile.provider || '').toLowerCase(),
    providerUserId: String(profile.providerUserId || ''),
    email: normalizeEmail(profile.email),
    emailVerified: Boolean(profile.emailVerified),
    displayName: String(profile.displayName || '').slice(0, 120),
    avatarUrl: String(profile.avatarUrl || '').slice(0, 500),
  };
}

async function registerAccount({ pool, body, sanitizeText, hashPassword, createToken, generateUserId, generateSalt }) {
  const { email, password, nickname } = body;
  if (!email || !password) return { ok: false, status: 400, error: 'Email and password required' };
  if (password.length < 6) return { ok: false, status: 400, error: 'Password must be at least 6 characters' };

  const cleanEmail = normalizeEmail(email);
  const cleanNickname = sanitizeText(nickname || String(cleanEmail).split('@')[0], 30) || 'player';

  const existing = (await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail])).rows[0];
  if (existing) return { ok: false, status: 409, error: 'Email already registered' };

  const id = generateUserId();
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);

  await pool.query('INSERT INTO users (id, email, password_hash, salt, nickname) VALUES ($1, $2, $3, $4, $5)', [
    id,
    cleanEmail,
    hash,
    salt,
    cleanNickname,
  ]);

  return {
    ok: true,
    body: { token: createToken(id), user: { id, email: cleanEmail, nickname: cleanNickname, elo: 1000 } },
  };
}

async function loginAccount({ pool, body, hashPassword, createToken, currentIterations, legacyIterations }) {
  const { email, password } = body;
  if (!email || !password) return { ok: false, status: 400, error: 'Email and password required' };

  const user = (await pool.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)])).rows[0];
  if (!user) return { ok: false, status: 401, error: 'Invalid credentials' };

  const newHash = await hashPassword(password, user.salt, currentIterations);
  const legacyHash = await hashPassword(password, user.salt, legacyIterations);
  if (newHash !== user.password_hash && legacyHash !== user.password_hash) {
    return { ok: false, status: 401, error: 'Invalid credentials' };
  }

  if (newHash !== user.password_hash) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
  }

  return {
    ok: true,
    body: {
      token: createToken(user.id),
      user: { id: user.id, email: user.email, nickname: user.nickname, elo: user.elo },
    },
  };
}

async function getAccountProfile(pool, userId, options = {}) {
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  return { ok: true, body: mapAccountProfile(user, options) };
}

async function updateAccountProfile({ pool, userId, body, sanitizeText, country, hashEmail }) {
  const clean = sanitizeText(body.nickname, 30);
  if (!clean) return { ok: false, status: 400, error: 'Nickname required' };
  await pool.query('UPDATE users SET nickname = $1 WHERE id = $2', [clean, userId]);
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  return { ok: true, body: mapAccountProfile(user, { country, hashEmail }) };
}

async function updateAccountPassword({
  pool,
  userId,
  body,
  hashPassword,
  generateSalt,
  currentIterations,
  legacyIterations,
}) {
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return { ok: false, status: 400, error: 'Current password and new password required' };
  }
  if (String(newPassword).length < 6) {
    return { ok: false, status: 400, error: 'Password must be at least 6 characters' };
  }

  const user = (await pool.query('SELECT id, password_hash, salt FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) return { ok: false, status: 404, error: 'User not found' };

  const currentHash = await hashPassword(currentPassword, user.salt, currentIterations);
  const legacyHash = await hashPassword(currentPassword, user.salt, legacyIterations);
  if (currentHash !== user.password_hash && legacyHash !== user.password_hash) {
    return { ok: false, status: 401, error: 'Invalid current password' };
  }

  const nextSalt = generateSalt();
  const nextHash = await hashPassword(newPassword, nextSalt, currentIterations);
  await pool.query('UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3', [nextHash, nextSalt, userId]);
  return { ok: true, body: { ok: true } };
}

async function listAccountIdentities(pool, userId) {
  const identities = (
    await pool.query(
      `SELECT provider, provider_user_id, email, display_name, avatar_url, created_at, updated_at
       FROM user_identities
       WHERE user_id = $1
       ORDER BY provider ASC`,
      [userId],
    )
  ).rows;

  return {
    ok: true,
    body: {
      identities: identities.map((identity) => ({
        provider: identity.provider,
        providerUserId: identity.provider_user_id,
        email: identity.email || '',
        displayName: identity.display_name || '',
        avatarUrl: identity.avatar_url || '',
        linkedAt: identity.created_at,
        updatedAt: identity.updated_at,
      })),
    },
  };
}

async function linkOAuthIdentity({ pool, userId, profile }) {
  const cleanProfile = normalizeOAuthProfile(profile);
  if (!cleanProfile.provider || !cleanProfile.providerUserId) {
    return { ok: false, status: 400, error: 'Invalid OAuth profile' };
  }

  const existing = (
    await pool.query('SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2', [
      cleanProfile.provider,
      cleanProfile.providerUserId,
    ])
  ).rows[0];
  if (existing && existing.user_id !== userId) {
    return { ok: false, status: 409, error: 'OAuth account is already linked' };
  }

  const existingForUser = (
    await pool.query('SELECT provider_user_id FROM user_identities WHERE user_id = $1 AND provider = $2', [
      userId,
      cleanProfile.provider,
    ])
  ).rows[0];
  if (existingForUser && existingForUser.provider_user_id !== cleanProfile.providerUserId) {
    return { ok: false, status: 409, error: 'OAuth provider is already linked' };
  }

  await pool.query(
    `INSERT INTO user_identities
       (user_id, provider, provider_user_id, email, email_verified, display_name, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET
       email = EXCLUDED.email,
       email_verified = EXCLUDED.email_verified,
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       updated_at = NOW()`,
    [
      userId,
      cleanProfile.provider,
      cleanProfile.providerUserId,
      cleanProfile.email,
      cleanProfile.emailVerified,
      cleanProfile.displayName,
      cleanProfile.avatarUrl,
    ],
  );

  return { ok: true, body: { linked: true, provider: cleanProfile.provider } };
}

async function unlinkOAuthIdentity({ pool, userId, provider }) {
  const cleanProvider = String(provider || '').toLowerCase();
  if (!cleanProvider) return { ok: false, status: 400, error: 'OAuth provider required' };

  const identity = (
    await pool.query('SELECT provider_user_id FROM user_identities WHERE user_id = $1 AND provider = $2', [
      userId,
      cleanProvider,
    ])
  ).rows[0];
  if (!identity) return { ok: false, status: 404, error: 'OAuth identity not found' };

  const user = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) return { ok: false, status: 404, error: 'User not found' };

  const identityCount = Number(
    (await pool.query('SELECT COUNT(*)::int AS count FROM user_identities WHERE user_id = $1', [userId])).rows[0]
      ?.count || 0,
  );
  const hasPasswordLogin = typeof user.password_hash === 'string' && !user.password_hash.startsWith('oauth:');
  if (!hasPasswordLogin && identityCount <= 1) {
    return { ok: false, status: 409, error: 'Cannot unlink the last sign-in method' };
  }

  await pool.query('DELETE FROM user_identities WHERE user_id = $1 AND provider = $2', [userId, cleanProvider]);
  return { ok: true, body: { unlinked: true, provider: cleanProvider } };
}

async function loginWithOAuthIdentity({
  pool,
  profile,
  sanitizeText,
  createToken,
  generateUserId,
  generateDisabledPasswordHash,
  generateSalt,
  hashEmail,
  country,
}) {
  const cleanProfile = normalizeOAuthProfile(profile);
  if (!cleanProfile.provider || !cleanProfile.providerUserId) {
    return { ok: false, status: 400, error: 'Invalid OAuth profile' };
  }

  const identity = (
    await pool.query('SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2', [
      cleanProfile.provider,
      cleanProfile.providerUserId,
    ])
  ).rows[0];

  let userId = identity?.user_id;
  if (!userId && cleanProfile.email && cleanProfile.emailVerified) {
    userId = (await pool.query('SELECT id FROM users WHERE email = $1', [cleanProfile.email])).rows[0]?.id;
  }

  if (!userId) {
    userId = generateUserId();
    const nicknameSource = cleanProfile.displayName || cleanProfile.email.split('@')[0] || cleanProfile.provider;
    const nickname = sanitizeText(nicknameSource, 30) || 'player';
    await pool.query('INSERT INTO users (id, email, password_hash, salt, nickname) VALUES ($1, $2, $3, $4, $5)', [
      userId,
      cleanProfile.email || `${cleanProfile.provider}_${cleanProfile.providerUserId}@oauth.local`,
      generateDisabledPasswordHash(),
      generateSalt(),
      nickname,
    ]);
  }

  const linkResult = await linkOAuthIdentity({ pool, userId, profile: cleanProfile });
  if (!linkResult.ok) return linkResult;

  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  return {
    ok: true,
    body: {
      token: createToken(userId),
      user: mapAccountProfile(user, { country, hashEmail }),
    },
  };
}

module.exports = {
  createAvatarUrls,
  getAccountProfile,
  linkOAuthIdentity,
  listAccountIdentities,
  loginAccount,
  loginWithOAuthIdentity,
  mapAccountProfile,
  registerAccount,
  updateAccountPassword,
  updateAccountProfile,
  unlinkOAuthIdentity,
};
