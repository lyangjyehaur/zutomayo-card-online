/** Store completed-match replay summaries separately from live boardgame state. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumn('matches', {
    replay_summary: { type: 'jsonb' },
  });
  pgm.addConstraint('matches', 'ck_matches_replay_summary_object', {
    check: `replay_summary IS NULL OR jsonb_typeof(replay_summary) = 'object'`,
  });
};

export const down = false;
