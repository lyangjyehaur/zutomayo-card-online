import type { ActionLogEntry, GameState } from '../game/types';

export interface MatchRecord {
  id: string;
  serverMatchId?: string;
  sourceMatchId?: string;
  date: string;
  duration: number; // seconds
  winner: 0 | 1 | null;
  outcome?: 'victory' | 'defeat' | 'draw';
  players: {
    hp: number;
    deckSize: number;
    cardsPlayed: number;
  }[];
  detailsAvailable?: boolean;
  chronos: {
    nightSidePlayer: 0 | 1;
    finalPosition: number;
  };
  turns: number;
  log: string[];
  actionLog: ActionLogEntry[];
}

export interface ServerMatchSummary {
  id: string;
  winnerId: string;
  loserId: string;
  winnerNickname?: string | null;
  loserNickname?: string | null;
  turns?: number | null;
  duration?: number | null;
  createdAt: string;
}

type MatchWinnerInput = string | number | null | undefined;

function normalizeSourceMatchId(sourceMatchId: string | undefined): string | undefined {
  const normalized = sourceMatchId?.trim();
  return normalized || undefined;
}

export function historyChatSubjectId(record: Pick<MatchRecord, 'sourceMatchId'>): string | null {
  return normalizeSourceMatchId(record.sourceMatchId) ?? null;
}

export function buildMatchHistoryChatPath(sourceMatchId: string): string {
  return `/history?chat=${encodeURIComponent(sourceMatchId)}`;
}

export function historyChatRecordFromSourceMatchId(sourceMatchId: string): MatchRecord {
  return {
    id: `chat:${sourceMatchId}`,
    sourceMatchId,
    date: new Date().toISOString(),
    duration: 0,
    winner: null,
    players: [
      { hp: 0, deckSize: 0, cardsPlayed: 0 },
      { hp: 0, deckSize: 0, cardsPlayed: 0 },
    ],
    chronos: {
      nightSidePlayer: 0,
      finalPosition: 0,
    },
    turns: 0,
    log: [],
    actionLog: [],
  };
}

export function resolveInitialHistoryChatRecord(
  records: MatchRecord[],
  initialChatSourceMatchId: string | null | undefined,
): MatchRecord | null {
  const sourceMatchId = normalizeSourceMatchId(initialChatSourceMatchId ?? undefined);
  if (!sourceMatchId) return null;
  return (
    records.find((record) => historyChatSubjectId(record) === sourceMatchId) ??
    historyChatRecordFromSourceMatchId(sourceMatchId)
  );
}

function normalizeWinner(winner: MatchWinnerInput): 0 | 1 | null {
  if (winner === 0 || winner === '0') return 0;
  if (winner === 1 || winner === '1') return 1;
  if (typeof winner !== 'string') return null;

  const playerWins = winner.match(/player\s*([01])\s*wins?/i);
  if (playerWins?.[1] === '0') return 0;
  if (playerWins?.[1] === '1') return 1;
  return null;
}

// Save match record to localStorage
export function saveMatchRecord(
  G: GameState,
  winner: MatchWinnerInput,
  durationSeconds = 0,
  sourceMatchId?: string,
  recordId = `match_${Date.now()}`,
  perspectivePlayer: 0 | 1 = 0,
): void {
  const normalizedWinner = normalizeWinner(winner);
  const record: MatchRecord = {
    id: recordId,
    sourceMatchId: normalizeSourceMatchId(sourceMatchId),
    date: new Date().toISOString(),
    duration: Math.max(0, Math.round(durationSeconds)),
    winner: normalizedWinner,
    outcome: normalizedWinner === null ? 'draw' : normalizedWinner === perspectivePlayer ? 'victory' : 'defeat',
    players: G.players.map((p) => ({
      hp: p.hp,
      deckSize: p.deck.length,
      cardsPlayed: p.abyss.length + p.powerCharger.length,
    })) as MatchRecord['players'],
    detailsAvailable: true,
    chronos: {
      nightSidePlayer: G.chronos.nightSidePlayer,
      finalPosition: G.chronos.position,
    },
    turns: G.turnNumber,
    log: G.log.slice(-20), // Last 20 log entries
    actionLog: G.actionLog ?? [],
  };

  const records = getMatchRecords();
  if (records.some((existing) => existing.id === record.id)) return;
  records.unshift(record); // Add to front

  // Keep last 50 records
  if (records.length > 50) records.pop();

  localStorage.setItem('zutomayo_match_records', JSON.stringify(records));
}

