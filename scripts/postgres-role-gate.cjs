'use strict';

const PROTECTED_SCHEMA_TABLES = Object.freeze(['schema_migrations', 'schema_migration_checksums']);

function quoteIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!identifier || identifier.includes('\0')) throw new Error('PostgreSQL role identifier is required');
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function enforceRuntimeRolePrivileges(pool, { appUser } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('Runtime role gate requires a PostgreSQL pool');
  const normalizedAppUser = String(appUser || '').trim();
  const appRole = quoteIdentifier(normalizedAppUser);

  const identity = await pool.query('SELECT current_user AS migration_user, current_database() AS database_name');
  const migrationUser = String(identity.rows?.[0]?.migration_user || '');
  const databaseName = String(identity.rows?.[0]?.database_name || '');
  if (!migrationUser || !databaseName) throw new Error('Runtime role gate could not resolve the migration identity');
  if (migrationUser === normalizedAppUser) throw new Error('PG_APP_USER must differ from the migration owner');

  const role = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [normalizedAppUser]);
  if (!role.rows?.[0]) throw new Error(`Runtime application role does not exist: ${normalizedAppUser}`);

  const protectedTables = await pool.query(
    `SELECT required.table_name, to_regclass('public.' || required.table_name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS required(table_name)`,
    [PROTECTED_SCHEMA_TABLES],
  );
  const missing = protectedTables.rows.filter((row) => row.present !== true).map((row) => row.table_name);
  if (missing.length > 0) throw new Error(`Protected schema tables are missing: ${missing.join(', ')}`);

  const database = quoteIdentifier(databaseName);
  await pool.query(`GRANT CONNECT ON DATABASE ${database} TO ${appRole}`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM ${appRole}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`);
  await pool.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`);
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`,
  );
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appRole}`);

  for (const tableName of PROTECTED_SCHEMA_TABLES) {
    const table = quoteIdentifier(tableName);
    await pool.query(`GRANT SELECT ON TABLE public.${table} TO ${appRole}`);
    await pool.query(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.${table} FROM ${appRole}`,
    );
  }

  const verification = await pool.query(
    `SELECT required.table_name,
            has_table_privilege($1, format('public.%I', required.table_name), 'SELECT') AS can_select,
            has_table_privilege($1, format('public.%I', required.table_name), 'INSERT')
              OR has_table_privilege($1, format('public.%I', required.table_name), 'UPDATE')
              OR has_table_privilege($1, format('public.%I', required.table_name), 'DELETE')
              OR has_table_privilege($1, format('public.%I', required.table_name), 'TRUNCATE') AS can_write
       FROM unnest($2::text[]) AS required(table_name)`,
    [normalizedAppUser, PROTECTED_SCHEMA_TABLES],
  );
  const invalid = verification.rows.filter((row) => row.can_select !== true || row.can_write === true);
  if (invalid.length > 0) throw new Error('Runtime application role can modify protected schema history');

  return { appUser: normalizedAppUser, protectedTables: [...PROTECTED_SCHEMA_TABLES] };
}

module.exports = { PROTECTED_SCHEMA_TABLES, enforceRuntimeRolePrivileges, quoteIdentifier };
