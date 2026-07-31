import type { GameState, PlayerIndex, ReplayDecisionRecord, ReplayMoveName } from './types';

export const REPLAY_MOVE_NAMES = [
  'janken',
  'mulligan',
  'keepHand',
  'setInitialCard',
  'setTurnCard',
  'undoSetCard',
  'confirmReady',
  'timeoutSkip',
  'timeoutAdvance',
  'surrender',
  'resolvePendingEffect',
  'submitPendingChoice',
] as const satisfies readonly ReplayMoveName[];

const PRESENTATION_ONLY_STATE_KEYS = new Set<keyof GameState>([
  'decisionTrace',
  'replayStatus',
  'actionLog',
  'log',
  'recentHpChanges',
  'recentGameNotices',
  'matchStartedAt',
  'matchEndedAt',
  'turnStartTime',
  'interactionStartTime',
]);

function normalizeJsonValue(value: unknown, inArray = false): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item, true));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .flatMap((key) => {
          const item = record[key];
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol') return [];
          return [[key, normalizeJsonValue(item)]];
        }),
    );
  }
  return inArray ? null : undefined;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value)) ?? 'null';
}

export function canonicalizeReplayArgs(args: readonly unknown[]): unknown[] {
  return JSON.parse(canonicalJsonStringify(args)) as unknown[];
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function fingerprint(value: unknown): string {
  return `fnv1a64-v1:${fnv1a64(canonicalJsonStringify(value))}`;
}

export function canonicalReplayState(G: GameState): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(G).filter(([key]) => !PRESENTATION_ONLY_STATE_KEYS.has(key as keyof GameState)),
  );
}

export function createReplayStateFingerprint(G: GameState): string {
  return fingerprint(canonicalReplayState(G));
}

export function createReplayRequestFingerprint(
  G: GameState,
  player: PlayerIndex,
  move: ReplayMoveName,
  args: readonly unknown[],
): string {
  return fingerprint({
    args: canonicalizeReplayArgs(args),
    move,
    player,
    state: canonicalReplayState(G),
  });
}

export function appendReplayDecision(
  G: GameState,
  player: PlayerIndex,
  move: ReplayMoveName,
  args: readonly unknown[],
  requestFingerprint: string,
): ReplayDecisionRecord {
  G.decisionTrace ??= [];
  const record: ReplayDecisionRecord = {
    schemaVersion: 1,
    sequence: G.decisionTrace.length + 1,
    player,
    move,
    args: canonicalizeReplayArgs(args),
    requestFingerprint,
    stateFingerprintAfter: createReplayStateFingerprint(G),
  };
  G.decisionTrace.push(record);
  return record;
}
