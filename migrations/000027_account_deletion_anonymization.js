/** Make retained operational/audit rows safe for account erasure. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    DO $account_deletion_anonymization$
    BEGIN
      IF EXISTS (SELECT 1 FROM users WHERE deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION
          '000027 requires a reviewed legacy tombstone backfill before migration; deleted users still exist';
      END IF;
    END
    $account_deletion_anonymization$;

    ALTER TABLE season_match_results
      ALTER COLUMN winner_user_id DROP NOT NULL,
      ALTER COLUMN loser_user_id DROP NOT NULL;

    ALTER TABLE account_export_jobs
      ALTER COLUMN user_id DROP NOT NULL;

    ALTER TABLE account_export_audit
      ALTER COLUMN user_id DROP NOT NULL;
  `);

  pgm.dropConstraint('account_export_jobs', 'account_export_jobs_user_id_fkey', { ifExists: true });
  pgm.addConstraint('account_export_jobs', 'account_export_jobs_user_id_fkey', {
    foreignKeys: {
      columns: 'user_id',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
  });

  pgm.addColumns('season_match_results', { identity_anonymized_at: { type: 'timestamptz' } }, { ifNotExists: true });
  pgm.addColumns('account_export_jobs', { identity_anonymized_at: { type: 'timestamptz' } }, { ifNotExists: true });
  pgm.addColumns('account_export_audit', { identity_anonymized_at: { type: 'timestamptz' } }, { ifNotExists: true });
  pgm.addColumns('admin_audit_log', { identity_anonymized_at: { type: 'timestamptz' } }, { ifNotExists: true });
  pgm.addColumns(
    'account_deletion_requests',
    { identity_anonymized_at: { type: 'timestamptz' } },
    { ifNotExists: true },
  );
  pgm.addColumns(
    'relationship_change_outbox',
    { identities_redacted_at: { type: 'timestamptz' } },
    { ifNotExists: true },
  );
  pgm.createIndex('season_match_results', ['winner_user_id'], {
    ifNotExists: true,
    name: 'idx_season_match_results_winner_user',
    where: 'winner_user_id IS NOT NULL',
  });
  pgm.createIndex('season_match_results', ['loser_user_id'], {
    ifNotExists: true,
    name: 'idx_season_match_results_loser_user',
    where: 'loser_user_id IS NOT NULL',
  });
  pgm.createIndex('account_deletion_requests', ['user_id'], {
    ifNotExists: true,
    name: 'idx_account_deletion_requests_user_all',
  });
  pgm.createIndex('relationship_change_outbox', ['user_ids'], {
    ifNotExists: true,
    name: 'idx_relationship_change_outbox_user_ids',
    method: 'gin',
  });
  pgm.createIndex('admin_audit_log', ['target_id'], {
    ifNotExists: true,
    name: 'idx_admin_audit_log_target_id',
    where: 'target_id IS NOT NULL',
  });
  pgm.createIndex('bjg_matches', ['updated_at'], {
    ifNotExists: true,
    name: 'idx_bjg_matches_updated_at',
  });
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_bjg_matches_game_name
      ON bjg_matches ((metadata->>'gameName'));
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.zutomayo_anonymize_account_export_audit(p_user_id TEXT)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      affected INTEGER;
    BEGIN
      IF COALESCE(p_user_id, '') = '' THEN
        RAISE EXCEPTION 'account export audit anonymization requires a user id';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.users
         WHERE id = p_user_id
           AND deleted_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'account export audit anonymization requires a deleted account';
      END IF;
      UPDATE public.account_export_audit
         SET user_id = NULL,
             request_id = NULL,
             identity_anonymized_at = COALESCE(identity_anonymized_at, NOW()),
             details = '{}'::jsonb
       WHERE user_id = p_user_id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      RETURN affected;
    END
    $function$;

    CREATE OR REPLACE FUNCTION public.zutomayo_anonymize_admin_audit_identity(
      p_user_id TEXT,
      p_replacement TEXT
    )
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      affected INTEGER;
    BEGIN
      IF COALESCE(p_user_id, '') = ''
         OR COALESCE(p_replacement, '') !~ '^deleted-admin-audit-[a-f0-9]{32}$' THEN
        RAISE EXCEPTION 'admin audit anonymization input is invalid';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.users
         WHERE id = p_user_id
           AND deleted_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'admin audit anonymization requires a deleted account';
      END IF;
      UPDATE public.admin_audit_log
         SET target_id = CASE
               WHEN target_id IS NULL THEN NULL
               ELSE replace(target_id, p_user_id, p_replacement)
             END,
             details = '{}'::jsonb,
             identity_anonymized_at = COALESCE(identity_anonymized_at, NOW())
       WHERE strpos(COALESCE(target_id, ''), p_user_id) > 0
          OR strpos(COALESCE(details::text, ''), p_user_id) > 0;
      GET DIAGNOSTICS affected = ROW_COUNT;
      RETURN affected;
    END
    $function$;

    REVOKE ALL ON FUNCTION public.zutomayo_anonymize_account_export_audit(TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.zutomayo_anonymize_admin_audit_identity(TEXT, TEXT) FROM PUBLIC;
  `);
};

// Privacy erasure is forward-only. Rolling back would make future deletions
// retain identifiers again and could invalidate already anonymized rows.
export const down = false;
