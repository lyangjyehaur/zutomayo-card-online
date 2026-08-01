/* global module */

const REPLAY_SUMMARY_SCHEMA_VERSION = 1;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (depth >= 6) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeValue(item, depth + 1));
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 200)
      .map(([key, child]) => [key.slice(0, 120), safeValue(child, depth + 1)]),
  );
}

function playerIndex(value) {
  return value === 0 || value === 1 ? value : null;
}

function summarizePhases(timeline) {
  const phases = [];
  for (const entry of timeline) {
    const step = typeof entry.step === 'string' && entry.step ? entry.step.slice(0, 80) : 'unknown';
    const turn = Number.isInteger(entry.turn) ? entry.turn : 0;
    const previous = phases.at(-1);
    if (previous && previous.step === step) {
      previous.toTurn = Math.max(previous.toTurn, turn);
      previous.actionCount++;
    } else {
      phases.push({ step, fromTurn: turn, toTurn: turn, actionCount: 1 });
    }
  }
  return phases;
}

function summarizeEffects(timeline) {
  return timeline
    .filter(
      (entry) =>
        typeof entry.pendingEffectCardDefId === 'string' ||
        entry.action === 'resolvePendingEffect' ||
        entry.action === 'effect',
    )
    .map((entry, index) => ({
      order: index + 1,
      turn: Number.isInteger(entry.turn) ? entry.turn : 0,
      step: typeof entry.step === 'string' ? entry.step : 'unknown',
      player: playerIndex(entry.player),
      action: typeof entry.action === 'string' ? entry.action : 'effect',
      cardDefId: typeof entry.pendingEffectCardDefId === 'string' ? entry.pendingEffectCardDefId : null,
      choiceType: typeof entry.pendingChoiceType === 'string' ? entry.pendingChoiceType : null,
      result: safeValue(entry.result),
    }));
}

function summarizeRevealedHands(timeline) {
  const hands = [new Set(), new Set()];
  for (const entry of timeline) {
    if (entry.action !== 'revealCards' || !isRecord(entry.payload) || entry.payload.sourceZone !== 'hand') continue;
    const target = playerIndex(entry.payload.targetPlayer);
    if (target === null || !Array.isArray(entry.payload.cardDefIds)) continue;
    for (const cardDefId of entry.payload.cardDefIds) {
      if (typeof cardDefId === 'string' && cardDefId) hands[target].add(cardDefId.slice(0, 120));
    }
  }
  return hands.map((cards, player) => ({ player, cardDefIds: [...cards] }));
}

function createSearchText(summary) {
  const searchable = {
    rulesVersion: summary.rulesVersion,
    result: summary.result,
    phases: summary.phases,
    decisions: summary.decisions.map(({ sequence, player, move, args }) => ({ sequence, player, move, args })),
    effects: summary.effects,
    revealedHands: summary.revealedHands,
    timeline: summary.timeline,
  };
  const terms = new Set();
  const visit = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      terms.add(String(value).toLocaleLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (isRecord(value)) Object.values(value).forEach(visit);
  };
  visit(searchable);
  return [...terms].join(' ').slice(0, 10_000);
}

function createReplaySummary(G, rulesVersion, actionLog) {
  const safeTimeline = Array.isArray(actionLog) ? safeValue(actionLog) : [];
  const timeline = Array.isArray(safeTimeline) ? safeTimeline.filter(isRecord) : [];
  const rawDecisions = Array.isArray(G?.decisionTrace) ? G.decisionTrace : [];
  const decisions = rawDecisions.map((decision, index) => ({
    sequence: Number.isInteger(decision?.sequence) ? decision.sequence : index + 1,
    player: playerIndex(decision?.player),
    move: typeof decision?.move === 'string' ? decision.move.slice(0, 80) : 'unknown',
    args: safeValue(Array.isArray(decision?.args) ? decision.args : []),
    requestFingerprint:
      typeof decision?.requestFingerprint === 'string' ? decision.requestFingerprint.slice(0, 120) : '',
    stateFingerprintAfter:
      typeof decision?.stateFingerprintAfter === 'string' ? decision.stateFingerprintAfter.slice(0, 120) : '',
  }));
  const summary = {
    schemaVersion: REPLAY_SUMMARY_SCHEMA_VERSION,
    traceComplete: G?.replayManifest?.schemaVersion === 1 && Array.isArray(G?.decisionTrace),
    rulesVersion: String(rulesVersion || G?.replayManifest?.rulesVersion || 'legacy').slice(0, 120),
    result: {
      winner: playerIndex(G?.winner),
      reason: typeof G?.gameoverReason === 'string' ? G.gameoverReason.slice(0, 160) : null,
      turns: Number.isInteger(G?.turnNumber) ? G.turnNumber : 0,
      finalHp: [Number(G?.players?.[0]?.hp) || 0, Number(G?.players?.[1]?.hp) || 0],
      finalChronos: Number(G?.chronos?.position) || 0,
    },
    phases: summarizePhases(timeline),
    decisions,
    effects: summarizeEffects(timeline),
    revealedHands: summarizeRevealedHands(timeline),
    timeline,
  };
  return { ...summary, searchText: createSearchText(summary) };
}

module.exports = {
  REPLAY_SUMMARY_SCHEMA_VERSION,
  createReplaySummary,
};
