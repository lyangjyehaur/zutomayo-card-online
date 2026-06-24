import type { GameState } from '../game/types';

export interface MatchRecord {
  id: string;
  date: string;
  duration: number; // seconds
  winner: 0 | 1 | null;
  players: {
    hp: number;
    deckSize: number;
    cardsPlayed: number;
  }[];
  chronos: {
    nightSidePlayer: 0 | 1;
    finalPosition: number;
  };
  turns: number;
  log: string[];
}

type MatchWinnerInput = string | number | null | undefined;

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
export function saveMatchRecord(G: GameState, winner: MatchWinnerInput, durationSeconds = 0): void {
  const record: MatchRecord = {
    id: `match_${Date.now()}`,
    date: new Date().toISOString(),
    duration: Math.max(0, Math.round(durationSeconds)),
    winner: normalizeWinner(winner),
    players: G.players.map(p => ({
      hp: p.hp,
      deckSize: p.deck.length,
      cardsPlayed: p.abyss.length + p.powerCharger.length,
    })) as MatchRecord['players'],
    chronos: {
      nightSidePlayer: G.chronos.nightSidePlayer,
      finalPosition: G.chronos.position,
    },
    turns: G.turnNumber,
    log: G.log.slice(-20), // Last 20 log entries
  };

  const records = getMatchRecords();
  records.unshift(record); // Add to front

  // Keep last 50 records
  if (records.length > 50) records.pop();

  localStorage.setItem('zutomayo_match_records', JSON.stringify(records));
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

// Get stats summary
export function getMatchStats(): {
  totalMatches: number;
  wins: [number, number];
  winRate: [number, number];
  avgTurns: number;
} {
  const records = getMatchRecords();
  const wins: [number, number] = [0, 0];
  let totalTurns = 0;

  for (const r of records) {
    if (r.winner === 0) wins[0]++;
    if (r.winner === 1) wins[1]++;
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
