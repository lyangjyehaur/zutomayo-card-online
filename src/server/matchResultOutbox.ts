import crypto from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface MatchResultOutboxRow extends QueryResultRow {
  source_match_id: string;
  player0_user_id: string | null;
  player1_user_id: string | null;
  winner_player: 0 | 1 | null;
  winner_user_id: string | null;
  loser_user_id: string | null;
  ranked_eligible: boolean;
  turns: number;
  duration_seconds: number;
  action_log: unknown[];
  state_id: number | null;
  status: 'pending' | 'processing';
  attempt_count: number;
}

interface UserRatingRow extends QueryResultRow {
  id: string;
  elo: number;
}

interface SeasonRow extends QueryResultRow {
  id: string;
  starting_rating: number;
  placement_matches: number;
}

interface SeasonRatingRow extends QueryResultRow {
  user_id: string;
  rating: number;
  match_count: number;
}

export interface ProcessMatchResultOutboxOptions {
  pool: Pool;
  batchSize?: number;
  staleLockMs?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  generateMatchId?: () => string;
}

export interface MatchResultOutboxBatchResult {
  claimed: number;
  delivered: number;
  retried: number;
}

export interface MatchResultOutboxWorker {
  runOnce(): Promise<MatchResultOutboxBatchResult>;
  stop(): Promise<void>;
}

function calculateElo(ratingA: number, ratingB: number, scoreA: number): number {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + 32 * (scoreA - expectedA));
}

type ActionLogRecord = Record<string, unknown>;

function asActionLogRecord(value: unknown): ActionLogRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ActionLogRecord) : {};
}

function finiteActionLogNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function optionalActionLogString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 120) : undefined;
}

function sanitizeActionLogPayload(action: string, payload: unknown): ActionLogRecord {
  const data = asActionLogRecord(payload);
  if (action === 'janken') {
    return ['rock', 'paper', 'scissors'].includes(String(data.choice)) ? { choice: data.choice } : {};
  }
  if (action === 'mulligan') {
    return { redrawnCount: Math.max(0, Math.trunc(finiteActionLogNumber(data.redrawnCount))) };
  }
  if (action === 'setInitialCard') return { slot: 'A', faceDown: true };
  if (action === 'setTurnCard') return { slot: data.slot === 'B' ? 'B' : 'A', faceDown: true };
  if (action === 'confirmReady') return { confirmed: true };
  if (action === 'chooseEffectOrder' || action === 'resolvePendingEffect') {
    const clean: ActionLogRecord = { index: Math.max(0, Math.trunc(finiteActionLogNumber(data.index))) };
    for (const key of ['effectId', 'cardDefId', 'source', 'trigger', 'actionType']) {
      const value = optionalActionLogString(data[key]);
      if (value) clean[key] = value;
    }
    return clean;
  }
  if (action === 'submitPendingChoice') {
    const clean: ActionLogRecord = {
      selectedCount: Math.max(0, Math.trunc(finiteActionLogNumber(data.selectedCount))),
      min: Math.max(0, Math.trunc(finiteActionLogNumber(data.min))),
      max: Math.max(0, Math.trunc(finiteActionLogNumber(data.max))),
    };
    for (const key of [
      'choiceId',
      'choiceType',
      'sourceZone',
      'destinationZone',
      'destinationPosition',
      'effectLabel',
    ]) {
      const value = optionalActionLogString(data[key]);
      if (value) clean[key] = value;
    }
    for (const key of ['sourcePlayer', 'destinationPlayer', 'targetPlayer', 'drawCount', 'followUpDrawCount']) {
      if (data[key] !== undefined) clean[key] = Math.max(0, Math.trunc(finiteActionLogNumber(data[key])));
    }
    if (data.faceDown !== undefined) clean.faceDown = Boolean(data.faceDown);
    if (data.shuffle !== undefined) clean.shuffle = Boolean(data.shuffle);
    return clean;
  }
  if (action === 'gameOver') {
    const clean: ActionLogRecord = { draw: Boolean(data.draw) };
    if (data.winner === 0 || data.winner === 1 || data.winner === null) clean.winner = data.winner;
    const reason = optionalActionLogString(data.reason);
    if (reason) clean.reason = reason;
    return clean;
  }
  return {};
}

