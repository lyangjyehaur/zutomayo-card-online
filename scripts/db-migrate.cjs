/**
 * node-pg-migrate wrapper：從 PG_* 環境變數組合連線資訊，執行 migration。
 *
 * 用法：
 *   node scripts/db-migrate.cjs up        # 執行所有待跑 migration
 *   node scripts/db-migrate.cjs down      # 回退最後一個 migration
 *   node scripts/db-migrate.cjs create <name>  # 建立新 migration 檔案
 *
 * 環境變數（與 api/server.cjs 一致）：
 *   PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE
 * 或直接設定 DATABASE_URL（優先使用）。
 */
'use strict';

const { resolve } = require('node:path');

async function main() {
  const [, , subCommand, ...rest] = process.argv;

  if (!subCommand) {
    console.error('Usage: node scripts/db-migrate.cjs <up|down|create> [name]');
    process.exit(1);
  }

  const migrationsDir = resolve(__dirname, '..', 'migrations');

  // node-pg-migrate 的 runner API 接受 string（connection string）或 ClientConfig 物件。
  // 專案用 PG_* 分開的環境變數，直接組成 ClientConfig 即可，不需要拼 URL。
  const databaseUrl = process.env.DATABASE_URL || {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'postgres',
  };

  const { runner, Migration } = require('node-pg-migrate');

  if (subCommand === 'create') {
    const name = rest[0];
    if (!name) {
      console.error('Usage: node scripts/db-migrate.cjs create <name>');
      process.exit(1);
    }
    const filePath = await Migration.create(name, migrationsDir, { language: 'js' });
    console.log('Created migration:', filePath);
    return;
  }

  const direction = subCommand === 'down' ? 'down' : 'up';

  await runner({
    databaseUrl,
    dir: migrationsDir,
    direction,
    migrationsTable: 'schema_migrations',
    schema: 'public',
    count: direction === 'down' ? 1 : Infinity,
    log: (msg) => console.log(msg),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
