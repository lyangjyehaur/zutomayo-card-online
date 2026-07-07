/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * 老用戶遷移到 Logto 腳本
 *
 * 流程：
 * 1. 從本地 PG (zutomayo_card database) 讀取所有老用戶
 * 2. 用 M2M token 呼叫 Logto Management API 建立 Logto 用戶
 *    - primaryEmail = 老用戶 email
 *    - username = email local part + 隨機後綴（Logto username 不允許 @）
 *    - password = 隨機密碼（老用戶必須走「忘記密碼」重設）
 *    - customData.legacyUserId = 老用戶 ID（用於追蹤）
 *    - customData.elo / matchCount / wins = 遊戲資料快照
 * 3. 在 Logto DB (logto database) 插入 verification_statuses 記錄
 *    - verified_identifier = email
 *    - 讓 Logto 認為 email 已驗證，使 loginWithOAuthIdentity 的自動關聯能成功
 * 4. 幂等性：已存在的 Logto 用戶（用 email 查詢）跳過
 *
 * 使用方式：
 *   npm run migrate:logto                  # dry-run，只顯示會遷移哪些用戶
 *   npm run migrate:logto -- --apply       # 實際執行遷移
 *
 * 環境變數（從 .env 讀取）：
 *   PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE  — 本地用戶 DB
 *   LOGTO_ENDPOINT          — Logto 端點（如 https://auth.zutomayocard.online）
 *   LOGTO_M2M_APP_ID        — M2M 應用 ID
 *   LOGTO_M2M_APP_SECRET    — M2M 應用 Secret
 *   LOGTO_MANAGEMENT_API_RESOURCE  — Management API resource（如 https://default.logto.app/api）
 *   LOGTO_DB_USER / LOGTO_DB_PASSWORD  — Logto PG 連線（用於插入 verification_statuses）
 */

const crypto = require('crypto');
const { Pool } = require('pg');

// ===== Config =====
const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = Number(process.env.PG_PORT) || 5432;
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || '';
const PG_DATABASE = process.env.PG_DATABASE || 'zutomayo_card';

const LOGTO_ENDPOINT = (process.env.LOGTO_ENDPOINT || '').replace(/\/$/, '');
const LOGTO_M2M_APP_ID = process.env.LOGTO_M2M_APP_ID || '';
const LOGTO_M2M_APP_SECRET = process.env.LOGTO_M2M_APP_SECRET || '';
const LOGTO_MANAGEMENT_API_RESOURCE = process.env.LOGTO_MANAGEMENT_API_RESOURCE || 'https://default.logto.app/api';

// Logto DB（用於插入 verification_statuses，與本地 DB 可能是同一個 PG 實體但不同 database）
// 如果沒有 logto role 的密碼，可以用 superuser 連（如 dan + POSTGRES_PASSWORD）
const LOGTO_DB_USER = process.env.LOGTO_DB_USER || 'logto';
const LOGTO_DB_PASSWORD = process.env.LOGTO_DB_PASSWORD || '';
const LOGTO_DB_HOST = process.env.LOGTO_DB_HOST || PG_HOST;
const LOGTO_DB_PORT = Number(process.env.LOGTO_DB_PORT) || PG_PORT;
const LOGTO_DB_NAME = process.env.LOGTO_DB_NAME || 'logto';

const DRY_RUN = !process.argv.includes('--apply');

// ===== Helpers =====
function generateTempPassword() {
  // 16 bytes 隨機密碼，符合 Logto 最少 6 字元要求
  return 'Migrate_' + crypto.randomBytes(8).toString('hex');
}

