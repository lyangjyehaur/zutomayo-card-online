/** Immutable revision history for canonical cards and official-rulings candidates. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE official_qa_item_revisions (
      qa_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('backfill', 'insert', 'update', 'delete')),
      recorded_from TEXT NOT NULL DEFAULT 'trigger',
      release_id TEXT,
      number INTEGER NOT NULL,
      published_at DATE NOT NULL,
      question_ja TEXT NOT NULL,
      answer_ja TEXT NOT NULL,
      tags TEXT[] NOT NULL,
      related_card_ids TEXT[] NOT NULL,
      source_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_version INTEGER NOT NULL CHECK (content_version > 0),
      publication_status TEXT NOT NULL,
      source_updated_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL,
      source_created_at TIMESTAMPTZ NOT NULL,
      source_row_updated_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (qa_id, revision)
    );
    CREATE INDEX idx_official_qa_item_revisions_content
      ON official_qa_item_revisions(qa_id, content_version, recorded_at DESC);

    CREATE TABLE card_official_errata_revisions (
      errata_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('backfill', 'insert', 'update', 'delete')),
      recorded_from TEXT NOT NULL DEFAULT 'trigger',
      release_id TEXT,
      card_id TEXT NOT NULL,
      published_at DATE NOT NULL,
      card_number TEXT NOT NULL,
      incorrect_text TEXT NOT NULL,
      corrected_japanese_text TEXT NOT NULL,
      corrected_english_status TEXT NOT NULL,
      corrected_english_source TEXT NOT NULL,
      reason_ja TEXT NOT NULL,
      replacement_policy_ja TEXT NOT NULL,
      usage_policy_ja TEXT NOT NULL,
      affects_name BOOLEAN NOT NULL,
      affects_effect BOOLEAN NOT NULL,
      source_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_version INTEGER NOT NULL CHECK (content_version > 0),
      publication_status TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      source_row_updated_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (errata_id, revision)
    );
    CREATE INDEX idx_card_official_errata_revisions_content
      ON card_official_errata_revisions(errata_id, content_version, recorded_at DESC);

    CREATE TABLE card_revisions (
      card_id TEXT NOT NULL,
      revision BIGINT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('backfill', 'insert', 'update', 'delete')),
      name TEXT NOT NULL,
      en_name_official TEXT NOT NULL,
      pack TEXT NOT NULL,
      song TEXT,
      illustrator TEXT,
      rarity TEXT,
      element TEXT NOT NULL,
      type TEXT NOT NULL,
      clock INTEGER,
      attack_night INTEGER,
      attack_day INTEGER,
      power_cost INTEGER,
      send_to_power INTEGER,
      effect TEXT,
      en_effect_official TEXT NOT NULL,
      image TEXT,
      errata TEXT,
      has_official_errata BOOLEAN NOT NULL,
      official_errata_id TEXT,
      official_errata_affects_name BOOLEAN NOT NULL,
      official_errata_affects_effect BOOLEAN NOT NULL,
      official_errata_url TEXT NOT NULL,
      catalog_status TEXT NOT NULL,
      distribution_type TEXT NOT NULL,
      publication_status TEXT NOT NULL,
      play_status TEXT NOT NULL,
      play_status_reason TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_note TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      source_row_updated_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (card_id, revision)
    );
    CREATE INDEX idx_card_revisions_recorded
      ON card_revisions(card_id, recorded_at DESC);

    WITH release_versions AS (
      SELECT DISTINCT ON (snapshot.qa_id, snapshot.content_version, snapshot.content_hash)
             snapshot.*, release.created_at AS release_created_at
        FROM official_rulings_release_qa AS snapshot
        JOIN official_rulings_releases AS release ON release.id = snapshot.release_id
       ORDER BY snapshot.qa_id, snapshot.content_version, snapshot.content_hash, release.created_at, snapshot.release_id
    ), numbered AS (
      SELECT release_versions.*,
             ROW_NUMBER() OVER (PARTITION BY qa_id ORDER BY content_version, release_created_at, release_id) AS revision
        FROM release_versions
    )
    INSERT INTO official_qa_item_revisions (
      qa_id, revision, operation, recorded_from, release_id, number, published_at, question_ja, answer_ja,
      tags, related_card_ids, source_url, content_hash, content_version, publication_status,
      source_updated_at, last_seen_at, source_created_at, source_row_updated_at, recorded_at
    )
    SELECT qa_id, revision, 'backfill', 'release_snapshot', release_id, number, published_at, question_ja,
           answer_ja, tags, related_card_ids, source_url, content_hash, content_version, 'published', NULL,
           last_seen_at, release_created_at, release_created_at, release_created_at
      FROM numbered;

    INSERT INTO official_qa_item_revisions (
      qa_id, revision, operation, recorded_from, number, published_at, question_ja, answer_ja, tags,
      related_card_ids, source_url, content_hash, content_version, publication_status, source_updated_at,
      last_seen_at, source_created_at, source_row_updated_at, recorded_at
    )
    SELECT current.id, COALESCE(history.max_revision, 0) + 1, 'backfill', 'current_row', current.number,
           current.published_at, current.question_ja, current.answer_ja, current.tags, current.related_card_ids,
           current.source_url, current.content_hash, current.content_version, current.publication_status,
           current.source_updated_at, current.last_seen_at, current.created_at, current.updated_at, NOW()
      FROM official_qa_items AS current
      LEFT JOIN LATERAL (
        SELECT MAX(revision) AS max_revision FROM official_qa_item_revisions WHERE qa_id = current.id
      ) AS history ON TRUE;

    WITH release_versions AS (
      SELECT DISTINCT ON (snapshot.errata_id, snapshot.content_version, snapshot.content_hash)
             snapshot.*, release.created_at AS release_created_at
        FROM official_rulings_release_errata AS snapshot
        JOIN official_rulings_releases AS release ON release.id = snapshot.release_id
       ORDER BY snapshot.errata_id, snapshot.content_version, snapshot.content_hash, release.created_at, snapshot.release_id
    ), numbered AS (
      SELECT release_versions.*,
             ROW_NUMBER() OVER (PARTITION BY errata_id ORDER BY content_version, release_created_at, release_id) AS revision
        FROM release_versions
    )
    INSERT INTO card_official_errata_revisions (
      errata_id, revision, operation, recorded_from, release_id, card_id, published_at, card_number,
      incorrect_text, corrected_japanese_text, corrected_english_status, corrected_english_source, reason_ja,
      replacement_policy_ja, usage_policy_ja, affects_name, affects_effect, source_url, content_hash,
      content_version, publication_status, last_seen_at, source_row_updated_at, recorded_at
    )
    SELECT errata_id, revision, 'backfill', 'release_snapshot', release_id, card_id, published_at, card_number,
           incorrect_text, corrected_japanese_text, 'pending_review', 'release_snapshot_unavailable', reason_ja,
           replacement_policy_ja, usage_policy_ja, affects_name, affects_effect, source_url, content_hash,
           content_version, 'published', last_seen_at, release_created_at, release_created_at
      FROM numbered;

    INSERT INTO card_official_errata_revisions (
      errata_id, revision, operation, recorded_from, card_id, published_at, card_number, incorrect_text,
      corrected_japanese_text, corrected_english_status, corrected_english_source, reason_ja,
      replacement_policy_ja, usage_policy_ja, affects_name, affects_effect, source_url, content_hash,
      content_version, publication_status, last_seen_at, source_row_updated_at, recorded_at
    )
    SELECT current.errata_id, COALESCE(history.max_revision, 0) + 1, 'backfill', 'current_row', current.card_id,
           current.published_at, current.card_number, current.incorrect_text,
           CASE WHEN current.affects_name THEN card.name ELSE COALESCE(card.effect, '') END,
           current.corrected_english_status, current.corrected_english_source, current.reason_ja,
           current.replacement_policy_ja, current.usage_policy_ja, current.affects_name, current.affects_effect,
           current.source_url, current.content_hash, current.content_version, current.publication_status,
           current.last_seen_at, current.updated_at, NOW()
      FROM card_official_errata AS current
      JOIN cards AS card ON card.id = current.card_id
      LEFT JOIN LATERAL (
        SELECT MAX(revision) AS max_revision FROM card_official_errata_revisions WHERE errata_id = current.errata_id
      ) AS history ON TRUE;

    INSERT INTO card_revisions (
      card_id, revision, operation, name, en_name_official, pack, song, illustrator, rarity, element, type,
      clock, attack_night, attack_day, power_cost, send_to_power, effect, en_effect_official, image, errata,
      has_official_errata, official_errata_id, official_errata_affects_name, official_errata_affects_effect,
      official_errata_url, catalog_status, distribution_type, publication_status, play_status,
      play_status_reason, source_url, source_note, source_sha256, source_row_updated_at, recorded_at
    )
    SELECT id, 1, 'backfill', name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
           attack_night, attack_day, power_cost, send_to_power, effect, en_effect_official, image, errata,
           has_official_errata, official_errata_id, official_errata_affects_name, official_errata_affects_effect,
           official_errata_url, catalog_status, distribution_type, publication_status, play_status,
           play_status_reason, source_url, source_note, source_sha256, updated_at, NOW()
      FROM cards;

    CREATE FUNCTION reject_immutable_revision_mutation() RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog, public
    AS $$
    BEGIN
      RAISE EXCEPTION '% is immutable; % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
    END;
    $$;

    CREATE FUNCTION validate_official_qa_content_version() RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog, public
    AS $$
    DECLARE
      content_changed BOOLEAN;
    BEGIN
      content_changed := ROW(NEW.number, NEW.published_at, NEW.question_ja, NEW.answer_ja, NEW.tags,
                             NEW.related_card_ids)
                         IS DISTINCT FROM
                         ROW(OLD.number, OLD.published_at, OLD.question_ja, OLD.answer_ja, OLD.tags,
                             OLD.related_card_ids);
      IF content_changed OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
        IF content_changed AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash THEN
          RAISE EXCEPTION 'official Q&A % changed content requires a new content_hash', OLD.id
            USING ERRCODE = '23514';
        END IF;
        IF NEW.content_version <> OLD.content_version + 1 THEN
          RAISE EXCEPTION 'official Q&A % content_version must increase by exactly one', OLD.id
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.content_version IS DISTINCT FROM OLD.content_version THEN
        RAISE EXCEPTION 'official Q&A % content_version cannot change without content', OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION append_official_qa_item_revision() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
    AS $$
    DECLARE
      source official_qa_items%ROWTYPE;
      next_revision BIGINT;
    BEGIN
      IF TG_OP = 'UPDATE' AND
         ROW(NEW.number, NEW.published_at, NEW.question_ja, NEW.answer_ja, NEW.tags, NEW.related_card_ids,
             NEW.source_url, NEW.content_hash, NEW.content_version, NEW.publication_status, NEW.source_updated_at,
             NEW.created_at)
         IS NOT DISTINCT FROM
         ROW(OLD.number, OLD.published_at, OLD.question_ja, OLD.answer_ja, OLD.tags, OLD.related_card_ids,
             OLD.source_url, OLD.content_hash, OLD.content_version, OLD.publication_status, OLD.source_updated_at,
             OLD.created_at) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN source := OLD; ELSE source := NEW; END IF;
      SELECT COALESCE(MAX(revision), 0) + 1 INTO next_revision
        FROM official_qa_item_revisions WHERE qa_id = source.id;
      INSERT INTO official_qa_item_revisions (
        qa_id, revision, operation, recorded_from, number, published_at, question_ja, answer_ja, tags,
        related_card_ids, source_url, content_hash, content_version, publication_status, source_updated_at,
        last_seen_at, source_created_at, source_row_updated_at
      ) VALUES (
        source.id, next_revision, lower(TG_OP), 'trigger', source.number, source.published_at, source.question_ja,
        source.answer_ja, source.tags, source.related_card_ids, source.source_url, source.content_hash,
        source.content_version, source.publication_status, source.source_updated_at, source.last_seen_at,
        source.created_at, source.updated_at
      );
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$;

    CREATE FUNCTION validate_official_errata_content_version() RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog, public
    AS $$
    DECLARE
      content_changed BOOLEAN;
    BEGIN
      content_changed := ROW(NEW.card_id, NEW.published_at, NEW.card_number, NEW.incorrect_text, NEW.reason_ja,
                             NEW.replacement_policy_ja, NEW.usage_policy_ja, NEW.affects_name, NEW.affects_effect)
                         IS DISTINCT FROM
                         ROW(OLD.card_id, OLD.published_at, OLD.card_number, OLD.incorrect_text, OLD.reason_ja,
                             OLD.replacement_policy_ja, OLD.usage_policy_ja, OLD.affects_name, OLD.affects_effect);
      IF content_changed OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
        IF content_changed AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash THEN
          RAISE EXCEPTION 'official errata % changed content requires a new content_hash', OLD.errata_id
            USING ERRCODE = '23514';
        END IF;
        IF NEW.content_version <> OLD.content_version + 1 THEN
          RAISE EXCEPTION 'official errata % content_version must increase by exactly one', OLD.errata_id
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.content_version IS DISTINCT FROM OLD.content_version THEN
        RAISE EXCEPTION 'official errata % content_version cannot change without content', OLD.errata_id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION append_official_errata_revision() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
    AS $$
    DECLARE
      source card_official_errata%ROWTYPE;
      corrected_japanese TEXT;
      next_revision BIGINT;
    BEGIN
      IF TG_OP = 'UPDATE' AND
         ROW(NEW.card_id, NEW.published_at, NEW.card_number, NEW.incorrect_text, NEW.corrected_english_status,
             NEW.corrected_english_source, NEW.reason_ja, NEW.replacement_policy_ja, NEW.usage_policy_ja,
             NEW.affects_name, NEW.affects_effect, NEW.source_url, NEW.content_hash, NEW.content_version,
             NEW.publication_status)
         IS NOT DISTINCT FROM
         ROW(OLD.card_id, OLD.published_at, OLD.card_number, OLD.incorrect_text, OLD.corrected_english_status,
             OLD.corrected_english_source, OLD.reason_ja, OLD.replacement_policy_ja, OLD.usage_policy_ja,
             OLD.affects_name, OLD.affects_effect, OLD.source_url, OLD.content_hash, OLD.content_version,
             OLD.publication_status) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN source := OLD; ELSE source := NEW; END IF;
      SELECT CASE WHEN source.affects_name THEN card.name ELSE COALESCE(card.effect, '') END
        INTO corrected_japanese FROM cards AS card WHERE card.id = source.card_id;
      IF corrected_japanese IS NULL THEN
        SELECT corrected_japanese_text INTO corrected_japanese
          FROM card_official_errata_revisions
         WHERE errata_id = source.errata_id
         ORDER BY revision DESC LIMIT 1;
      END IF;
      IF corrected_japanese IS NULL THEN corrected_japanese := ''; END IF;
      SELECT COALESCE(MAX(revision), 0) + 1 INTO next_revision
        FROM card_official_errata_revisions WHERE errata_id = source.errata_id;
      INSERT INTO card_official_errata_revisions (
        errata_id, revision, operation, recorded_from, card_id, published_at, card_number, incorrect_text,
        corrected_japanese_text, corrected_english_status, corrected_english_source, reason_ja,
        replacement_policy_ja, usage_policy_ja, affects_name, affects_effect, source_url, content_hash,
        content_version, publication_status, last_seen_at, source_row_updated_at
      ) VALUES (
        source.errata_id, next_revision, lower(TG_OP), 'trigger', source.card_id, source.published_at,
        source.card_number, source.incorrect_text, corrected_japanese, source.corrected_english_status,
        source.corrected_english_source, source.reason_ja, source.replacement_policy_ja, source.usage_policy_ja,
        source.affects_name, source.affects_effect, source.source_url, source.content_hash, source.content_version,
        source.publication_status, source.last_seen_at, source.updated_at
      );
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$;

    CREATE FUNCTION append_derived_errata_revision_for_card() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
    AS $$
    DECLARE
      source card_official_errata%ROWTYPE;
      next_revision BIGINT;
    BEGIN
      IF NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.effect IS NOT DISTINCT FROM OLD.effect THEN
        RETURN NEW;
      END IF;
      FOR source IN
        SELECT * FROM card_official_errata
         WHERE card_id = NEW.id
           AND ((affects_name AND NEW.name IS DISTINCT FROM OLD.name)
             OR (affects_effect AND NEW.effect IS DISTINCT FROM OLD.effect))
      LOOP
        SELECT COALESCE(MAX(revision), 0) + 1 INTO next_revision
          FROM card_official_errata_revisions WHERE errata_id = source.errata_id;
        INSERT INTO card_official_errata_revisions (
          errata_id, revision, operation, recorded_from, card_id, published_at, card_number, incorrect_text,
          corrected_japanese_text, corrected_english_status, corrected_english_source, reason_ja,
          replacement_policy_ja, usage_policy_ja, affects_name, affects_effect, source_url, content_hash,
          content_version, publication_status, last_seen_at, source_row_updated_at
        ) VALUES (
          source.errata_id, next_revision, 'update', 'card_trigger', source.card_id, source.published_at,
          source.card_number, source.incorrect_text,
          CASE WHEN source.affects_name THEN NEW.name ELSE COALESCE(NEW.effect, '') END,
          source.corrected_english_status, source.corrected_english_source, source.reason_ja,
          source.replacement_policy_ja, source.usage_policy_ja, source.affects_name, source.affects_effect,
          source.source_url, source.content_hash, source.content_version, source.publication_status,
          source.last_seen_at, source.updated_at
        );
      END LOOP;
      RETURN NEW;
    END;
    $$;

    CREATE FUNCTION append_card_revision() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
    AS $$
    DECLARE
      source cards%ROWTYPE;
      next_revision BIGINT;
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND
         ROW(NEW.name, NEW.en_name_official, NEW.pack, NEW.song, NEW.illustrator, NEW.rarity, NEW.element,
             NEW.type, NEW.clock, NEW.attack_night, NEW.attack_day, NEW.power_cost, NEW.send_to_power,
             NEW.effect, NEW.en_effect_official, NEW.image, NEW.errata, NEW.has_official_errata,
             NEW.official_errata_id, NEW.official_errata_affects_name, NEW.official_errata_affects_effect,
             NEW.official_errata_url, NEW.catalog_status, NEW.distribution_type, NEW.publication_status,
             NEW.play_status, NEW.play_status_reason, NEW.source_url, NEW.source_note, NEW.source_sha256)
         IS NOT DISTINCT FROM
         ROW(OLD.name, OLD.en_name_official, OLD.pack, OLD.song, OLD.illustrator, OLD.rarity, OLD.element,
             OLD.type, OLD.clock, OLD.attack_night, OLD.attack_day, OLD.power_cost, OLD.send_to_power,
             OLD.effect, OLD.en_effect_official, OLD.image, OLD.errata, OLD.has_official_errata,
             OLD.official_errata_id, OLD.official_errata_affects_name, OLD.official_errata_affects_effect,
             OLD.official_errata_url, OLD.catalog_status, OLD.distribution_type, OLD.publication_status,
             OLD.play_status, OLD.play_status_reason, OLD.source_url, OLD.source_note, OLD.source_sha256) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN source := OLD; ELSE source := NEW; END IF;
      SELECT COALESCE(MAX(revision), 0) + 1 INTO next_revision
        FROM card_revisions WHERE card_id = source.id;
      INSERT INTO card_revisions (
        card_id, revision, operation, name, en_name_official, pack, song, illustrator, rarity, element, type,
        clock, attack_night, attack_day, power_cost, send_to_power, effect, en_effect_official, image, errata,
        has_official_errata, official_errata_id, official_errata_affects_name, official_errata_affects_effect,
        official_errata_url, catalog_status, distribution_type, publication_status, play_status,
        play_status_reason, source_url, source_note, source_sha256, source_row_updated_at
      ) VALUES (
        source.id, next_revision, lower(TG_OP), source.name, source.en_name_official, source.pack, source.song,
        source.illustrator, source.rarity, source.element, source.type, source.clock, source.attack_night,
        source.attack_day, source.power_cost, source.send_to_power, source.effect, source.en_effect_official,
        source.image, source.errata, source.has_official_errata, source.official_errata_id,
        source.official_errata_affects_name, source.official_errata_affects_effect, source.official_errata_url,
        source.catalog_status, source.distribution_type, source.publication_status, source.play_status,
        source.play_status_reason, source.source_url, source.source_note, source.source_sha256, source.updated_at
      );
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$;

    CREATE TRIGGER official_qa_content_version_guard
      BEFORE UPDATE ON official_qa_items FOR EACH ROW EXECUTE FUNCTION validate_official_qa_content_version();
    CREATE TRIGGER official_qa_revision_append
      AFTER INSERT OR UPDATE OR DELETE ON official_qa_items FOR EACH ROW EXECUTE FUNCTION append_official_qa_item_revision();
    CREATE TRIGGER official_errata_content_version_guard
      BEFORE UPDATE ON card_official_errata FOR EACH ROW EXECUTE FUNCTION validate_official_errata_content_version();
    CREATE TRIGGER official_errata_revision_append
      AFTER INSERT OR UPDATE OR DELETE ON card_official_errata FOR EACH ROW EXECUTE FUNCTION append_official_errata_revision();
    CREATE TRIGGER card_revision_append
      AFTER INSERT OR UPDATE OR DELETE ON cards FOR EACH ROW EXECUTE FUNCTION append_card_revision();
    CREATE TRIGGER card_derived_errata_revision_append
      AFTER UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION append_derived_errata_revision_for_card();

    CREATE TRIGGER official_qa_item_revisions_immutable
      BEFORE UPDATE OR DELETE ON official_qa_item_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_revision_mutation();
    CREATE TRIGGER card_official_errata_revisions_immutable
      BEFORE UPDATE OR DELETE ON card_official_errata_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_revision_mutation();
    CREATE TRIGGER card_revisions_immutable
      BEFORE UPDATE OR DELETE ON card_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_revision_mutation();
  `);
};

export const down = false;