function sanitizeActionLogResult(value: unknown): ActionLogRecord | undefined {
  const result = asActionLogRecord(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const clean: ActionLogRecord = { ok: Boolean(result.ok) };
  const message = optionalActionLogString(result.message);
  if (message) clean.message = message;
  return clean;
}

/**
 * Keep the server-authored history useful without persisting hidden card or
 * arbitrary client payload fields into the public match record.
 */
export function sanitizeCanonicalActionLog(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is ActionLogRecord => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .map((entry) => {
      const action = optionalActionLogString(entry.action) || 'unknown';
      const clean: ActionLogRecord = {
        turn: Math.max(0, Math.trunc(finiteActionLogNumber(entry.turn))),
        step: optionalActionLogString(entry.step) || 'unknown',
        player: Number(entry.player) === 1 ? 1 : 0,
        action,
        timestamp: Math.max(0, Math.trunc(finiteActionLogNumber(entry.timestamp, Date.now()))),
      };
      if (entry.id !== undefined) clean.id = Math.max(0, Math.trunc(finiteActionLogNumber(entry.id)));
      if (entry.chronosPosition !== undefined)
        clean.chronosPosition = Math.max(0, Math.trunc(finiteActionLogNumber(entry.chronosPosition)));
      if (Array.isArray(entry.hp) && entry.hp.length === 2) {
        clean.hp = [Math.trunc(finiteActionLogNumber(entry.hp[0])), Math.trunc(finiteActionLogNumber(entry.hp[1]))];
      }
      const pendingEffectCardDefId = optionalActionLogString(entry.pendingEffectCardDefId);
      if (pendingEffectCardDefId) clean.pendingEffectCardDefId = pendingEffectCardDefId;
      const pendingChoiceType = optionalActionLogString(entry.pendingChoiceType);
      if (pendingChoiceType) clean.pendingChoiceType = pendingChoiceType;
      const result = sanitizeActionLogResult(entry.result);
      if (result) clean.result = result;
      const payload = sanitizeActionLogPayload(action, entry.payload);
      if (Object.keys(payload).length > 0) clean.payload = payload;
      return clean;
    });
}

export function matchResultRetryDelayMs(attemptCount: number, baseRetryMs = 1_000, maxRetryMs = 5 * 60 * 1000): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 20));
  return Math.min(maxRetryMs, baseRetryMs * 2 ** exponent);
}

async function claimOutboxRows(pool: Pool, batchSize: number, staleLockMs: number): Promise<MatchResultOutboxRow[]> {
  const result = await pool.query<MatchResultOutboxRow>(
    `WITH candidates AS (
       SELECT source_match_id
         FROM bjg_match_result_outbox
        WHERE (status = 'pending' AND next_attempt_at <= NOW())
           OR (status = 'processing' AND locked_at < NOW() - ($2 * INTERVAL '1 millisecond'))
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE bjg_match_result_outbox AS outbox
        SET status = 'processing',
            attempt_count = outbox.attempt_count + 1,
            locked_at = NOW(),
            updated_at = NOW()
       FROM candidates
      WHERE outbox.source_match_id = candidates.source_match_id
      RETURNING outbox.*`,
    [batchSize, staleLockMs],
  );
  return result.rows;
}

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply a delivered ranked result to the active season while the match
 * delivery transaction is still open. Keeping this on the same client means
 * a retry can never expose a delivered match without its season rating.
 */
