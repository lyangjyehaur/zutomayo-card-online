/** Allow official rule chapter and section headings to be structural nodes without invented summary text. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE constraint_name text;
    BEGIN
      SELECT conname INTO constraint_name
        FROM pg_constraint
       WHERE conrelid = 'official_rule_sections'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%body_ja%';
      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE official_rule_sections DROP CONSTRAINT %I', constraint_name);
      END IF;
    END $$;

    ALTER TABLE official_rule_sections
      ADD CONSTRAINT official_rule_sections_content_check
      CHECK (
        section_id <> '' AND level BETWEEN 1 AND 4 AND sort_order >= 0
        AND page_start > 0 AND page_end >= page_start AND title_ja <> ''
        AND content_hash ~ '^[a-f0-9]{64}$'
      );

    DO $$
    DECLARE constraint_name text;
    BEGIN
      SELECT conname INTO constraint_name
        FROM pg_constraint
       WHERE conrelid = 'official_rule_section_translations'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%body_text%';
      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE official_rule_section_translations DROP CONSTRAINT %I', constraint_name);
      END IF;
    END $$;

    ALTER TABLE official_rule_section_translations
      ADD CONSTRAINT official_rule_section_translations_content_check
      CHECK (
        locale IN ('zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko')
        AND title_text <> ''
        AND status IN ('pending_review', 'machine', 'verified', 'failed')
      );
  `);
};

export const down = false;
