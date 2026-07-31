import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

describe('match analytics query pack', () => {
  it('covers the MA-08 dimensions, confidence intervals, and publication threshold', () => {
    const sql = readRepoFile('scripts/analytics/match-analytics-core.sql');

    expect(sql).toContain('seat_classes');
    expect(sql).toContain('connection_class');
    expect(sql).toContain("'seat_0_win'::text AS metric");
    expect(sql).toContain("'janken_winner_win'::text AS metric");
    expect(sql).toContain('gameover_reason_code');
    expect(sql).toContain('LEAST(seat0.deck_hash, seat1.deck_hash) AS deck_a_hash');
    expect(sql).toContain('GREATEST(seat0.deck_hash, seat1.deck_hash) AS deck_b_hash');
    expect(sql.match(/CASE WHEN sample_size >= 100 THEN 'publishable'/g)).toHaveLength(3);
    expect(sql.match(/wilson_lower_95/g)).toHaveLength(4);
    expect(sql.match(/wilson_upper_95/g)).toHaveLength(4);
  });

  it('runs guarded disposable fixtures and compares reviewed PostgreSQL results', () => {
    const fixture = readRepoFile('scripts/analytics/match-analytics-fixture.sql');
    const expected = readRepoFile('scripts/analytics/match-analytics-expected.csv');
    const smoke = readRepoFile('scripts/postgres-role-smoke.sh');

    expect(fixture).toContain("current_database() !~ '(role_smoke|fixture|test)'");
    expect(fixture).toContain('generate_series(1, 100)');
    expect(fixture).toContain("ARRAY['timeout-heavy']");
    expect(expected).toContain(',publishable');
    expect(expected).toContain(',insufficient_sample');
    expect(expected).not.toContain('expected-output-pending');
    expect(smoke).toContain('< scripts/analytics/match-analytics-fixture.sql');
    expect(smoke).toContain('< scripts/analytics/match-analytics-core.sql');
    expect(smoke).toContain('diff -u scripts/analytics/match-analytics-expected.csv');
  });
});
