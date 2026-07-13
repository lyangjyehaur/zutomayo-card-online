import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  gameMatchCompletionsTotal,
  matchResultOutboxMetricsLastSuccess,
  matchResultOutboxMetricsRefreshSuccess,
  matchResultOutboxOldestAgeSeconds,
  matchResultOutboxPending,
  matchResultOutboxProcessedTotal,
  matchResultOutboxRows,
} from './observability/metrics';

const require = createRequire(import.meta.url);
const { acquireAccountMutationLocks } = require('../../api/accountMutationLock.cjs') as {
  acquireAccountMutationLocks: (
    client: PoolClient,
    userIds: string[],
    options?: { includeRetention?: boolean; requireLiveUsers?: boolean },
  ) => Promise<QueryResultRow[]>;
};
const { applyCanonicalSeasonResult } = require('../../api/seasonResultService.cjs') as {
  applyCanonicalSeasonResult: (input: {
    client: PoolClient;
    sourceMatchId: string;
    canonicalMatchId: string;
    completedAt: string | Date;
    rulesVersion: string;
    winnerId: string;
    loserId: string;
  }) => Promise<{ applied: boolean; reason?: string; seasonId?: string; seasonStatus?: string }>;
};

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
  rules_version: string;
  completed_at: string | Date;
  action_log: unknown[];
  state_id: number | null;
  status: 'pending' | 'processing' | 'delivered' | 'unrated';
  attempt_count: number;
}

interface UserRatingRow extends QueryResultRow {
  id: string;
  elo: number;
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

const OUTBOX_STATUSES = ['pending', 'processing', 'delivered', 'unrated'] as const;

/**
 * Refresh gauges from durable rows instead of inferring queue health from the
 * last worker iteration. A failed refresh is explicitly exported so a stale
 * Prometheus sample cannot look healthy after the database is unavailable.
 */
export async function refreshMatchResultOutboxMetrics(pool: Pick<Pool, 'query'>): Promise<void> {
  try {
    const [summary, counts] = await Promise.all([
      pool.query<{ pending_count: string; oldest_age_seconds: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::text AS pending_count,
           COALESCE(
             EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status IN ('pending', 'processing')))),
             0
           )::text AS oldest_age_seconds
         FROM bjg_match_result_outbox`,
      ),
      pool.query<{ status: string; row_count: string }>(
        `SELECT status, COUNT(*)::text AS row_count
           FROM bjg_match_result_outbox
          GROUP BY status`,
      ),
    ]);
    const row = summary.rows[0] ?? { pending_count: '0', oldest_age_seconds: '0' };
    matchResultOutboxPending.set(Math.max(0, Number(row.pending_count) || 0));
    matchResultOutboxOldestAgeSeconds.set(Math.max(0, Number(row.oldest_age_seconds) || 0));
    const countsByStatus = new Map(counts.rows.map((item) => [item.status, Math.max(0, Number(item.row_count) || 0)]));
    for (const status of OUTBOX_STATUSES) {
      matchResultOutboxRows.labels(status).set(countsByStatus.get(status) ?? 0);
    }
    matchResultOutboxMetricsRefreshSuccess.set(1);
    matchResultOutboxMetricsLastSuccess.set(Date.now() / 1000);
  } catch (error) {
    matchResultOutboxMetricsRefreshSuccess.set(0);
    throw error;
  }
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

async function deliverOutboxRow(
  pool: Pool,
  row: MatchResultOutboxRow,
  generateMatchId: () => string,
): Promise<'delivered' | 'unrated' | 'skipped'> {
  return withTransaction(pool, async (client) => {
    // Read the identity before taking the outbox row lock. Account locks must
    // precede business-row locks so deletion and delivery cannot deadlock.
    const preview = await client.query<MatchResultOutboxRow>(
      `SELECT *
         FROM bjg_match_result_outbox
        WHERE source_match_id = $1
        `,
      [row.source_match_id],
    );
    const previewRow = preview.rows[0];
    if (!previewRow || previewRow.status !== 'processing') return 'skipped';
    if (
      !previewRow.ranked_eligible ||
      !previewRow.player0_user_id ||
      !previewRow.player1_user_id ||
      !previewRow.winner_user_id ||
      !previewRow.loser_user_id ||
      previewRow.winner_user_id === previewRow.loser_user_id
    ) {
      throw new Error('Outbox row is not a valid ranked canonical result');
    }
    const userIds = [previewRow.winner_user_id, previewRow.loser_user_id].sort();
    await acquireAccountMutationLocks(client, userIds, { requireLiveUsers: false });
    const users = await client.query<UserRatingRow & { deleted_at?: Date | string | null }>(
      `SELECT id, elo, deleted_at
         FROM users
        WHERE id = ANY($1::text[])
        ORDER BY id
        FOR UPDATE`,
      [userIds],
    );

    const locked = await client.query<MatchResultOutboxRow>(
      `SELECT *
         FROM bjg_match_result_outbox
        WHERE source_match_id = $1
          AND status = 'processing'
        FOR UPDATE`,
      [row.source_match_id],
    );
    const current = locked.rows[0];
    if (!current || current.status !== 'processing') return 'skipped';
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

    const winner = users.rows.find((user) => user.id === current.winner_user_id);
    const loser = users.rows.find((user) => user.id === current.loser_user_id);
    if (!winner || !loser || winner.deleted_at || loser.deleted_at) {
      await client.query(
        `UPDATE bjg_match_result_outbox
            SET status = 'unrated',
                ranked_eligible = FALSE,
                player0_user_id = NULL,
                player1_user_id = NULL,
                winner_user_id = NULL,
                loser_user_id = NULL,
                locked_at = NULL,
                last_error = 'account deleted before result delivery',
                updated_at = NOW()
          WHERE source_match_id = $1 AND status = 'processing'`,
        [row.source_match_id],
      );
      return 'unrated';
    }

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
         rules_version,
         action_log,
         completed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
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
        current.rules_version || 'legacy',
        JSON.stringify(sanitizeCanonicalActionLog(current.action_log)),
        current.completed_at,
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

    const seasonResult = await applyCanonicalSeasonResult({
      client,
      sourceMatchId: current.source_match_id,
      canonicalMatchId: deliveredMatchId,
      completedAt: current.completed_at,
      rulesVersion: current.rules_version || 'legacy',
      winnerId: current.winner_user_id,
      loserId: current.loser_user_id,
    });
    if (seasonResult.reason === 'season-not-settled') {
      throw new Error(`Season result is waiting for settlement: ${seasonResult.seasonId}`);
    }

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
    return 'delivered';
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
      const outcome = await deliverOutboxRow(pool, row, generateMatchId);
      matchResultOutboxProcessedTotal.labels(outcome).inc();
      if (outcome === 'delivered') {
        delivered++;
        gameMatchCompletionsTotal.labels('ranked', row.winner_player === null ? 'draw' : 'winner').inc();
      }
    } catch (err) {
      await retainOutboxFailure(pool, row, err, baseRetryMs, maxRetryMs);
      retried++;
      matchResultOutboxProcessedTotal.labels('retried').inc();
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
    running = processMatchResultOutboxBatch({ pool })
      .then(async (result) => {
        await refreshMatchResultOutboxMetrics(pool);
        return result;
      })
      .finally(() => {
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
