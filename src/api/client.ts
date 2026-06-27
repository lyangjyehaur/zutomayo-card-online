import type { ActionLogEntry } from '../game/types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface DeckResponse {
  id: string;
  name: string;
  cardIds: string[];
}

export interface ProfileResponse {
  id: string;
  email: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  id: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
}

interface DeckListResponse {
  decks: DeckResponse[];
}

interface LeaderboardListResponse {
  leaderboard: LeaderboardEntry[];
}

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('zutomayo_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) throw new ApiError((data.error as string) || 'Request failed', res.status);
  return data as T;
}

// ===== Auth =====
interface AuthResponse {
  token: string;
  user: ProfileResponse;
}

export async function register(email: string, password: string, nickname?: string) {
  const data = await request<AuthResponse>('/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, nickname }),
  });
  localStorage.setItem('zutomayo_token', data.token);
  return data.user;
}

export async function login(email: string, password: string) {
  const data = await request<AuthResponse>('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem('zutomayo_token', data.token);
  return data.user;
}

export function logout() {
  localStorage.removeItem('zutomayo_token');
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem('zutomayo_token');
}

// ===== Profile =====
export async function getProfile(): Promise<ProfileResponse> {
  return request('/profile');
}

// ===== Decks =====
export async function getDecks(): Promise<DeckResponse[]> {
  const data = await request<DeckListResponse>('/decks');
  return data.decks.map(deck => ({
    id: deck.id,
    name: deck.name,
    cardIds: deck.cardIds,
  }));
}

export async function createDeck(name: string, cardIds: string[]): Promise<DeckResponse> {
  return request<DeckResponse>('/decks', {
    method: 'POST',
    body: JSON.stringify({ name, cardIds }),
  });
}

export async function deleteDeck(deckId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/decks/${deckId}`, { method: 'DELETE' });
}

// ===== Matches =====
export async function submitMatch(
  winnerId: string,
  loserId: string,
  turns: number,
  duration?: number,
  actionLog?: ActionLogEntry[],
) {
  return request('/matches', {
    method: 'POST',
    body: JSON.stringify({ winnerId, loserId, turns, duration, actionLog }),
  });
}

export async function getMatchLog(matchId: string): Promise<ActionLogEntry[]> {
  const data = await request<{ matchId: string; actionLog: ActionLogEntry[] }>(`/matches/${matchId}/log`);
  return data.actionLog;
}

// ===== Leaderboard =====
export async function getLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const data = await request<LeaderboardListResponse>(`/leaderboard?limit=${limit}`);
  return data.leaderboard;
}

// ===== Admin =====
export interface AdminUser {
  id: string;
  email: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
  createdAt: string;
}

export interface AdminMatch {
  id: string;
  winnerId: string;
  loserId: string;
  winnerNickname: string | null;
  loserNickname: string | null;
  winnerEloChange: number;
  loserEloChange: number;
  turns: number;
  duration: number;
  createdAt: string;
}

export async function adminLogin(password: string): Promise<{ token: string }> {
  return request<{ token: string }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function adminGetUsers(token: string, limit = 100): Promise<{ users: AdminUser[] }> {
  const data = await request<{ users: AdminUser[] }>(`/admin/users?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function adminGetMatches(token: string, limit = 50): Promise<{ matches: AdminMatch[] }> {
  const data = await request<{ matches: AdminMatch[] }>(`/admin/matches?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function adminResetElo(token: string, userId: string, elo: number): Promise<{ id: string; elo: number }> {
  return request<{ id: string; elo: number }>(`/admin/users/${userId}/elo`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ elo }),
  });
}

// ===== Matchmaking =====
export interface MatchmakingQueueResponse {
  queueId: string;
  status: 'queued' | 'matched';
}

export interface MatchmakingStatusResponse {
  status: 'queued' | 'matched' | 'timeout';
  matchId?: string;
  opponentId?: string;
  role?: 'host' | 'guest';
  realMatchId?: string;
}

export async function matchmakingQueue(deckName?: string, deckIds?: string[]): Promise<MatchmakingQueueResponse> {
  return request<MatchmakingQueueResponse>('/matchmaking/queue', {
    method: 'POST',
    body: JSON.stringify({ deckName, deckIds }),
  });
}

export async function matchmakingStatus(): Promise<MatchmakingStatusResponse> {
  return request<MatchmakingStatusResponse>('/matchmaking/status');
}

export async function matchmakingLeave(): Promise<void> {
  await request<{ deleted: boolean }>('/matchmaking/queue', { method: 'DELETE' });
}

export async function matchmakingReportMatch(realMatchId: string): Promise<void> {
  await request<{ ok: boolean }>('/matchmaking/match', {
    method: 'PUT',
    body: JSON.stringify({ matchId: realMatchId }),
  });
}
