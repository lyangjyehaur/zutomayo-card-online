import { createRequire } from 'node:module';
import {
  loadReviewedUnlistedRelease,
  REVIEWED_UNLISTED_LANGS,
  REVIEWED_UNLISTED_SOURCE_NOTE,
} from './reviewedUnlistedCardRelease';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

const release = loadReviewedUnlistedRelease(
  process.env.CARD_UNLISTED_SOURCES_SOURCE || 'data/card-unlisted-sources.json',
  process.env.CARD_UNLISTED_HUMAN_REVIEWS_SOURCE || 'data/card-unlisted-human-reviews.json',
  process.env.CARD_UNLISTED_RELEASE_SOURCE || 'data/card-unlisted-release.json',
);
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

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('reviewed-unlisted-card-release'))");
    for (const card of release.cards) {
      await client.query(
        `INSERT INTO cards (
           id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
           attack_night, attack_day, power_cost, send_to_power, effect, en_effect_official, image, errata,
           has_official_errata, official_errata_id, official_errata_affects_name,
           official_errata_affects_effect, official_errata_url,
           catalog_status, distribution_type, publication_status, play_status, play_status_reason,
           source_url, source_note, source_sha256
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, '',
           FALSE, NULL, FALSE, FALSE, '', $18, $19, 'published', 'playable', $20, $21, $22, $23
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, en_name_official = EXCLUDED.en_name_official, pack = EXCLUDED.pack,
           song = EXCLUDED.song, illustrator = EXCLUDED.illustrator, rarity = EXCLUDED.rarity,
           element = EXCLUDED.element, type = EXCLUDED.type, clock = EXCLUDED.clock,
           attack_night = EXCLUDED.attack_night, attack_day = EXCLUDED.attack_day,
           power_cost = EXCLUDED.power_cost, send_to_power = EXCLUDED.send_to_power,
           effect = EXCLUDED.effect, en_effect_official = EXCLUDED.en_effect_official, image = EXCLUDED.image,
           errata = '', has_official_errata = FALSE, official_errata_id = NULL,
           official_errata_affects_name = FALSE, official_errata_affects_effect = FALSE,
           official_errata_url = '',
           catalog_status = EXCLUDED.catalog_status, distribution_type = EXCLUDED.distribution_type,
           publication_status = EXCLUDED.publication_status, play_status = EXCLUDED.play_status,
           play_status_reason = EXCLUDED.play_status_reason, source_url = EXCLUDED.source_url,
           source_note = EXCLUDED.source_note, source_sha256 = EXCLUDED.source_sha256, updated_at = NOW()`,
        [
          card.id,
          card.name,
          card.enNameOfficial,
          card.pack,
          card.song,
          card.illustrator,
          card.rarity,
          card.element,
          card.type,
          card.clock,
          card.attack?.night ?? null,
          card.attack?.day ?? null,
          card.powerCost,
          card.sendToPower,
          card.effect,
          card.enEffectOfficial,
          card.image,
          card.catalogStatus,
          card.distributionType,
          card.playStatusReason,
          card.sourceUrl,
          REVIEWED_UNLISTED_SOURCE_NOTE,
          card.sourceSha256,
        ],
      );
      for (const lang of REVIEWED_UNLISTED_LANGS) {
        const translation = card.translations[lang];
        await client.query(
          `INSERT INTO card_texts_i18n (
             card_id, lang, name_text, effect_text, name_source, effect_source, review_status, review_note
           ) VALUES ($1, $2, $3, $4, $5, $5, 'verified', $6)
           ON CONFLICT (card_id, lang) DO UPDATE SET
             name_text = EXCLUDED.name_text, effect_text = EXCLUDED.effect_text,
             name_source = EXCLUDED.name_source, effect_source = EXCLUDED.effect_source,
             review_status = 'verified', review_note = EXCLUDED.review_note, updated_at = NOW()`,
          [
            card.id,
            lang,
            translation.name,
            translation.effect,
            REVIEWED_UNLISTED_SOURCE_NOTE,
            `Reviewed unlisted card release ${release.sourceSha256}; card review ${card.reviewedAt}`,
          ],
        );
      }
    }

    const verification = await client.query(
      `SELECT cards.id, cards.source_note,
              COUNT(texts.lang)::integer AS verified_translation_count
       FROM cards
       LEFT JOIN card_texts_i18n AS texts
         ON texts.card_id = cards.id
        AND texts.lang = ANY($2::text[])
        AND texts.review_status = 'verified'
        AND NULLIF(BTRIM(texts.name_text), '') IS NOT NULL
        AND NULLIF(BTRIM(texts.effect_text), '') IS NOT NULL
       WHERE cards.id = ANY($1::text[])
         AND cards.publication_status = 'published'
         AND cards.play_status = 'playable'
       GROUP BY cards.id, cards.source_note
       ORDER BY cards.id`,
      [release.cards.map((card) => card.id), [...REVIEWED_UNLISTED_LANGS]],
    );
    if (
      verification.rows.length !== release.cards.length ||
      verification.rows.some(
        (row) =>
          String(row.source_note) !== REVIEWED_UNLISTED_SOURCE_NOTE ||
          Number(row.verified_translation_count) !== REVIEWED_UNLISTED_LANGS.length,
      )
    ) {
      throw new Error('post-write verification failed for reviewed unlisted cards');
    }

    await client.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
       VALUES ($1, 'release_reviewed_unlisted_cards', 'cards', $2, $3::jsonb)`,
      [
        process.env.CARD_I18N_IMPORT_ADMIN_USER_ID || null,
        release.sourceSha256,
        JSON.stringify({
          reviewedAt: release.reviewedAt,
          sourceNote: REVIEWED_UNLISTED_SOURCE_NOTE,
          cards: release.cards.map((card) => card.id),
          languages: REVIEWED_UNLISTED_LANGS,
        }),
      ],
    );
    await client.query('COMMIT');
    console.log(`Released ${release.cards.length} reviewed unlisted cards (${release.sourceSha256}).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
