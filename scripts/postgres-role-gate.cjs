'use strict';

const PROTECTED_SCHEMA_TABLES = Object.freeze(['schema_migrations', 'schema_migration_checksums']);

// Keep this list explicit. A new public table must be added to the role matrix
// in the same change as its migration; otherwise the release gate fails closed.
const APPLICATION_TABLES = Object.freeze([
  'users',
  'user_identities',
  'decks',
  'deck_reservations',
  'matches',
  'cards',
  'card_texts_i18n',
  'card_official_errata',
  'game_config',
  'preset_decks',
  'admin_audit_log',
  'feedback_posts',
  'feedback_votes',
  'feedback_comments',
  'feedback_comment_votes',
  'feedback_tags',
  'feedback_comment_reactions',
  'feedback_attachments',
  'announcements',
  'announcement_translations',
  'chat_conversations',
  'chat_messages',
  'chat_message_translations',
  'chat_read_states',
  'chat_reports',
  'chat_moderation_events',
  'chat_user_sanctions',
  'user_friends',
  'friend_requests',
  'user_blocks',
  'platform_match_participants',
  'platform_room_participants',
  'seasons',
  'season_ratings',
  'season_match_results',
  'season_rewards',
  'season_reward_entitlements',
  'legal_holds',
  'legal_hold_objects',
  'retention_runs',
  'account_action_tokens',
  'account_deletion_requests',
  'relationship_change_outbox',
  'admin_users',
  'admin_sessions',
  'bjg_matches',
  'bjg_match_seats',
  'bjg_match_result_outbox',
]);

const ALL_TABLES = Object.freeze([...PROTECTED_SCHEMA_TABLES, ...APPLICATION_TABLES]);
const ALL_RELATIONS = ALL_TABLES;
const ROLE_TYPES = Object.freeze(['api', 'game', 'platform', 'retention', 'monitor', 'backup', 'wal']);
const APP_ALIAS_TYPES = Object.freeze(new Set(['api', 'game', 'platform']));
const TABLE_PRIVILEGES = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']);
const SEQUENCE_PRIVILEGES = Object.freeze(['USAGE', 'SELECT', 'UPDATE']);
const COLUMN_PRIVILEGES = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']);
const USER_COLUMNS = Object.freeze([
  'id',
  'email',
  'password_hash',
  'salt',
  'nickname',
  'elo',
  'match_count',
  'wins',
  'created_at',
  'email_verified',
  'auth_version',
  'deleted_at',
]);

const GAME_READ_TABLES = Object.freeze([
  'cards',
  'card_texts_i18n',
  'card_official_errata',
  'seasons',
  ...PROTECTED_SCHEMA_TABLES,
]);
const GAME_TABLE_PRIVILEGES = Object.freeze({
  deck_reservations: ['SELECT', 'UPDATE'],
  matches: ['SELECT', 'INSERT'],
  bjg_matches: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  bjg_match_seats: ['SELECT', 'INSERT', 'UPDATE'],
  bjg_match_result_outbox: ['SELECT', 'INSERT', 'UPDATE'],
  season_ratings: ['SELECT', 'INSERT', 'UPDATE'],
  season_match_results: ['SELECT', 'INSERT'],
});
const PLATFORM_READ_TABLES = Object.freeze([
  'user_blocks',
  'user_friends',
  'bjg_matches',
  'chat_messages',
  'chat_conversations',
  ...PROTECTED_SCHEMA_TABLES,
]);
const PLATFORM_WRITE_TABLES = Object.freeze(['platform_match_participants', 'platform_room_participants']);
const RETENTION_TABLE_PRIVILEGES = Object.freeze({
  matches: ['SELECT', 'UPDATE'],
  platform_match_participants: ['SELECT'],
  platform_room_participants: ['SELECT'],
  bjg_matches: ['SELECT'],
  bjg_match_seats: ['SELECT'],
  bjg_match_result_outbox: ['SELECT'],
  deck_reservations: ['SELECT'],
  season_match_results: ['SELECT'],
  chat_messages: ['SELECT', 'UPDATE'],
  chat_conversations: ['SELECT'],
  chat_read_states: ['SELECT'],
  chat_moderation_events: ['SELECT'],
  chat_user_sanctions: ['SELECT'],
  chat_message_translations: ['SELECT', 'DELETE'],
  chat_reports: ['SELECT', 'DELETE'],
  feedback_posts: ['SELECT'],
  feedback_comments: ['SELECT'],
  feedback_votes: ['SELECT'],
  feedback_comment_votes: ['SELECT'],
  feedback_comment_reactions: ['SELECT'],
  legal_holds: ['SELECT', 'UPDATE'],
  legal_hold_objects: ['SELECT', 'INSERT'],
  admin_audit_log: ['SELECT', 'DELETE'],
  account_action_tokens: ['SELECT', 'DELETE'],
  relationship_change_outbox: ['SELECT', 'DELETE'],
  retention_runs: ['INSERT', 'UPDATE'],
  schema_migrations: ['SELECT'],
  schema_migration_checksums: ['SELECT'],
});

function quoteIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!identifier || identifier.includes('\0')) throw new Error('PostgreSQL role identifier is required');
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeRoleUsers({ appUser, roleUsers = {}, requireComplete = false } = {}) {
  const legacy = String(appUser || '').trim();
  const values = {
    api: String(roleUsers.api || legacy).trim(),
    game: String(roleUsers.game || legacy).trim(),
    platform: String(roleUsers.platform || legacy).trim(),
    retention: String(roleUsers.retention || '').trim(),
    monitor: String(roleUsers.monitor || '').trim(),
    backup: String(roleUsers.backup || '').trim(),
    wal: String(roleUsers.wal || '').trim(),
  };
  const missing = requireComplete ? ROLE_TYPES.filter((type) => !values[type]) : [];
  if (missing.length > 0) throw new Error(`PostgreSQL role matrix is incomplete: ${missing.join(', ')}`);
  for (const type of ROLE_TYPES) {
    if (values[type]) quoteIdentifier(values[type]);
  }
  return values;
}

function uniqueRoleUsers(roleUsers, requireDistinct) {
  const roleKinds = new Map();
  for (const type of ROLE_TYPES) {
    const user = roleUsers[type];
    if (!user) continue;
    const kinds = roleKinds.get(user) || [];
    kinds.push(type);
    roleKinds.set(user, kinds);
  }
  for (const [user, kinds] of roleKinds) {
    if (requireDistinct && kinds.length > 1) {
      throw new Error(`production PostgreSQL roles must be distinct: ${user} (${kinds.join(', ')})`);
    }
    if (kinds.length > 1 && kinds.some((kind) => !APP_ALIAS_TYPES.has(kind))) {
      throw new Error(`only API/GAME/PLATFORM may share a PostgreSQL role: ${user} (${kinds.join(', ')})`);
    }
  }
  return [...roleKinds.keys()];
}

function emptyPrivileges() {
  return new Map();
}

function addTablePrivileges(target, tableName, privileges) {
  const current = target.get(tableName) || new Set();
  for (const privilege of privileges) current.add(privilege);
  target.set(tableName, current);
}

function addColumnPrivileges(target, tableName, privilege, columns) {
  const table = target.get(tableName) || new Map();
  const current = table.get(privilege) || new Set();
  for (const column of columns) current.add(column);
  table.set(privilege, current);
  target.set(tableName, table);
}

