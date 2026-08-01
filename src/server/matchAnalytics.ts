import crypto from 'node:crypto';
import type { State } from 'boardgame.io';
import type { AppVersionInfo } from '../version';

export const MATCH_ANALYTICS_SCHEMA_VERSION = 1;
const DATASET_SHA256_PATTERN = /^[a-f0-9]{64}$/;

const GAME_STEPS = new Set(['janken', 'mulligan', 'initialSet', 'turnSet', 'effectOrder', 'gameOver']);
const EVENT_TYPES = new Set([
  'jankenResult',
  'mulligan',
  'setInitialCard',
  'setTurnCard',
  'submitPendingChoice',
  'hpChange',
  'zoneEntered',
  'revealCards',
  'timeoutSkip',
  'timeoutAdvance',
  'effectFailed',
  'battleDraw',
  'chooseEffectOrder',
  'resolvePendingEffect',
  'surrender',
  'gameOver',
]);
const CARD_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;
const CHOICE_TYPES = new Set([
  'handToDeckBottomThenDraw',
  'cardMove',
  'optionalHandMoveThenDraw',
  'abyssToDeckBottomOrLose',
  'reorderOpponentDeckTop',
  'opponentPowerCharacterSwap',
  'useFromAbyss',
  'useFromHand',
  'revealHandAttackBoost',
  'declareOpponentHandCardName',
  'selectOpponentHandCard',
  'handAbyssSwap',
  'clockPosition',
  'clockAdvance',
  'acknowledgeRevealedHand',
]);
const HP_CHANGE_REASONS = new Set(['battle', 'directDamage', 'heal', 'healOpponent', 'healBoth']);
const EFFECT_FAILURE_REASONS = new Set(['disabled', 'powerCost', 'condition']);

type JsonRecord = Record<string, unknown>;
type SeatClass = 'registered' | 'guest' | 'unknown';
type MatchMode = 'quick_match' | 'custom_room' | 'invite' | 'direct' | 'unknown';
type TrafficClass = 'production' | 'operator' | 'synthetic' | 'ai' | 'unknown';

export interface TrustedMatchTelemetry {
  matchMode: MatchMode;
  trafficClass: TrafficClass;
  disconnectCounts: readonly [number, number];
  reconnectCounts: readonly [number, number];
  connectionEvents?: unknown;
}

export interface AnalyticsSeat {
  playerID: '0' | '1';
  userId?: string;
  rankedEligible: boolean;
  resumeCount?: number;
}

export interface MatchAnalyticsDeck {
  sourceMatchDigest: string;
  seat: 0 | 1;
  cardIds: string[];
  deckHash: string;
  deckSource: SeatClass | 'unknown';
  deckValidation: 'valid';
}

export interface MatchAnalyticsEvent {
  sourceMatchDigest: string;
  sequence: number;
  turn: number;
  step: string;
  actorSeat: 0 | 1 | null;
  eventType: string;
  cardDefId: string | null;
  targetSeat: 0 | 1 | null;
  hpBefore: number | null;
  hpAfter: number | null;
  chronosPosition: number | null;
  resultCode: 'ok' | 'failed' | null;
  timeoutPhase: string | null;
  payload: JsonRecord;
}

export interface MatchAnalyticsFact {
  sourceMatchDigest: string;
  environment: 'production' | 'staging' | 'development' | 'test' | 'unknown';
  trafficClass: TrafficClass;
  matchMode: MatchMode;
  ratingMode: 'ranked' | 'unrated';
  unratedReason: string | null;
  appVersion: string;
  buildId: string;
  rulesVersion: string;
  datasetSha256: string;
  startedAt: string | null;
  completedAt: string;
  durationSeconds: number;
  turns: number;
  outcome: 'completed' | 'draw' | 'surrendered' | 'abandoned';
  winnerSeat: 0 | 1 | null;
  jankenWinnerSeat: 0 | 1 | null;
  gameoverReasonCode: string;
  finalHp: [number, number];
  seatClasses: [SeatClass, SeatClass];
  qualityFlags: string[];
  actionCount: number;
  timeoutCount: number;
  disconnectCounts: [number, number];
  reconnectCounts: [number, number];
  seatResumeCounts: [number, number];
  deckCount: 2;
  eventCount: number;
  captureSchemaVersion: 1;
  integritySha256: string;
}

