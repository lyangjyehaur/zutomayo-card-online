/* global module */

function mapAccountProfile(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    elo: user.elo,
    matchCount: user.match_count,
    wins: user.wins,
    winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
    createdAt: user.created_at,
  };
}

async function registerAccount({
  pool,
  body,
  sanitizeText,
  hashPassword,
  createToken,
  generateUserId,
  generateSalt,
}) {
  const { email, password, nickname } = body;
  if (!email || !password) return { ok: false, status: 400, error: 'Email and password required' };
  if (password.length < 6) return { ok: false, status: 400, error: 'Password must be at least 6 characters' };

  const cleanEmail = String(email).slice(0, 120).toLowerCase();
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
  const user = (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
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

async function getAccountProfile(pool, userId) {
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  return { ok: true, body: mapAccountProfile(user) };
}

async function updateAccountProfile({ pool, userId, body, sanitizeText }) {
  const clean = sanitizeText(body.nickname, 30);
  if (!clean) return { ok: false, status: 400, error: 'Nickname required' };
  await pool.query('UPDATE users SET nickname = $1 WHERE id = $2', [clean, userId]);
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  return { ok: true, body: mapAccountProfile(user) };
}

module.exports = {
  getAccountProfile,
  loginAccount,
  mapAccountProfile,
  registerAccount,
  updateAccountProfile,
};
