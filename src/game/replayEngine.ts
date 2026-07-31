import { APP_VERSION_INFO } from '../version';
import { getAllCardDefs } from './cards/loader';
import {
  chooseJanken,
  confirmReady,
  finishMulligan,
  resolvePendingEffect,
  setInitialCard,
  setTurnCard,
  setupGame,
  surrenderGame,
  submitPendingChoice,
  timeoutAdvance,
  timeoutSkip,
  TURN_TIMER_MS,
  undoSetCard,
} from './GameLogic';
import { canonicalizeReplayArgs, createReplayRequestFingerprint, createReplayStateFingerprint } from './decisionTrace';
import { parseAllEffects } from './effects';
import { GAME_RNG_ALGORITHM } from './rng';
import type {
  GameState,
  JankenChoice,
  PlayerIndex,
  ReplayDecisionRecord,
  ReplayDivergence,
  ReplayManifest,
  SetSlot,
} from './types';

export type ReplayResult =
  | { ok: true; G: GameState }
  | { ok: false; G: GameState | null; divergence: ReplayDivergence };

const jankenChoices = new Set<JankenChoice>(['rock', 'paper', 'scissors']);
const setSlots = new Set<SetSlot>(['A', 'B', 'C']);

function isPlayerIndex(value: unknown): value is PlayerIndex {
  return value === 0 || value === 1;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isInteger);
}

function expireTimeoutPrecondition(G: GameState): void {
  const expiredAt = Date.now() - TURN_TIMER_MS - 1;
  G.turnStartTime = expiredAt;
  G.interactionStartTime = expiredAt;
}

function rejectUnsupportedReplayMove(_move: never): false {
  return false;
}

function applyReplayDecision(
  G: GameState,
  record: ReplayDecisionRecord,
  effects: ReturnType<typeof parseAllEffects>,
): boolean {
  const { args, move, player } = record;

  switch (move) {
    case 'janken':
      return args.length === 1 && jankenChoices.has(args[0] as JankenChoice)
        ? chooseJanken(G, player, args[0] as JankenChoice)
        : false;
    case 'mulligan':
      return args.length === 1 && isIntegerArray(args[0]) ? finishMulligan(G, player, args[0]) : false;
    case 'keepHand':
      return args.length === 0 ? finishMulligan(G, player, []) : false;
    case 'setInitialCard':
      return args.length === 1 && isInteger(args[0]) ? setInitialCard(G, player, args[0]) : false;
    case 'setTurnCard':
      return args.length === 2 && isInteger(args[0]) && setSlots.has(args[1] as SetSlot)
        ? setTurnCard(G, player, args[0], args[1] as SetSlot)
        : false;
    case 'undoSetCard':
      return args.length === 1 && setSlots.has(args[0] as SetSlot) ? undoSetCard(G, player, args[0] as SetSlot) : false;
    case 'confirmReady':
      return args.length === 0 ? confirmReady(G, player, effects) : false;
    case 'timeoutSkip': {
      if (args.length > 1 || (args.length === 1 && !isPlayerIndex(args[0]))) return false;
      expireTimeoutPrecondition(G);
      const target = args.length === 1 ? (args[0] as PlayerIndex) : player;
      return timeoutSkip(G, target, effects);
    }
    case 'timeoutAdvance': {
      if (args.length > 1 || (args.length === 1 && !isPlayerIndex(args[0]))) return false;
      expireTimeoutPrecondition(G);
      const target = args.length === 1 ? (args[0] as PlayerIndex) : player;
      return timeoutAdvance(G, target, effects);
    }
    case 'surrender':
      return args.length === 0 ? surrenderGame(G, player) : false;
    case 'resolvePendingEffect':
      return args.length === 1 && isInteger(args[0]) ? resolvePendingEffect(G, player, args[0], effects) : false;
    case 'submitPendingChoice':
      return args.length === 1 && isStringArray(args[0]) ? submitPendingChoice(G, player, args[0], effects) : false;
    default:
      return rejectUnsupportedReplayMove(move);
  }
}

