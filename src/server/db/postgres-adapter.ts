import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { Server, State, LogEntry } from 'boardgame.io';
import * as Sentry from '@sentry/node';

/**
 * boardgame.io StorageAPI.Async 的 Postgres 實作。
 *
 * 0.50.2 的 dist 只匯出 FlatFile/Server/SocketIO，不匯出 StorageAPI 抽象類別，
 * 因此這裡不繼承，改為 duck-typed 實作（type() 回傳 1 = ASYNC），
 * 在 server.ts 透過結構化斷言注入 Server({ db })。
 *
 * Schema（與 API server 共用同一個 PG instance，用 bjg_ 前綴隔離）：
 *   bjg_matches(match_id PK, state JSONB, initial_state JSONB,
 *               metadata JSONB, log JSONB, updated_at TIMESTAMPTZ)
 *
 * deltalog append 使用 PG 的 `||` JSONB concat operator，單一 UPDATE 即原子完成。
 *
 * boardgame.io 的 onUpdate 會先 fetch state、跑 reducer、廣播、最後 setState。
 * 多個 server instance 若同時從同一個 _stateID 開始處理 move，舊實作會讓較晚寫入者覆蓋較新狀態。
 * 這裡對 onUpdate 的 state fetch 取得 row lock，並在 setState 時檢查 _stateID 單調遞增。
 */

const TYPE_ASYNC = 1;

interface PostgresAdapterOptions {
  /** pg.Pool 完整設定（host/port/user/password/database/...）。 */
  pool?: Pool;
  /** 或只傳 connection string，由 adapter 自建 Pool。 */
  connectionString?: string;
  /** schema 初始化時是否建立索引（預設 true）。 */
  createIndexes?: boolean;
}

interface MatchRow extends QueryResultRow {
  match_id: string;
  state: State | null;
  initial_state: State | null;
  metadata: Server.MatchData | null;
  log: LogEntry[] | null;
  updated_at: Date;
}

interface FetchOpts {
  state?: boolean;
  log?: boolean;
  metadata?: boolean;
  initialState?: boolean;
}

interface ListMatchesOpts {
  gameName?: string;
  where?: {
    isGameover?: boolean;
    updatedBefore?: number;
    updatedAfter?: number;
  };
}

interface CreateMatchOpts {
  initialState: State;
  metadata: Server.MatchData;
}

interface UpdateLockContext {
  matchID: string;
  client: PoolClient;
  timeout: ReturnType<typeof setTimeout>;
  released: boolean;
}

export class StaleStateWriteError extends Error {
  constructor(matchID: string, expectedStateID: number, nextStateID: number) {
    super(
      `Stale state write rejected for match ${matchID}: expected current _stateID ${expectedStateID}, next _stateID ${nextStateID}`,
    );
    this.name = 'StaleStateWriteError';
  }
}

export class PostgresAdapter {
  private pool: Pool;
  private createIndexes: boolean;
  private connected = false;
  private closed = false;
  private updateLocks = new Map<string, UpdateLockContext>();

  constructor(opts: PostgresAdapterOptions = {}) {
    this.pool =
      opts.pool ??
      new Pool({
        connectionString:
          opts.connectionString ??
          process.env.DATABASE_URL ??
          `postgres://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || ''}@${process.env.PG_HOST || 'localhost'}:${process.env.PG_PORT || '5432'}/${process.env.PG_DATABASE || 'postgres'}`,
        max: Number(process.env.PG_POOL_MAX) || 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    this.createIndexes = opts.createIndexes ?? true;
  }

  type() {
    return TYPE_ASYNC;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connected) return;
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS bjg_matches (
          match_id       TEXT PRIMARY KEY,
          state          JSONB,
          initial_state  JSONB,
          metadata       JSONB NOT NULL,
          log            JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      if (this.createIndexes) {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_bjg_matches_updated_at ON bjg_matches (updated_at);`);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_bjg_matches_game_name ON bjg_matches ((metadata->>'gameName'));`,
        );
      }
      this.connected = true;
    } finally {
      client.release();
    }
  }