function tableRulesFor(roleUsers, requiredRoleTypes) {
  const rules = new Map();
  const ensure = (roleName) => {
    if (!rules.has(roleName)) {
      rules.set(roleName, {
        tables: emptyPrivileges(),
        columns: new Map(),
        sequences: new Set(),
        schemaUsage: false,
        connect: false,
        monitor: false,
        replication: false,
      });
    }
    return rules.get(roleName);
  };
  const grant = (type, tables, privileges) => {
    if (!requiredRoleTypes.includes(type) || !roleUsers[type]) return;
    const rule = ensure(roleUsers[type]);
    for (const table of tables) addTablePrivileges(rule.tables, table, privileges);
    rule.connect = type !== 'wal';
    rule.schemaUsage = type !== 'monitor' && type !== 'wal';
    rule.monitor = type === 'monitor';
    rule.replication = type === 'wal';
  };
  const grantTableRules = (type, tableRules) => {
    if (!requiredRoleTypes.includes(type) || !roleUsers[type]) return;
    const rule = ensure(roleUsers[type]);
    for (const [tableName, privileges] of Object.entries(tableRules)) {
      addTablePrivileges(rule.tables, tableName, privileges);
    }
  };
  const grantColumns = (type, tableName, columnRules) => {
    if (!requiredRoleTypes.includes(type) || !roleUsers[type]) return;
    const rule = ensure(roleUsers[type]);
    for (const [privilege, columns] of Object.entries(columnRules)) {
      addColumnPrivileges(rule.columns, tableName, privilege, columns);
    }
  };

  // API owns the HTTP data plane. It gets row-level application CRUD but no
  // DDL, privilege-management, or writes to migration history.
  grant('api', APPLICATION_TABLES, ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  grant('api', PROTECTED_SCHEMA_TABLES, ['SELECT']);

  grant('game', GAME_READ_TABLES, ['SELECT']);
  grantTableRules('game', GAME_TABLE_PRIVILEGES);
  grantColumns('game', 'users', {
    SELECT: ['id', 'elo', 'match_count', 'wins', 'auth_version', 'deleted_at'],
    UPDATE: ['elo', 'match_count', 'wins'],
  });

  grant('platform', PLATFORM_READ_TABLES, ['SELECT']);
  grant('platform', PLATFORM_WRITE_TABLES, ['SELECT', 'INSERT', 'UPDATE']);
  grantColumns('platform', 'users', { SELECT: ['id', 'auth_version', 'deleted_at'] });

  grantTableRules('retention', RETENTION_TABLE_PRIVILEGES);
  grantColumns('retention', 'users', { SELECT: ['id', 'deleted_at'] });

  // Logical backup is intentionally read-only, including migration history.
  grant('backup', ALL_TABLES, ['SELECT']);

  for (const type of requiredRoleTypes) {
    if (!roleUsers[type]) continue;
    const rule = ensure(roleUsers[type]);
    rule.connect = type !== 'wal';
    rule.schemaUsage = type !== 'monitor' && type !== 'wal';
    rule.monitor = type === 'monitor';
    rule.replication = type === 'wal';
    if (type === 'api') {
      rule.sequences = new Set(SEQUENCE_PRIVILEGES);
    } else if (type === 'backup') {
      rule.sequences = new Set(['SELECT']);
    }
  }
  return rules;
}

function expectedTableChecks(rules) {
  const checks = [];
  for (const [roleName, rule] of rules) {
    for (const tableName of ALL_RELATIONS) {
      for (const privilege of TABLE_PRIVILEGES) {
        checks.push({
          role_name: roleName,
          table_name: tableName,
          privilege,
          allowed: rule.tables.get(tableName)?.has(privilege) === true,
        });
      }
    }
  }
  return checks;
}

function expectedSequenceChecks(rules) {
  const checks = [];
  for (const [roleName, rule] of rules) {
    for (const privilege of SEQUENCE_PRIVILEGES)
      checks.push({ role_name: roleName, privilege, allowed: rule.sequences.has(privilege) });
  }
  return checks;
}

function expectedColumnChecks(rules) {
  const checks = [];
  for (const [roleName, rule] of rules) {
    for (const columnName of USER_COLUMNS) {
      for (const privilege of COLUMN_PRIVILEGES) {
        const tableGrant = rule.tables.get('users')?.has(privilege) === true;
        const columnGrant = rule.columns.get('users')?.get(privilege)?.has(columnName) === true;
        checks.push({
          role_name: roleName,
          table_name: 'users',
          column_name: columnName,
          privilege,
          allowed: tableGrant || columnGrant,
        });
      }
    }
  }
  return checks;
}

async function withAclTransaction(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['zutomayo:postgres-role-matrix:v1']);
    const result = await operation(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

async function enforceRuntimeRolePrivileges(pool, options = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('Runtime role gate requires a PostgreSQL pool');
  const roleUsers = normalizeRoleUsers(options);
  const requiredRoleTypes = options.requireComplete
    ? [...ROLE_TYPES]
    : ROLE_TYPES.filter((type) => Boolean(roleUsers[type]));
  const requireDistinct = options.requireDistinct === true;
  const uniqueUsers = uniqueRoleUsers(roleUsers, requireDistinct);

  const identity = await pool.query('SELECT current_user AS migration_user, current_database() AS database_name');
  const migrationUser = String(identity.rows?.[0]?.migration_user || '');
  const databaseName = String(identity.rows?.[0]?.database_name || '');
  if (!migrationUser || !databaseName) throw new Error('Runtime role gate could not resolve the migration identity');
  if (uniqueUsers.includes(migrationUser))
    throw new Error('runtime PostgreSQL roles must differ from the migration owner');

  const roleResult = await pool.query(
    `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls, rolinherit
       FROM pg_roles
      WHERE rolname = ANY($1::text[])`,
    [uniqueUsers],
  );
  const roleRows = new Map((roleResult.rows || []).map((row) => [String(row.rolname), row]));
  const missingRoles = uniqueUsers.filter((roleName) => !roleRows.has(roleName));
  if (missingRoles.length > 0) throw new Error(`Runtime PostgreSQL roles do not exist: ${missingRoles.join(', ')}`);

  const rules = tableRulesFor(roleUsers, requiredRoleTypes);
  for (const [roleName, rule] of rules) {
    const attrs = roleRows.get(roleName);
    const expectedReplication = rule.replication;
    if (
      attrs.rolcanlogin !== true ||
      attrs.rolsuper !== false ||
      attrs.rolcreatedb !== false ||
      attrs.rolcreaterole !== false ||
      attrs.rolbypassrls !== false ||
      attrs.rolreplication !== expectedReplication ||
      attrs.rolinherit !== !expectedReplication
    ) {
      throw new Error(`PostgreSQL role attributes are unsafe or mismatched: ${roleName}`);
    }
  }

  const requiredTables = await pool.query(
    `SELECT required.table_name,
            to_regclass('public.' || required.table_name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS required(table_name)`,
    [ALL_RELATIONS],
  );
  const missingTables = (requiredTables.rows || []).filter((row) => row.present !== true).map((row) => row.table_name);
  if (missingTables.length > 0) throw new Error(`Role matrix tables are missing: ${missingTables.join(', ')}`);

  const actualTables = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const declaredTables = new Set(ALL_TABLES);
  const unknownTables = (actualTables.rows || [])
    .map((row) => String(row.table_name || ''))
    .filter((tableName) => tableName && !declaredTables.has(tableName));
  if (unknownTables.length > 0) {
    throw new Error(`Public tables are missing from the PostgreSQL role matrix: ${unknownTables.join(', ')}`);
  }

  return withAclTransaction(pool, async (client) => {
    const database = quoteIdentifier(databaseName);
    const quotedUserColumns = USER_COLUMNS.map(quoteIdentifier).join(', ');
    await client.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
    await client.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);

    for (const [roleName, rule] of rules) {
      const role = quoteIdentifier(roleName);
      await client.query(`REVOKE CONNECT ON DATABASE ${database} FROM ${role}`);
      await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${role}`);
      await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);
      for (const privilege of COLUMN_PRIVILEGES) {
        await client.query(`REVOKE ${privilege} (${quotedUserColumns}) ON TABLE public."users" FROM ${role}`);
      }
      await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role}`);
      if (rule.connect) await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
      if (rule.schemaUsage) await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      for (const [tableName, privileges] of rule.tables) {
        const table = quoteIdentifier(tableName);
        await client.query(`GRANT ${[...privileges].join(', ')} ON TABLE public.${table} TO ${role}`);
      }
      for (const [tableName, privilegeRules] of rule.columns) {
        const table = quoteIdentifier(tableName);
        for (const [privilege, columns] of privilegeRules) {
          const columnList = [...columns].map(quoteIdentifier).join(', ');
          await client.query(`GRANT ${privilege} (${columnList}) ON TABLE public.${table} TO ${role}`);
        }
      }
      if (rule.sequences.size > 0) {
        await client.query(`GRANT ${[...rule.sequences].join(', ')} ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      }
    }

    const tableVerification = await client.query(
      `WITH expected AS (
         SELECT role_name, table_name, privilege, allowed
           FROM jsonb_to_recordset($1::jsonb)
                AS item(role_name text, table_name text, privilege text, allowed boolean)
       )
       SELECT role_name, table_name, privilege
         FROM expected
        WHERE has_table_privilege(role_name, format('public.%I', table_name), privilege)
              IS DISTINCT FROM allowed`,
      [JSON.stringify(expectedTableChecks(rules))],
    );
    if ((tableVerification.rows || []).length > 0) {
      throw new Error('PostgreSQL role table privileges do not match the declared matrix');
    }

    const columnVerification = await client.query(
      `WITH expected AS (
         SELECT role_name, table_name, column_name, privilege, allowed
           FROM jsonb_to_recordset($1::jsonb)
                AS item(role_name text, table_name text, column_name text, privilege text, allowed boolean)
       )
       SELECT role_name, table_name, column_name, privilege
         FROM expected
        WHERE has_column_privilege(
                role_name,
                format('public.%I', table_name),
                column_name,
                privilege
              ) IS DISTINCT FROM allowed`,
      [JSON.stringify(expectedColumnChecks(rules))],
    );
    if ((columnVerification.rows || []).length > 0) {
      throw new Error('PostgreSQL role column privileges do not match the declared matrix');
    }

    const sequenceVerification = await client.query(
      `WITH expected AS (
         SELECT role_name, privilege, allowed
           FROM jsonb_to_recordset($1::jsonb)
                AS item(role_name text, privilege text, allowed boolean)
       ), sequences AS (
         SELECT sequence_name AS object_name
           FROM information_schema.sequences
          WHERE sequence_schema = 'public'
       )
       SELECT expected.role_name, sequences.object_name, expected.privilege
         FROM expected CROSS JOIN sequences
        WHERE has_sequence_privilege(
                expected.role_name,
                format('public.%I', sequences.object_name),
                expected.privilege
              ) IS DISTINCT FROM expected.allowed`,
      [JSON.stringify(expectedSequenceChecks(rules))],
    );
    if ((sequenceVerification.rows || []).length > 0) {
      throw new Error('PostgreSQL role sequence privileges do not match the declared matrix');
    }

    const schemaVerification = await client.query(
      `SELECT role_name,
              has_schema_privilege(role_name, 'public', 'USAGE') AS can_use,
              has_schema_privilege(role_name, 'public', 'CREATE') AS can_create
         FROM unnest($1::text[]) AS roles(role_name)`,
      [uniqueUsers],
    );
    const badSchema = (schemaVerification.rows || []).filter((row) => {
      const rule = rules.get(row.role_name);
      return !rule || row.can_use !== rule.schemaUsage || row.can_create === true;
    });
    if (badSchema.length > 0) throw new Error('PostgreSQL role schema privileges do not match the declared matrix');

    const databaseVerification = await client.query(
      `SELECT role_name,
              has_database_privilege(role_name, $1, 'CONNECT') AS can_connect
         FROM unnest($2::text[]) AS roles(role_name)`,
      [databaseName, uniqueUsers],
    );
    const badDatabase = (databaseVerification.rows || []).filter((row) => {
      const rule = rules.get(row.role_name);
      return !rule || row.can_connect !== rule.connect;
    });
    if (badDatabase.length > 0) throw new Error('PostgreSQL role database privileges do not match the declared matrix');

    const monitorRole = await client.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = 'pg_monitor'");
    if (monitorRole.rows?.[0]?.rolcanlogin !== false)
      throw new Error('PostgreSQL pg_monitor group role is unavailable');
    const membership = await client.query(
      `SELECT member.rolname AS role_name,
              pg_has_role(member.rolname, 'pg_monitor', 'member') AS is_member
         FROM pg_roles member
        WHERE member.rolname = ANY($1::text[])`,
      [uniqueUsers],
    );
    const badMembership = (membership.rows || []).filter((row) => {
      const rule = rules.get(row.role_name);
      return row.is_member !== Boolean(rule?.monitor);
    });
    if (badMembership.length > 0) {
      throw new Error('PostgreSQL monitor role membership does not match the declared matrix');
    }

    const unexpectedMembership = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent
         FROM pg_auth_members memberships
         JOIN pg_roles member ON member.oid = memberships.member
         JOIN pg_roles parent ON parent.oid = memberships.roleid
        WHERE member.rolname = ANY($1::text[])
          AND parent.rolname <> 'pg_monitor'`,
      [uniqueUsers],
    );
    if ((unexpectedMembership.rows || []).length > 0) {
      throw new Error('runtime PostgreSQL roles inherit an undeclared role');
    }

    return {
      appUser: roleUsers.api || undefined,
      roles: roleUsers,
      protectedTables: [...PROTECTED_SCHEMA_TABLES],
      requiredRoleTypes,
    };
  });
}

module.exports = {
  ALL_RELATIONS,
  ALL_TABLES,
  APPLICATION_TABLES,
  PROTECTED_SCHEMA_TABLES,
  ROLE_TYPES,
  enforceRuntimeRolePrivileges,
  quoteIdentifier,
};