function fail(G: GameState | null, divergence: ReplayDivergence, decisionsApplied: number): ReplayResult {
  if (G) G.replayStatus = { status: 'diverged', decisionsApplied, divergence };
  return { ok: false, G, divergence };
}

function supportedManifest(manifest: ReplayManifest): boolean {
  return (
    Boolean(manifest) &&
    typeof manifest === 'object' &&
    manifest.schemaVersion === 1 &&
    manifest.rngAlgorithm === GAME_RNG_ALGORITHM &&
    typeof manifest.seed === 'number' &&
    Number.isFinite(manifest.seed) &&
    typeof manifest.rulesVersion === 'string' &&
    Array.isArray(manifest.deckDefIds) &&
    manifest.deckDefIds.length === 2 &&
    manifest.deckDefIds.every(
      (deck) => Array.isArray(deck) && deck.length === 20 && deck.every((defId) => typeof defId === 'string'),
    )
  );
}

export function replayMatch(manifest: ReplayManifest, decisions: readonly ReplayDecisionRecord[]): ReplayResult {
  if (!supportedManifest(manifest)) {
    return fail(null, { sequence: 0, reason: 'unsupportedManifest' }, 0);
  }
  if (manifest.rulesVersion !== APP_VERSION_INFO.rulesVersion) {
    return fail(
      null,
      {
        sequence: 0,
        reason: 'rulesVersion',
        expected: APP_VERSION_INFO.rulesVersion,
        actual: manifest.rulesVersion,
      },
      0,
    );
  }

  let G: GameState;
  let effects: ReturnType<typeof parseAllEffects>;
  try {
    G = setupGame(
      {
        deck0Ids: [...manifest.deckDefIds[0]],
        deck1Ids: [...manifest.deckDefIds[1]],
        rngSeed: manifest.seed,
        rulesVersion: manifest.rulesVersion,
      },
      { allowBrowserCustomDeckName: true },
    );
    effects = parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));
  } catch {
    return fail(null, { sequence: 0, reason: 'unsupportedManifest' }, 0);
  }
  G.decisionTrace = [];

  for (let index = 0; index < decisions.length; index++) {
    const record = decisions[index];
    const expectedSequence = index + 1;
    if (!record || typeof record !== 'object' || record.schemaVersion !== 1 || !isPlayerIndex(record.player)) {
      return fail(G, { sequence: expectedSequence, reason: 'invalidDecision' }, index);
    }
    if (record.sequence !== expectedSequence) {
      return fail(
        G,
        {
          sequence: expectedSequence,
          reason: 'sequence',
          expected: String(expectedSequence),
          actual: String(record.sequence),
        },
        index,
      );
    }

    let actualRequestFingerprint: string;
    try {
      actualRequestFingerprint = createReplayRequestFingerprint(G, record.player, record.move, record.args);
    } catch {
      return fail(G, { sequence: record.sequence, reason: 'invalidDecision' }, index);
    }
    if (actualRequestFingerprint !== record.requestFingerprint) {
      return fail(
        G,
        {
          sequence: record.sequence,
          reason: 'requestFingerprint',
          expected: record.requestFingerprint,
          actual: actualRequestFingerprint,
        },
        index,
      );
    }

    let applied = false;
    try {
      applied = applyReplayDecision(G, record, effects);
    } catch {
      applied = false;
    }
    if (!applied) return fail(G, { sequence: record.sequence, reason: 'invalidDecision' }, index);

    const actualStateFingerprint = createReplayStateFingerprint(G);
    if (actualStateFingerprint !== record.stateFingerprintAfter) {
      return fail(
        G,
        {
          sequence: record.sequence,
          reason: 'stateFingerprint',
          expected: record.stateFingerprintAfter,
          actual: actualStateFingerprint,
        },
        index,
      );
    }
    G.decisionTrace.push({ ...record, args: canonicalizeReplayArgs(record.args) });
  }

  G.replayStatus = { status: 'verified', decisionsApplied: decisions.length };
  return { ok: true, G };
}
