import {
  REPLAY_MOVE_NAMES,
  canonicalJsonStringify,
  canonicalReplayState,
  canonicalizeReplayArgs,
  createReplayStateFingerprint,
} from './decisionTrace';
import { replayMatch, type ReplayResult } from './replayEngine';
import type { GameState, ReplayDecisionRecord, ReplayManifest } from './types';

export const REPLAY_TRANSCRIPT_SCHEMA_VERSION = 1 as const;

export interface ReplayTranscriptManifestLine {
  schemaVersion: typeof REPLAY_TRANSCRIPT_SCHEMA_VERSION;
  type: 'manifest';
  manifest: ReplayManifest;
}

export interface ReplayTranscriptDecisionLine {
  schemaVersion: typeof REPLAY_TRANSCRIPT_SCHEMA_VERSION;
  type: 'decision';
  decision: ReplayDecisionRecord;
}

export interface ReplayTranscriptStateLine {
  schemaVersion: typeof REPLAY_TRANSCRIPT_SCHEMA_VERSION;
  type: 'state';
  decisionCount: number;
  stateFingerprint: string;
  state: Record<string, unknown>;
}

export type ReplayTranscriptLine =
  | ReplayTranscriptManifestLine
  | ReplayTranscriptDecisionLine
  | ReplayTranscriptStateLine;

export interface ParsedReplayTranscript {
  manifest: ReplayManifest;
  decisions: ReplayDecisionRecord[];
  finalStateFingerprint: string;
  finalState: Record<string, unknown>;
}

export type ReplayTranscriptResult = { ok: true; G: GameState; jsonl: string } | Extract<ReplayResult, { ok: false }>;

const replayMoveNames = new Set<string>(REPLAY_MOVE_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseCanonicalLine(line: string, lineNumber: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`Replay transcript line ${lineNumber} is not valid JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`Replay transcript line ${lineNumber} must be an object`);
  if (canonicalJsonStringify(parsed) !== line) {
    throw new Error(`Replay transcript line ${lineNumber} is not canonical JSON`);
  }
  return parsed;
}

function parseDecision(value: unknown, lineNumber: number): ReplayDecisionRecord {
  if (!isRecord(value)) throw new Error(`Replay transcript line ${lineNumber} has no decision object`);
  if (
    value.schemaVersion !== 1 ||
    !Number.isInteger(value.sequence) ||
    (value.player !== 0 && value.player !== 1) ||
    typeof value.move !== 'string' ||
    !replayMoveNames.has(value.move) ||
    !Array.isArray(value.args) ||
    typeof value.requestFingerprint !== 'string' ||
    typeof value.stateFingerprintAfter !== 'string'
  ) {
    throw new Error(`Replay transcript line ${lineNumber} has an invalid decision`);
  }
  return {
    schemaVersion: 1,
    sequence: value.sequence as number,
    player: value.player,
    move: value.move as ReplayDecisionRecord['move'],
    args: canonicalizeReplayArgs(value.args),
    requestFingerprint: value.requestFingerprint,
    stateFingerprintAfter: value.stateFingerprintAfter,
  };
}

export function createReplayTranscript(
  manifest: ReplayManifest,
  decisions: readonly ReplayDecisionRecord[],
): ReplayTranscriptResult {
  const replay = replayMatch(manifest, decisions);
  if (!replay.ok) return replay;

  const lines: ReplayTranscriptLine[] = [
    {
      schemaVersion: REPLAY_TRANSCRIPT_SCHEMA_VERSION,
      type: 'manifest',
      manifest,
    },
    ...decisions.map(
      (decision): ReplayTranscriptDecisionLine => ({
        schemaVersion: REPLAY_TRANSCRIPT_SCHEMA_VERSION,
        type: 'decision',
        decision: { ...decision, args: canonicalizeReplayArgs(decision.args) },
      }),
    ),
    {
      schemaVersion: REPLAY_TRANSCRIPT_SCHEMA_VERSION,
      type: 'state',
      decisionCount: decisions.length,
      stateFingerprint: createReplayStateFingerprint(replay.G),
      state: canonicalReplayState(replay.G),
    },
  ];

  return {
    ok: true,
    G: replay.G,
    jsonl: `${lines.map((line) => canonicalJsonStringify(line)).join('\n')}\n`,
  };
}

export function parseReplayTranscript(jsonl: string): ParsedReplayTranscript {
  if (!jsonl.endsWith('\n')) throw new Error('Replay transcript must end with a newline');
  const rawLines = jsonl.slice(0, -1).split('\n');
  if (rawLines.length < 2) throw new Error('Replay transcript requires manifest and state lines');
  const lines = rawLines.map((line, index) => parseCanonicalLine(line, index + 1));

  const header = lines[0];
  if (header.schemaVersion !== REPLAY_TRANSCRIPT_SCHEMA_VERSION || header.type !== 'manifest') {
    throw new Error('Replay transcript must start with a schema v1 manifest line');
  }
  if (!isRecord(header.manifest)) throw new Error('Replay transcript manifest is invalid');

  const footer = lines.at(-1)!;
  if (footer.schemaVersion !== REPLAY_TRANSCRIPT_SCHEMA_VERSION || footer.type !== 'state') {
    throw new Error('Replay transcript must end with a schema v1 state line');
  }
  if (
    !Number.isInteger(footer.decisionCount) ||
    typeof footer.stateFingerprint !== 'string' ||
    !isRecord(footer.state)
  ) {
    throw new Error('Replay transcript final state line is invalid');
  }

  const decisions = lines.slice(1, -1).map((line, index) => {
    if (line.schemaVersion !== REPLAY_TRANSCRIPT_SCHEMA_VERSION || line.type !== 'decision') {
      throw new Error(`Replay transcript line ${index + 2} must be a schema v1 decision line`);
    }
    return parseDecision(line.decision, index + 2);
  });
  if (footer.decisionCount !== decisions.length) {
    throw new Error('Replay transcript decision count does not match its decision lines');
  }

  return {
    manifest: header.manifest as unknown as ReplayManifest,
    decisions,
    finalStateFingerprint: footer.stateFingerprint,
    finalState: footer.state,
  };
}