async function recordSeasonResultInTransaction(
  client: PoolClient,
  sourceMatchId: string,
  winnerId: string,
  loserId: string,
): Promise<void> {
  const season = (
    await client.query<SeasonRow>(
      `SELECT id, starting_rating, placement_matches
         FROM seasons
        WHERE status = 'active' AND starts_at <= NOW() AND ends_at > NOW()
        FOR UPDATE`,
    )
  ).rows[0];
  if (!season) return;

  const existing = (
    await client.query<{ winner_delta: number; loser_delta: number }>(
      `SELECT winner_delta, loser_delta
         FROM season_match_results
        WHERE season_id = $1 AND source_match_id = $2`,
      [season.id, sourceMatchId],
    )
  ).rows[0];
  if (existing) return;

  for (const userId of [winnerId, loserId]) {
    await client.query(
      `INSERT INTO season_ratings (season_id, user_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (season_id, user_id) DO NOTHING`,
      [season.id, userId, season.starting_rating],
    );
  }

  const ratings = (
    await client.query<SeasonRatingRow>(
      `SELECT user_id, rating, match_count
         FROM season_ratings
        WHERE season_id = $1 AND user_id IN ($2, $3)
        ORDER BY user_id
        FOR UPDATE`,
      [season.id, winnerId, loserId],
    )
  ).rows;
  const winner = ratings.find((rating) => rating.user_id === winnerId);
  const loser = ratings.find((rating) => rating.user_id === loserId);
  if (!winner || !loser) throw new Error('Season rating rows missing');

  const winnerNext = calculateElo(Number(winner.rating), Number(loser.rating), 1);
  const loserNext = calculateElo(Number(loser.rating), Number(winner.rating), 0);
  const winnerDelta = winnerNext - Number(winner.rating);
  const loserDelta = loserNext - Number(loser.rating);
  await client.query(
    `UPDATE season_ratings
        SET rating = $1,
            match_count = match_count + 1,
            wins = wins + 1,
            placement_complete = match_count + 1 >= $2,
            updated_at = NOW()
      WHERE season_id = $3 AND user_id = $4`,
    [winnerNext, season.placement_matches, season.id, winnerId],
  );
  await client.query(
    `UPDATE season_ratings
        SET rating = $1,
            match_count = match_count + 1,
            placement_complete = match_count + 1 >= $2,
            updated_at = NOW()
      WHERE season_id = $3 AND user_id = $4`,
    [loserNext, season.placement_matches, season.id, loserId],
  );
  await client.query(
    `INSERT INTO season_match_results
       (season_id, source_match_id, winner_user_id, loser_user_id, winner_delta, loser_delta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [season.id, sourceMatchId, winnerId, loserId, winnerDelta, loserDelta],
  );
}

async function deliverOutboxRow(pool: Pool, row: MatchResultOutboxRow, generateMatchId: () => string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const locked = await client.query<MatchResultOutboxRow>(
      `SELECT *
         FROM bjg_match_result_outbox
        WHERE source_match_id = $1
        FOR UPDATE`,
      [row.source_match_id],
    );
    const current = locked.rows[0];
    if (!current || current.status !== 'processing') return;
    if (
      !current.ranked_eligible ||
      !current.player0_user_id ||
      !current.player1_user_id ||
      !current.winner_user_id ||
      !current.loser_user_id ||
      current.winner_user_id === current.loser_user_id
    ) {
      throw new Error('Outbox row is not a valid ranked canonical result');
    }

    const userIds = [current.winner_user_id, current.loser_user_id].sort();
    const users = await client.query<UserRatingRow>(
      `SELECT id, elo
         FROM users
        WHERE id = ANY($1::text[])
        ORDER BY id
        FOR UPDATE`,
      [userIds],
    );
    const winner = users.rows.find((user) => user.id === current.winner_user_id);
    const loser = users.rows.find((user) => user.id === current.loser_user_id);
    if (!winner || !loser) throw new Error('Ranked participant account no longer exists');

    const winnerNewElo = calculateElo(Number(winner.elo), Number(loser.elo), 1);
    const loserNewElo = calculateElo(Number(loser.elo), Number(winner.elo), 0);
    const winnerDelta = winnerNewElo - Number(winner.elo);
    const loserDelta = loserNewElo - Number(loser.elo);
    const matchId = generateMatchId();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO matches (
         id,
         source_match_id,
         player0_id,
         player1_id,
         winner_id,
         loser_id,
         winner_elo_change,
         loser_elo_change,
         turns,
         duration_seconds,
         action_log
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (source_match_id) WHERE source_match_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        matchId,
        current.source_match_id,
        current.player0_user_id,
        current.player1_user_id,
        current.winner_user_id,
        current.loser_user_id,
        winnerDelta,
        loserDelta,
        current.turns,
        current.duration_seconds,
        JSON.stringify(sanitizeCanonicalActionLog(current.action_log)),
      ],
    );

    let deliveredMatchId = inserted.rows[0]?.id;
    if (deliveredMatchId) {
      await client.query(
        `UPDATE users
            SET elo = $1, match_count = match_count + 1, wins = wins + 1
          WHERE id = $2`,
        [winnerNewElo, current.winner_user_id],
      );
      await client.query(
        `UPDATE users
            SET elo = $1, match_count = match_count + 1
          WHERE id = $2`,
        [loserNewElo, current.loser_user_id],
      );
    } else {
      deliveredMatchId = (
        await client.query<{ id: string }>('SELECT id FROM matches WHERE source_match_id = $1', [
          current.source_match_id,
        ])
      ).rows[0]?.id;
      if (!deliveredMatchId) throw new Error('Idempotent match result could not be resolved');
    }

    await recordSeasonResultInTransaction(
      client,
      current.source_match_id,
      current.winner_user_id,
      current.loser_user_id,
    );

    await client.query(
      `UPDATE bjg_match_result_outbox
          SET status = 'delivered',
              delivered_match_id = $2,
              delivered_at = NOW(),
              locked_at = NULL,
              last_error = NULL,
              updated_at = NOW()
        WHERE source_match_id = $1`,
      [current.source_match_id, deliveredMatchId],
    );
  });
}

async function retainOutboxFailure(
  pool: Pool,
  row: MatchResultOutboxRow,
  error: unknown,
  baseRetryMs: number,
  maxRetryMs: number,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const retryDelayMs = matchResultRetryDelayMs(row.attempt_count, baseRetryMs, maxRetryMs);
  await pool.query(
    `UPDATE bjg_match_result_outbox
        SET status = 'pending',
            next_attempt_at = NOW() + ($2 * INTERVAL '1 millisecond'),
            locked_at = NULL,
            last_error = $3,
            updated_at = NOW()
      WHERE source_match_id = $1 AND status = 'processing'`,
    [row.source_match_id, retryDelayMs, message.slice(0, 2000)],
  );
}

export async function processMatchResultOutboxBatch({
  pool,
  batchSize = 20,
  staleLockMs = 5 * 60 * 1000,
  baseRetryMs = 1_000,
  maxRetryMs = 5 * 60 * 1000,
  generateMatchId = () => `m_${crypto.randomBytes(8).toString('hex')}`,
}: ProcessMatchResultOutboxOptions): Promise<MatchResultOutboxBatchResult> {
  const rows = await claimOutboxRows(pool, Math.max(1, Math.min(batchSize, 100)), staleLockMs);
  let delivered = 0;
  let retried = 0;
  for (const row of rows) {
    try {
      await deliverOutboxRow(pool, row, generateMatchId);
      delivered++;
    } catch (err) {
      await retainOutboxFailure(pool, row, err, baseRetryMs, maxRetryMs);
      retried++;
    }
  }
  return { claimed: rows.length, delivered, retried };
}

export function startMatchResultOutboxWorker({
  pool,
  enabled,
  pollIntervalMs = 2_000,
  onError,
}: {
  pool: Pool;
  enabled: boolean;
  pollIntervalMs?: number;
  onError?: (error: unknown) => void;
}): MatchResultOutboxWorker {
  let stopped = false;
  let running: Promise<MatchResultOutboxBatchResult> | null = null;
  const runOnce = async (): Promise<MatchResultOutboxBatchResult> => {
    if (!enabled || stopped) return { claimed: 0, delivered: 0, retried: 0 };
    if (running) return running;
    running = processMatchResultOutboxBatch({ pool }).finally(() => {
      running = null;
    });
    return running;
  };
  const timer = setInterval(
    () => {
      void runOnce().catch((err) => onError?.(err));
    },
    Math.max(250, pollIntervalMs),
  );
  timer.unref?.();
  if (enabled) void runOnce().catch((err) => onError?.(err));

  return {
    runOnce,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running?.catch(() => undefined);
    },
  };
}
