/**
 * SQLite → PostgreSQL 一次性資料遷移腳本。
 *
 * 將舊 api/server.cjs（better-sqlite3）的 users / decks / matches 三表
 * 遷移到新 PG schema。boardgame.io 的對局狀態存在 bjg_matches（由
 * PostgresAdapter 管理），與此處的 matches 表（API 對戰紀錄）不同，不在遷移範圍。
 *
 * 使用方式：
 *   1. npm i -D better-sqlite3   # 遷移用，非生產依賴
 *   2. SQLITE_PATH=/data/zutomayo.db \
 *      PG_HOST=localhost PG_USER=zutomayo PG_PASSWORD=zutomayo_dev \
 *      PG_DATABASE=zutomayo npm run migrate:sqlite-to-pg
 *
 * 重複執行安全：ON CONFLICT (id) DO NOTHING，已存在的 row 會跳過。
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

// 動態載入 better-sqlite3（遷移用，非生產依賴；未安裝時提示）。
type BetterSqlite3 = {
  default: new (path: string, opts?: { readonly?: boolean }) => SqliteDb;
};
interface SqliteDb {
  prepare: (sql: string) => { all: () => unknown[] };
  close: () => void;
  pragma: (s: string) => unknown;
}

let Database: BetterSqlite3['default'];
try {
  ({ default: Database } = require('better-sqlite3') as BetterSqlite3);
} catch {
  console.error('better-sqlite3 未安裝。請先執行: npm i -D better-sqlite3');
  process.exit(1);
}

const { Pool } = require('pg') as typeof import('pg');

const SQLITE_PATH = process.env.SQLITE_PATH || process.env.DB_PATH || '/data/zutomayo.db';

const migrationUser = assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
const databaseUrl = postgresConnectionString(process.env);
const pool = new Pool({
  ...(databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: Number(process.env.PG_PORT) || 5432,
        user: process.env.PG_USER || migrationUser || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'postgres',
      }),
  ssl: postgresSslConfig(process.env),
});

// PG schema（與 api/server.cjs initSchema 一致，確保目標 table 存在）。
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nickname TEXT NOT NULL,
    elo INTEGER NOT NULL DEFAULT 1000,
    match_count INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_users_elo ON users (elo DESC);

  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    card_ids JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    player0_id TEXT REFERENCES users(id),
    player1_id TEXT REFERENCES users(id),
    winner_id TEXT,
    loser_id TEXT,
    winner_elo_change INTEGER NOT NULL DEFAULT 0,
    loser_elo_change INTEGER NOT NULL DEFAULT 0,
    turns INTEGER,
    duration_seconds INTEGER,
    action_log JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_matches_player0 ON matches(player0_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
  CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
  CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id);
  CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);
`;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  nickname: string;
  elo: number;
  match_count: number;
  wins: number;
  created_at: string;
}

interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  card_ids: string;
  created_at: string;
  updated_at: string;
}

interface MatchRow {
  id: string;
  player0_id: string | null;
  player1_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_elo_change: number;
  loser_elo_change: number;
  turns: number | null;
  duration_seconds: number | null;
  action_log: string | null;
  created_at: string;
}

// SQLite TEXT 的 action_log 可能是 NULL / 空字串 / JSON 字串；
// PG JSONB 不接受空字串，需標準化為 NULL 或合法 JSON。
function normalizeJsonText(value: string | null): string | null {
  if (value === null || value === '') return null;
  return value;
}

async function main(): Promise<void> {
  if (!existsSync(SQLITE_PATH)) {
    console.error(`SQLite DB 不存在: ${SQLITE_PATH}`);
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log(`讀取 SQLite: ${SQLITE_PATH}`);

  await pool.query(SCHEMA_SQL);

  const users = sqlite.prepare('SELECT * FROM users').all() as UserRow[];
  const decks = sqlite.prepare('SELECT * FROM decks').all() as DeckRow[];
  const matches = sqlite.prepare('SELECT * FROM matches').all() as MatchRow[];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, salt, nickname, elo, match_count, wins, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email, u.password_hash, u.salt, u.nickname, u.elo, u.match_count, u.wins, u.created_at],
      );
    }

    for (const d of decks) {
      // card_ids: SQLite TEXT (JSON string) → PG JSONB（pg driver 自動解析字串）。
      await client.query(
        `INSERT INTO decks (id, user_id, name, card_ids, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.user_id, d.name, d.card_ids, d.created_at, d.updated_at],
      );
    }

    for (const m of matches) {
      await client.query(
        `INSERT INTO matches (id, player0_id, player1_id, winner_id, loser_id,
                              winner_elo_change, loser_elo_change, turns,
                              duration_seconds, action_log, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          m.id,
          m.player0_id,
          m.player1_id,
          m.winner_id,
          m.loser_id,
          m.winner_elo_change,
          m.loser_elo_change,
          m.turns,
          m.duration_seconds,
          normalizeJsonText(m.action_log),
          m.created_at,
        ],
      );
    }

    await client.query('COMMIT');
    console.log(`遷移完成: ${users.length} users, ${decks.length} decks, ${matches.length} matches`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('遷移失敗:', err);
  process.exit(1);
});