export function linkMatchRecordToServer(recordId: string, serverMatchId: string): void {
  const normalizedId = serverMatchId.trim();
  if (!normalizedId) return;
  const records = getMatchRecords();
  const index = records.findIndex((record) => record.id === recordId);
  if (index < 0) return;
  records[index] = { ...records[index], serverMatchId: normalizedId };
  localStorage.setItem('zutomayo_match_records', JSON.stringify(records));
}

export function matchRecordFromServer(match: ServerMatchSummary, accountId: string): MatchRecord {
  const isWinner = match.winnerId === accountId;
  const isLoser = match.loserId === accountId;
  const outcome: MatchRecord['outcome'] = isWinner ? 'victory' : isLoser ? 'defeat' : 'draw';
  return {
    id: `server:${match.id}`,
    serverMatchId: match.id,
    date: match.createdAt,
    duration: Math.max(0, Math.round(Number(match.duration) || 0)),
    winner: outcome === 'victory' ? 0 : outcome === 'defeat' ? 1 : null,
    outcome,
    players: [
      { hp: 0, deckSize: 0, cardsPlayed: 0 },
      { hp: 0, deckSize: 0, cardsPlayed: 0 },
    ],
    detailsAvailable: false,
    chronos: { nightSidePlayer: 0, finalPosition: 0 },
    turns: Math.max(0, Math.round(Number(match.turns) || 0)),
    log: [],
    actionLog: [],
  };
}

export function mergeMatchRecords(serverRecords: MatchRecord[], localRecords: MatchRecord[]): MatchRecord[] {
  const serverMatchIds = new Set(
    serverRecords.map((record) => record.serverMatchId).filter((id): id is string => Boolean(id)),
  );
  const serverSourceIds = new Set(
    serverRecords.map((record) => record.sourceMatchId).filter((id): id is string => Boolean(id)),
  );
  const merged = [
    ...serverRecords,
    ...localRecords.filter(
      (record) =>
        !(record.serverMatchId && serverMatchIds.has(record.serverMatchId)) &&
        !(record.sourceMatchId && serverSourceIds.has(record.sourceMatchId)),
    ),
  ];
  return merged.sort((a, b) => {
    const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
    return Number.isFinite(dateDiff) && dateDiff !== 0 ? dateDiff : b.id.localeCompare(a.id);
  });
}

// Get all match records
export function getMatchRecords(): MatchRecord[] {
  try {
    const data = localStorage.getItem('zutomayo_match_records');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Clear all records
export function clearMatchRecords(): void {
  localStorage.removeItem('zutomayo_match_records');
}

export function replaceMatchRecords(records: MatchRecord[]): void {
  localStorage.setItem('zutomayo_match_records', JSON.stringify(records.slice(0, 50)));
}

export function downloadActionLogJson(
  actionLog: ActionLogEntry[],
  filename = `zutomayo-action-log-${Date.now()}.json`,
): void {
  const blob = new Blob([JSON.stringify(actionLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadMatchActionLog(record: MatchRecord): void {
  downloadActionLogJson(record.actionLog ?? [], `${record.id}-action-log.json`);
}

// Get stats summary
export function getMatchStats(records = getMatchRecords()): {
  totalMatches: number;
  wins: [number, number];
  winRate: [number, number];
  avgTurns: number;
} {
  const wins: [number, number] = [0, 0];
  let totalTurns = 0;

  for (const r of records) {
    if (r.outcome === 'victory') wins[0]++;
    else if (r.outcome === 'defeat') wins[1]++;
    else if (!r.outcome) {
      if (r.winner === 0) wins[0]++;
      if (r.winner === 1) wins[1]++;
    }
    totalTurns += r.turns;
  }

  const total = records.length || 1;
  return {
    totalMatches: records.length,
    wins,
    winRate: [Math.round((wins[0] / total) * 100), Math.round((wins[1] / total) * 100)],
    avgTurns: Math.round(totalTurns / total),
  };
}