function emailToUsername(email) {
  // Logto username regex: [a-zA-Z0-9_-]，且必須以字母開頭
  // 用 email local part + 短隨機後綴避免衝突
  let localPart = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  // 保證以字母開頭（數字開頭會被 Logto 拒絕）
  if (/^[0-9]/.test(localPart)) {
    localPart = 'u_' + localPart;
  }
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${localPart}_${suffix}`;
}

async function fetchM2MToken() {
  const tokenUrl = `${LOGTO_ENDPOINT}/oidc/token`;
  const auth = Buffer.from(`${LOGTO_M2M_APP_ID}:${LOGTO_M2M_APP_SECRET}`).toString('base64');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: LOGTO_MANAGEMENT_API_RESOURCE,
      scope: 'all',
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`M2M token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function listLogtoUsers(token) {
  const allUsers = [];
  let page = 1;
  while (true) {
    const url = `${LOGTO_ENDPOINT}/api/users?page=${page}&page_size=50`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`List Logto users failed (page ${page}): ${response.status} ${text}`);
    }
    const users = await response.json();
    if (!Array.isArray(users) || users.length === 0) break;
    allUsers.push(...users);
    if (users.length < 50) break;
    page += 1;
    // 避免 rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return allUsers;
}

async function createLogtoUser(token, user) {
  const payload = {
    primaryEmail: user.email,
    username: user.username, // Logto username 不允許 @，用 email local part
    password: user.tempPassword,
    name: user.nickname,
    customData: {
      legacyUserId: user.id,
      legacyEmail: user.email,
      elo: user.elo,
      matchCount: user.match_count,
      wins: user.wins,
      migratedAt: new Date().toISOString(),
    },
  };

  const response = await fetch(`${LOGTO_ENDPOINT}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Create Logto user failed (${user.email}): ${response.status} ${text}`);
  }

  return response.json();
}