export interface MatchAnalyticsProjection {
  fact: MatchAnalyticsFact;
  decks: [MatchAnalyticsDeck, MatchAnalyticsDeck];
  events: MatchAnalyticsEvent[];
}

export interface ProjectMatchAnalyticsInput {
  sourceMatchId: string;
  state: State;
  initialState: State;
  seats: AnalyticsSeat[];
  rankedEligible: boolean;
  unratedReason: string | null;
  rulesVersion: string;
  version: AppVersionInfo;
  datasetSha256?: string;
  environment?: string;
  telemetry?: TrustedMatchTelemetry;
}

export interface ProjectAbandonedMatchAnalyticsInput {
  sourceMatchId: string;
  state: State;
  initialState: State;
  seats: AnalyticsSeat[];
  rulesVersion: string;
  version: AppVersionInfo;
  abandonedAt: string;
  datasetSha256?: string;
  environment?: string;
  telemetry?: TrustedMatchTelemetry;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function integer(value: unknown, min = -1_000_000, max = 1_000_000): number | null {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
}

function seat(value: unknown): 0 | 1 | null {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  return null;
}

function cardId(value: unknown): string | null {
  return typeof value === 'string' && CARD_ID_PATTERN.test(value) ? value : null;
}

function enumValue(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isoDate(value: unknown): string | null {
  if (!Number.isFinite(value) || Number(value) <= 0) return null;
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function environment(value: string | undefined): MatchAnalyticsFact['environment'] {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'production' ||
    normalized === 'staging' ||
    normalized === 'development' ||
    normalized === 'test'
  ) {
    return normalized;
  }
  return 'unknown';
}

export function resolveMatchAnalyticsRuntimeMetadata(env: NodeJS.ProcessEnv = process.env): {
  environment: MatchAnalyticsFact['environment'];
  datasetSha256: string;
} {
  const deploymentEnvironment = environment(env.DEPLOYMENT_ENV ?? env.NODE_ENV);
  const configuredDataset = (env.CARD_DATASET_SHA256 ?? env.VITE_CARD_DATASET_SHA256)?.trim().toLowerCase();
  if (configuredDataset && !DATASET_SHA256_PATTERN.test(configuredDataset)) {
    throw new Error('CARD_DATASET_SHA256 must be a lowercase SHA-256 digest');
  }
  if ((deploymentEnvironment === 'production' || deploymentEnvironment === 'staging') && !configuredDataset) {
    throw new Error(`${deploymentEnvironment} match analytics require CARD_DATASET_SHA256`);
  }
  return {
    environment: deploymentEnvironment,
    datasetSha256: configuredDataset || 'unknown',
  };
}

function boundedCount(value: unknown): number {
  return integer(value, 0, 1_000_000) ?? 0;
}

function seatResumeCounts(seats: AnalyticsSeat[]): [number, number] {
  return (['0', '1'] as const).map((playerID) =>
    boundedCount(seats.find((candidate) => candidate.playerID === playerID)?.resumeCount),
  ) as [number, number];
}

function seatClass(seats: AnalyticsSeat[], playerID: '0' | '1'): SeatClass {
  const reservation = seats.find((candidate) => candidate.playerID === playerID);
  if (!reservation?.userId) return 'unknown';
  return reservation.userId.startsWith('guest:') ? 'guest' : 'registered';
}

function initialDeck(initialState: State, player: 0 | 1): string[] {
  const state = initialState as State & { G?: { players?: unknown } };
  const players = Array.isArray(state.G?.players) ? state.G.players : [];
  const playerState = record(players[player]);
  const cards = [
    ...(Array.isArray(playerState?.deck) ? playerState.deck : []),
    ...(Array.isArray(playerState?.hand) ? playerState.hand : []),
  ];
  const ids = cards.map((value) => cardId(record(value)?.defId)).filter((value): value is string => value !== null);
  if (ids.length !== 20) throw new Error(`Analytics deck snapshot for seat ${player} must contain exactly 20 cards`);
  return ids.sort();
}

function setValue(target: JsonRecord, key: string, value: unknown): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function sanitizedPayload(action: string, value: unknown): JsonRecord {
  const source = record(value) ?? {};
  const payload: JsonRecord = {};
  const addInteger = (key: string, min = -1_000_000, max = 1_000_000) =>
    setValue(payload, key, integer(source[key], min, max));
  const addSeat = (key: string) => setValue(payload, key, seat(source[key]));
  const addCard = (key: string) => setValue(payload, key, cardId(source[key]));
  const addBoolean = (key: string) => {
    if (typeof source[key] === 'boolean') payload[key] = source[key];
  };
  const addEnum = (key: string, allowed: ReadonlySet<string>) =>
    setValue(payload, key, enumValue(source[key], allowed));

  if (action === 'jankenResult') {
    addBoolean('draw');
    addSeat('winner');
  } else if (action === 'mulligan') {
    addInteger('redrawnCount', 0, 20);
  } else if (action === 'setInitialCard' || action === 'setTurnCard') {
    addCard('cardDefId');
    addEnum(
      action === 'setInitialCard' ? 'zone' : 'slot',
      new Set(action === 'setInitialCard' ? ['battleZone'] : ['A', 'B', 'C']),
    );
  } else if (action === 'submitPendingChoice') {
    addEnum('choiceType', CHOICE_TYPES);
    addInteger('selectedCount', 0, 20);
    addInteger('min', 0, 20);
    addInteger('max', 0, 20);
  } else if (action === 'hpChange') {
    for (const key of ['delta', 'before', 'after']) addInteger(key);
    addEnum('reason', HP_CHANGE_REASONS);
    addCard('sourceCardDefId');
  } else if (action === 'zoneEntered') {
    addEnum('zone', new Set(['battleZone', 'setZoneC', 'abyss', 'powerCharger']));
    addCard('cardDefId');
    addInteger('sendToPower', 0, 1000);
  } else if (action === 'revealCards') {
    addSeat('targetPlayer');
    addEnum('sourceZone', new Set(['hand', 'deck']));
    if (Array.isArray(source.cardDefIds)) {
      payload.cardDefIds = source.cardDefIds
        .map(cardId)
        .filter((value): value is string => value !== null)
        .slice(0, 20);
    }
    addCard('guessedCardDefId');
    addBoolean('matched');
  } else if (action === 'timeoutSkip') {
    addBoolean('confirmed');
    addBoolean('autoSet');
    addEnum('reason', new Set(['noLegalCard']));
  } else if (action === 'timeoutAdvance') {
    addEnum('timedOutStep', GAME_STEPS);
  } else if (action === 'effectFailed') {
    addCard('cardDefId');
    addEnum('reason', EFFECT_FAILURE_REASONS);
  } else if (action === 'battleDraw') {
    addInteger('p0Attack');
    addInteger('p1Attack');
    addCard('p0CardDefId');
    addCard('p1CardDefId');
  } else if (action === 'chooseEffectOrder' || action === 'resolvePendingEffect') {
    addCard('cardDefId');
  } else if (action === 'surrender' || action === 'gameOver') {
    addSeat('winner');
    addBoolean('draw');
  }
  return payload;
}

function projectEvents(sourceMatchDigest: string, actionLog: unknown): MatchAnalyticsEvent[] {
  if (!Array.isArray(actionLog)) return [];
  return actionLog.slice(0, 2000).flatMap((raw, sourceIndex) => {
    const entry = record(raw);
    const eventType = typeof entry?.action === 'string' && EVENT_TYPES.has(entry.action) ? entry.action : null;
    if (!entry || !eventType) return [];
    const payload = sanitizedPayload(eventType, entry.payload);
    const payloadCard = cardId(payload.cardDefId ?? payload.sourceCardDefId);
    const targetSeat = seat(payload.targetPlayer);
    const before = integer(payload.before);
    const after = integer(payload.after);
    const step = typeof entry.step === 'string' && GAME_STEPS.has(entry.step) ? entry.step : 'unknown';
    const result = record(entry.result);
    return [
      {
        sourceMatchDigest,
        sequence: sourceIndex,
        turn: integer(entry.turn, 0, 9999) ?? 0,
        step,
        actorSeat: seat(entry.player),
        eventType,
        cardDefId: payloadCard,
        targetSeat,
        hpBefore: before,
        hpAfter: after,
        chronosPosition: integer(entry.chronosPosition, 0, 17),
        resultCode: typeof result?.ok === 'boolean' ? (result.ok ? 'ok' : 'failed') : null,
        timeoutPhase: eventType.startsWith('timeout')
          ? enumValue(payload.timedOutStep ?? entry.step, GAME_STEPS)
          : null,
        payload,
      },
    ];
  });
}

function projectConnectionEvents(
  sourceMatchDigest: string,
  connectionEvents: unknown,
  firstSequence: number,
): MatchAnalyticsEvent[] {
  if (!Array.isArray(connectionEvents)) return [];
  return connectionEvents.slice(0, 100).flatMap((raw, sourceIndex) => {
    const entry = record(raw);
    const runtimeEvent = entry?.event;
    if (!entry || (runtimeEvent !== 'disconnect' && runtimeEvent !== 'reconnect')) return [];
    const actorSeat = seat(entry.seat);
    const offsetSeconds = integer(entry.offsetSeconds, 0, 86_400);
    if (actorSeat === null || offsetSeconds === null) return [];
    const step = enumValue(entry.step, GAME_STEPS) ?? 'unknown';
    const payload: JsonRecord = { offsetSeconds };
    if (runtimeEvent === 'reconnect') {
      const disconnectSeconds = integer(entry.disconnectSeconds, 0, 86_400);
      if (disconnectSeconds === null) return [];
      payload.disconnectSeconds = disconnectSeconds;
    }
    return [
      {
        sourceMatchDigest,
        sequence: firstSequence + sourceIndex,
        turn: 0,
        step,
        actorSeat,
        eventType: runtimeEvent === 'disconnect' ? 'connectionDisconnect' : 'connectionReconnect',
        cardDefId: null,
        targetSeat: null,
        hpBefore: null,
        hpAfter: null,
        chronosPosition: null,
        resultCode: null,
        timeoutPhase: null,
        payload,
      },
    ];
  });
}

function gameoverReasonCode(events: MatchAnalyticsEvent[], winner: 0 | 1 | null): string {
  if (events.some((event) => event.eventType === 'surrender')) return 'surrender';
  if (
    events.some(
      (event) =>
        event.eventType === 'timeoutSkip' &&
        event.payload.reason === 'noLegalCard' &&
        event.payload.confirmed === false,
    )
  ) {
    return 'timeout-no-legal-card';
  }
  if (winner === null) return 'draw';
  return 'rules_terminal';
}

export function sourceMatchDigest(sourceMatchId: string): string {
  if (!sourceMatchId) throw new Error('Source match ID is required for analytics capture');
  return digest(sourceMatchId);
}

interface ProjectionLifecycle {
  completedAt: string;
  outcome: MatchAnalyticsFact['outcome'];
  winner: 0 | 1 | null;
  rankedEligible: boolean;
  unratedReason: string | null;
  gameoverReasonCode: string;
}

function validIsoTimestamp(value: string): string | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function buildProjection(
  input: Omit<ProjectMatchAnalyticsInput, 'rankedEligible' | 'unratedReason'>,
  lifecycle: ProjectionLifecycle,
): MatchAnalyticsProjection {
  const sourceDigest = sourceMatchDigest(input.sourceMatchId);
  const state = input.state as State & { G?: JsonRecord };
  const G = state.G ?? {};
  const actionLog = G.actionLog;
  const actionEvents = projectEvents(sourceDigest, actionLog);
  const nextSequence = actionEvents.reduce((highest, event) => Math.max(highest, event.sequence), -1) + 1;
  const events = actionEvents.concat(
    projectConnectionEvents(sourceDigest, input.telemetry?.connectionEvents, nextSequence),
  );
  const playerStates = Array.isArray(G.players) ? G.players : [];
  const finalHp: [number, number] = [
    integer(record(playerStates[0])?.hp) ?? 0,
    integer(record(playerStates[1])?.hp) ?? 0,
  ];
  const startedAt = isoDate(G.matchStartedAt);
  const completedAt = validIsoTimestamp(lifecycle.completedAt);
  if (!completedAt) throw new Error('Analytics capture requires a valid closure timestamp');
  const seatClasses: [SeatClass, SeatClass] = [seatClass(input.seats, '0'), seatClass(input.seats, '1')];
  const decks = ([0, 1] as const).map((player) => {
    const cardIds = initialDeck(input.initialState, player);
    return {
      sourceMatchDigest: sourceDigest,
      seat: player,
      cardIds,
      deckHash: digest(cardIds.join('\n')),
      deckSource: seatClasses[player],
      deckValidation: 'valid' as const,
    };
  }) as [MatchAnalyticsDeck, MatchAnalyticsDeck];
  const jankenWinnerSeat = seat(
    events.filter((event) => event.eventType === 'jankenResult' && seat(event.payload.winner) !== null).at(-1)?.payload
      .winner,
  );
  const timeoutCount = events.filter((event) => event.eventType.startsWith('timeout')).length;
  const disconnectCounts: [number, number] = [
    boundedCount(input.telemetry?.disconnectCounts[0]),
    boundedCount(input.telemetry?.disconnectCounts[1]),
  ];
  const reconnectCounts: [number, number] = [
    boundedCount(input.telemetry?.reconnectCounts[0]),
    boundedCount(input.telemetry?.reconnectCounts[1]),
  ];
  const resumeCounts = seatResumeCounts(input.seats);
  const matchMode = input.telemetry?.matchMode ?? 'direct';
  const qualityFlags = [
    ...(timeoutCount >= 3 ? ['timeout-heavy'] : []),
    ...(input.seats.length < 2 ? ['missing-seat-reservation'] : []),
    ...(events.length === 0 ? ['missing-events'] : []),
    ...(lifecycle.outcome === 'abandoned' ? ['abandoned'] : []),
    ...(!input.telemetry || matchMode === 'unknown' ? ['missing-provenance'] : []),
    ...(disconnectCounts.some((count) => count > 0) ? ['disconnect-observed'] : []),
    ...(reconnectCounts.some((count) => count > 0) ? ['reconnect-observed'] : []),
    ...(resumeCounts.some((count) => count > 0) ? ['seat-resume-observed'] : []),
  ];
  const env = environment(input.environment);
  const factWithoutIntegrity = {
    sourceMatchDigest: sourceDigest,
    environment: env,
    trafficClass:
      input.telemetry?.trafficClass ?? (env === 'production' ? ('production' as const) : ('synthetic' as const)),
    matchMode,
    ratingMode: lifecycle.rankedEligible ? ('ranked' as const) : ('unrated' as const),
    unratedReason: lifecycle.rankedEligible ? null : lifecycle.unratedReason,
    appVersion: input.version.appVersion,
    buildId: input.version.buildId,
    rulesVersion: input.rulesVersion,
    datasetSha256: input.datasetSha256?.trim() || 'unknown',
    startedAt,
    completedAt,
    durationSeconds: startedAt
      ? Math.max(0, Math.min(86_400, Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)))
      : 0,
    turns: integer(G.turnNumber, 0, 9999) ?? 0,
    outcome: lifecycle.outcome,
    winnerSeat: lifecycle.winner,
    jankenWinnerSeat,
    gameoverReasonCode: lifecycle.gameoverReasonCode,
    finalHp,
    seatClasses,
    qualityFlags,
    actionCount: Array.isArray(actionLog) ? Math.min(actionLog.length, 2000) : 0,
    timeoutCount,
    disconnectCounts,
    reconnectCounts,
    seatResumeCounts: resumeCounts,
    deckCount: 2 as const,
    eventCount: events.length,
    captureSchemaVersion: MATCH_ANALYTICS_SCHEMA_VERSION as 1,
  };
  const integritySha256 = digest(JSON.stringify({ fact: factWithoutIntegrity, decks, events }));
  return { fact: { ...factWithoutIntegrity, integritySha256 }, decks, events };
}

export function projectMatchAnalytics(input: ProjectMatchAnalyticsInput): MatchAnalyticsProjection {
  const state = input.state as State & { G?: JsonRecord; ctx?: JsonRecord };
  const G = state.G ?? {};
  const winner = seat(record(state.ctx?.gameover)?.winner ?? G.winner);
  const completedAt = isoDate(G.matchEndedAt);
  if (!completedAt) throw new Error('Terminal analytics capture requires a valid completion timestamp');
  const events = projectEvents(sourceMatchDigest(input.sourceMatchId), G.actionLog);
  const outcome: MatchAnalyticsFact['outcome'] = events.some((event) => event.eventType === 'surrender')
    ? 'surrendered'
    : winner === null
      ? 'draw'
      : 'completed';
  return buildProjection(input, {
    completedAt,
    outcome,
    winner,
    rankedEligible: input.rankedEligible,
    unratedReason: input.unratedReason,
    gameoverReasonCode: gameoverReasonCode(events, winner),
  });
}

export function projectAbandonedMatchAnalytics(input: ProjectAbandonedMatchAnalyticsInput): MatchAnalyticsProjection {
  return buildProjection(input, {
    completedAt: input.abandonedAt,
    outcome: 'abandoned',
    winner: null,
    rankedEligible: false,
    unratedReason: 'abandoned',
    gameoverReasonCode: 'inactive-room',
  });
}
