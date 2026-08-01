/** Record immutable bindings between signed releases and reviewed card datasets. */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable(
    'official_card_data_releases',
    {
      dataset_sha256: { type: 'text', primaryKey: true },
      extraction_sha256: { type: 'text', notNull: true },
      errata_sha256: { type: 'text', notNull: true },
      review_provenance_sha256: { type: 'text', notNull: true },
      release_sha: { type: 'text', notNull: true },
      card_count: { type: 'integer', notNull: true },
      errata_count: { type: 'integer', notNull: true },
      applied_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          "dataset_sha256 ~ '^[a-f0-9]{64}$'",
          "extraction_sha256 ~ '^[a-f0-9]{64}$'",
          "errata_sha256 ~ '^[a-f0-9]{64}$'",
          "review_provenance_sha256 ~ '^[a-f0-9]{64}$'",
          "release_sha ~ '^[a-f0-9]{40}$'",
          'card_count > 0',
          'errata_count >= 0',
          'errata_count <= card_count',
        ],
      },
    },
  );
};

export const down = false;