async function markEmailVerified(logtoPool, logtoUserId, email) {
  // 插入 verification_statuses 記錄，讓 Logto 認為此 email 已驗證
  // id 用 vs_ + random，避免衝突
  const id = 'vs_' + crypto.randomBytes(8).toString('hex');
  await logtoPool.query(
    `INSERT INTO verification_statuses (tenant_id, id, user_id, verified_identifier)
     VALUES ('default', $1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, logtoUserId, email],
  );
}

// ===== Main =====
async function main() {
  console.log('=== 老用戶遷移到 Logto ===');
  console.log(`模式: ${DRY_RUN ? 'DRY-RUN (預覽)' : 'APPLY (實際執行)'}`);
  console.log(`Logto endpoint: ${LOGTO_ENDPOINT}`);
  console.log(`本地 PG: ${PG_HOST}:${PG_PORT}/${PG_DATABASE}`);
  console.log(`Logto PG: ${LOGTO_DB_HOST}:${LOGTO_DB_PORT}/${LOGTO_DB_NAME}`);
  console.log('');

  if (!LOGTO_M2M_APP_ID || !LOGTO_M2M_APP_SECRET) {
    console.error('ERROR: LOGTO_M2M_APP_ID 和 LOGTO_M2M_APP_SECRET 必須設定');
    process.exit(1);
  }

  // 連本地 DB 讀老用戶
  const localPool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DATABASE,
    connectionTimeoutMillis: 5000,
  });

  // 連 Logto DB 寫 verification_statuses
  const logtoPool = new Pool({
    host: LOGTO_DB_HOST,
    port: LOGTO_DB_PORT,
    user: LOGTO_DB_USER,
    password: LOGTO_DB_PASSWORD,
    database: LOGTO_DB_NAME,
    connectionTimeoutMillis: 5000,
  });

  try {
    // 1. 讀取本地老用戶（排除 OAuth 建立的用戶：password_hash 以 'oauth:' 開頭）
    console.log('讀取本地老用戶...');
    const { rows: localUsers } = await localPool.query(
      `SELECT id, email, nickname, elo, match_count, wins, created_at
       FROM users
       WHERE email IS NOT NULL AND email != ''
         AND (password_hash IS NULL OR password_hash NOT LIKE 'oauth:%')
       ORDER BY created_at ASC`,
    );
    console.log(`本地老用戶: ${localUsers.length} 個`);

    if (localUsers.length === 0) {
      console.log('沒有需要遷移的用戶。');
      return;
    }

    // 2. 取 M2M token
    console.log('\n取得 Logto M2M token...');
    const token = await fetchM2MToken();
    console.log('M2M token 取得成功');

    // 3. 列出 Logto 既有用戶（幂等性檢查）
    console.log('\n查詢 Logto 既有用戶...');
    const logtoUsers = await listLogtoUsers(token);
    const existingEmails = new Set(logtoUsers.filter((u) => u.primaryEmail).map((u) => u.primaryEmail.toLowerCase()));
    const existingUsernames = new Set(logtoUsers.filter((u) => u.username).map((u) => u.username.toLowerCase()));
    // 也比對 customData.legacyUserId，避免重複遷移
    const existingLegacyIds = new Set(
      logtoUsers.filter((u) => u.customData && u.customData.legacyUserId).map((u) => u.customData.legacyUserId),
    );
    console.log(`Logto 既有用戶: ${logtoUsers.length} 個`);

    // 4. 篩選需要遷移的用戶
    const toMigrate = [];
    const skipped = [];
    for (const user of localUsers) {
      const emailLower = user.email.toLowerCase();
      if (existingEmails.has(emailLower) || existingUsernames.has(emailLower) || existingLegacyIds.has(user.id)) {
        skipped.push(user);
      } else {
        toMigrate.push({
          ...user,
          username: emailToUsername(user.email),
          tempPassword: generateTempPassword(),
        });
      }
    }

    console.log(`\n需要遷移: ${toMigrate.length} 個`);
    console.log(`已存在跳過: ${skipped.length} 個`);

    if (skipped.length > 0) {
      console.log('\n--- 跳過的用戶 ---');
      for (const u of skipped) {
        console.log(`  ${u.email} (${u.nickname}) — Logto 已存在`);
      }
    }

    if (toMigrate.length === 0) {
      console.log('\n沒有需要遷移的用戶。');
      return;
    }

    console.log('\n--- 待遷移用戶 ---');
    for (const u of toMigrate) {
      console.log(
        `  ${u.email} | username=${u.username} | ${u.nickname} | ELO ${u.elo} | ${u.match_count} 場 | ID ${u.id}`,
      );
    }

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] 不執行實際遷移。加 --apply 參數執行。');
      return;
    }

    // 5. 執行遷移
    console.log('\n=== 開始遷移 ===');
    const results = [];
    for (const user of toMigrate) {
      try {
        console.log(`\n遷移: ${user.email}`);
        const created = await createLogtoUser(token, user);
        console.log(`  Logto user ID: ${created.id}`);

        await markEmailVerified(logtoPool, created.id, user.email);
        console.log(`  email 已標記為已驗證`);

        results.push({
          ok: true,
          email: user.email,
          username: user.username,
          logtoId: created.id,
          tempPassword: user.tempPassword,
        });

        // 避免 rate limit
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`  失敗: ${err.message}`);
        results.push({ ok: false, email: user.email, error: err.message });
      }
    }

    // 6. 報告
    console.log('\n=== 遷移結果 ===');
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    console.log(`成功: ${ok.length} / ${results.length}`);
    if (failed.length > 0) {
      console.log('失敗:');
      for (const r of failed) {
        console.log(`  ${r.email}: ${r.error}`);
      }
    }

    if (ok.length > 0) {
      console.log('\n=== 用戶臨時密碼（請妥善保存，發給用戶後刪除此輸出）===');
      for (const r of ok) {
        console.log(`  ${r.email} | username=${r.username} | 密碼=${r.tempPassword}`);
      }
      console.log('\n注意：用戶首次登入後建議自行修改密碼。');
    }
  } finally {
    await localPool.end();
    await logtoPool.end();
  }
}

main().catch((err) => {
  console.error('遷移失敗:', err);
  process.exit(1);
});
