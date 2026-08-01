/** Add bounded, identity-free connection lifecycle evidence to runtime telemetry. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns('bjg_match_telemetry', {
    connection_events: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    player0_disconnected_at: { type: 'timestamptz' },
    player1_disconnected_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('bjg_match_telemetry', 'bjg_match_telemetry_connection_events_check', {
    check: "jsonb_typeof(connection_events) = 'array' AND jsonb_array_length(connection_events) <= 100",
  });
};

export const down = false;