  async createMatch(matchID: string, opts: CreateMatchOpts): Promise<void> {
    if (this.closed) return;
    await this.connect();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO bjg_matches (match_id, state, initial_state, metadata, log, updated_at)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, NOW())
         ON CONFLICT (match_id) DO NOTHING`,
        [matchID, JSON.stringify(opts.initialState), JSON.stringify(opts.initialState), JSON.stringify(opts.metadata)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setState(matchID: string, state: State, deltalog?: LogEntry[]): Promise<void> {
    if (this.closed) return;
    await this.connect();

    const lock = this.updateLocks.get(matchID);
    if (lock && !lock.released) {
      try {
        await this.writeState(lock.client, matchID, state, deltalog);
        await this.releaseUpdateLock(lock, 'commit');
      } catch (err) {
        await this.releaseUpdateLock(lock, 'rollback');
        throw err;
      }
      return;
    }

    await this.writeState(this.pool, matchID, state, deltalog);
  }

  async setMetadata(matchID: string, metadata: Server.MatchData): Promise<void> {
    if (this.closed) return;
    await this.connect();
    await this.pool.query(
      `INSERT INTO bjg_matches (match_id, metadata, log, updated_at)
       VALUES ($1, $2, '[]'::jsonb, NOW())
       ON CONFLICT (match_id)
       DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()`,
      [matchID, JSON.stringify(metadata)],
    );
  }

  async fetch<O extends FetchOpts>(
    matchID: string,
    opts: O,
  ): Promise<{
    state?: State;
    log?: LogEntry[];
    metadata?: Server.MatchData;
    initialState?: State;
  }> {
    if (this.closed) return {};
    await this.connect();
    if (this.isUpdateStateFetch(opts)) {
      return this.fetchStateForUpdate(matchID) as Promise<{
        state?: State;
        log?: LogEntry[];
        metadata?: Server.MatchData;
        initialState?: State;
      }>;
    }

    const cols: string[] = ['match_id'];
    if (opts.state) cols.push('state');
    if (opts.log) cols.push('log');
    if (opts.metadata) cols.push('metadata');
    if (opts.initialState) cols.push('initial_state');

    const result = await this.pool.query<MatchRow>(`SELECT ${cols.join(', ')} FROM bjg_matches WHERE match_id = $1`, [
      matchID,
    ]);
    if (result.rows.length === 0) {
      return {} as { state?: State; log?: LogEntry[]; metadata?: Server.MatchData; initialState?: State };
    }
    const row = result.rows[0];
    const out: {
      state?: State;
      log?: LogEntry[];
      metadata?: Server.MatchData;
      initialState?: State;
    } = {};
    if (opts.state && row.state) out.state = row.state as State;
    if (opts.log && row.log) out.log = row.log as LogEntry[];
    if (opts.metadata && row.metadata) out.metadata = row.metadata as Server.MatchData;
    if (opts.initialState && row.initial_state) out.initialState = row.initial_state as State;
    return out;
  }

  async wipe(matchID: string): Promise<void> {
    if (this.closed) return;
    await this.connect();
    await this.pool.query(`DELETE FROM bjg_matches WHERE match_id = $1`, [matchID]);
  }

  async listMatches(opts?: ListMatchesOpts): Promise<string[]> {
    if (this.closed) return [];
    await this.connect();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (opts?.gameName) {
      conditions.push(`metadata->>'gameName' = $${paramIdx++}`);
      params.push(opts.gameName);
    }
    if (opts?.where?.isGameover !== undefined) {
      // gameover 欄位存在於 metadata 代表對局已結束。
      conditions.push(opts.where.isGameover ? `metadata ? 'gameover'` : `NOT (metadata ? 'gameover')`);
    }
    if (opts?.where?.updatedBefore !== undefined) {
      conditions.push(`EXTRACT(EPOCH FROM updated_at) * 1000 < $${paramIdx++}`);
      params.push(opts.where.updatedBefore);
    }
    if (opts?.where?.updatedAfter !== undefined) {
      conditions.push(`EXTRACT(EPOCH FROM updated_at) * 1000 > $${paramIdx++}`);
      params.push(opts.where.updatedAfter);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<{ match_id: string }>(
      `SELECT match_id FROM bjg_matches ${where} ORDER BY updated_at DESC`,
      params,
    );
    return result.rows.map((r) => r.match_id);
  }

  /**
   * 在 server 關閉時呼叫，釋放連線池。
   * 設置 closed flag：之後任何 db 方法呼叫皆 no-op，避免 shutdown 期間
   * boardgame.io Master 的 async disconnect handler（onConnectionChange → fetch）
   * 撞到已 end 的 pool 拋「Cannot use a pool after end」unhandled rejection。
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    await this.pool.end();
  }

  /**
   * 提供原始 Pool 給測試或外部使用（如 cleanup job 用 client 做批次操作）。
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * 取得單一 client 並包在 transaction 中執行 callback。
   * 供需要多步驟原子操作的外部邏輯使用（如 cleanupStaleMatches 批次刪除）。
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('PostgresAdapter is closed');
    await this.connect();
    const client = await this.pool.connect();
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

  private isUpdateStateFetch(opts: FetchOpts): boolean {
    return opts.state === true && !opts.log && !opts.metadata && !opts.initialState;
  }

  private async fetchStateForUpdate(matchID: string): Promise<{ state?: State }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<MatchRow>(
        `SELECT match_id, state FROM bjg_matches WHERE match_id = $1 FOR UPDATE`,
        [matchID],
      );
      if (result.rows.length === 0) {
        await client.query('COMMIT');
        client.release();
        return {};
      }

      const lock: UpdateLockContext = {
        matchID,
        client,
        released: false,
        timeout: setTimeout(() => {
          this.releaseUpdateLock(lock, 'rollback').catch((err) => {
            Sentry.captureException(err, {
              tags: { layer: 'postgres', op: 'lock-release-timeout', match_id: matchID },
            });
            console.error(`[PostgresAdapter] timed-out update lock release failed for ${matchID}:`, err);
          });
        }, 5000),
      };
      lock.timeout.unref?.();
      this.updateLocks.set(matchID, lock);
      return { state: result.rows[0].state as State };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* ignore rollback failure from the original error path */
      });
      client.release();
      throw err;
    }
  }

  private async releaseUpdateLock(lock: UpdateLockContext, mode: 'commit' | 'rollback'): Promise<void> {
    if (lock.released) return;
    lock.released = true;
    this.updateLocks.delete(lock.matchID);
    clearTimeout(lock.timeout);
    try {
      await lock.client.query(mode === 'commit' ? 'COMMIT' : 'ROLLBACK');
    } finally {
      lock.client.release();
    }
  }

  private expectedPreviousStateID(state: State): number | null {
    return typeof state._stateID === 'number' ? state._stateID - 1 : null;
  }

  private async writeState(
    queryable: Pick<Pool | PoolClient, 'query'>,
    matchID: string,
    state: State,
    deltalog?: LogEntry[],
  ): Promise<void> {
    const nextStateID = typeof state._stateID === 'number' ? state._stateID : null;
    const expectedStateID = this.expectedPreviousStateID(state);
    const hasDeltalog = Boolean(deltalog && deltalog.length > 0);
    const guardParamIndex = hasDeltalog ? 4 : 3;
    const stateIDGuard =
      expectedStateID === null ? '' : ` AND COALESCE((state->>'_stateID')::integer, -1) = $${guardParamIndex}`;

    const paramsWithLog: unknown[] = [matchID, JSON.stringify(state), JSON.stringify(deltalog)];
    const paramsWithoutLog: unknown[] = [matchID, JSON.stringify(state)];
    if (expectedStateID !== null) {
      paramsWithLog.push(expectedStateID);
      paramsWithoutLog.push(expectedStateID);
    }

    const result = hasDeltalog
      ? await queryable.query(
          `UPDATE bjg_matches
             SET state = $2,
                 log = COALESCE(log, '[]'::jsonb) || $3::jsonb,
                 updated_at = NOW()
           WHERE match_id = $1${stateIDGuard}`,
          paramsWithLog,
        )
      : await queryable.query(
          `UPDATE bjg_matches
              SET state = $2, updated_at = NOW()
            WHERE match_id = $1${stateIDGuard}`,
          paramsWithoutLog,
        );

    if (expectedStateID !== null && result.rowCount === 0) {
      throw new StaleStateWriteError(matchID, expectedStateID, nextStateID ?? expectedStateID + 1);
    }
  }
}
