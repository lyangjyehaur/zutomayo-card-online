/** Track official cards that are not yet represented in the public gallery. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns('cards', {
    catalog_status: { type: 'text', notNull: true, default: 'listed' },
    distribution_type: { type: 'text', notNull: true, default: 'standard' },
    publication_status: { type: 'text', notNull: true, default: 'published' },
    play_status: { type: 'text', notNull: true, default: 'playable' },
    play_status_reason: { type: 'text', notNull: true, default: '' },
    source_url: { type: 'text', notNull: true, default: '' },
    source_note: { type: 'text', notNull: true, default: '' },
    source_sha256: { type: 'text', notNull: true, default: '' },
  });

  pgm.addConstraint('cards', 'cards_catalog_status_check', {
    check: "catalog_status IN ('listed', 'pending_listing', 'unlisted')",
  });
  pgm.addConstraint('cards', 'cards_distribution_type_check', {
    check: "distribution_type IN ('standard', 'bonus', 'collaboration', 'live', 'event', 'regional')",
  });
  pgm.addConstraint('cards', 'cards_publication_status_check', {
    check: "publication_status IN ('draft', 'reviewed', 'published', 'retired')",
  });
  pgm.addConstraint('cards', 'cards_play_status_check', {
    check: "play_status IN ('playable', 'display_only', 'disabled')",
  });
  pgm.addConstraint('cards', 'cards_source_sha256_check', {
    check: "source_sha256 = '' OR source_sha256 ~ '^[a-f0-9]{64}$'",
  });
  pgm.createIndex('cards', ['publication_status', 'play_status'], {
    name: 'idx_cards_public_game_pool',
  });
  pgm.createIndex('cards', ['catalog_status', 'distribution_type'], {
    name: 'idx_cards_catalog_source',
  });
};

export const down = false;
