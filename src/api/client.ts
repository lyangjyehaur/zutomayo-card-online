import type { ActionLogEntry, CardDef } from '../game/types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';
const LOGTO_AUTH_KEY = 'zutomayo_logto_authenticated';
const PUBLIC_DATA_CACHE_MS = 5 * 60 * 1000;

let cardsCache: { expiresAt: number; data: CardDef[] } | null = null;
let configCache: { expiresAt: number; data: Record<string, unknown> } | null = null;
let presetDecksCache: { expiresAt: number; data: Array<{ id: string; name: string; cardIds: string[] }> } | null = null;
let accessTokenProvider: (() => Promise<string | null | undefined>) | null = null;

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

export function setAccessTokenProvider(provider: (() => Promise<string | null | undefined>) | null): void {
  accessTokenProvider = provider;
}

export function setLogtoAuthenticated(authenticated: boolean): void {
  if (authenticated) {
    localStorage.setItem(LOGTO_AUTH_KEY, '1');
  } else {
    localStorage.removeItem(LOGTO_AUTH_KEY);
  }
}

async function getAuthToken(): Promise<string | null> {
  if (accessTokenProvider) {
    const token = await accessTokenProvider();
    if (token) return token;
  }
  return null;
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
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

function adminAuthHeaders(): Record<string, string> {
  const token =
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ADMIN_TOKEN_KEY)) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(ADMIN_TOKEN_KEY)) ||
    '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isFresh<T>(cache: { expiresAt: number; data: T } | null): cache is { expiresAt: number; data: T } {
  return Boolean(cache && cache.expiresAt > Date.now());
}

// ===== Public Data =====
export async function fetchCards(force = false): Promise<CardDef[]> {
  if (!force && isFresh(cardsCache)) return cardsCache.data;
  const data = await request<CardDef[]>('/cards');
  cardsCache = { data, expiresAt: Date.now() + PUBLIC_DATA_CACHE_MS };
  return data;
}

export async function fetchAllCardI18n(): Promise<Record<string, Record<string, string>>> {
  return request<Record<string, Record<string, string>>>('/cards/i18n');
}

export async function fetchCardI18n(cardId: string): Promise<Record<string, string>> {
  return request<Record<string, string>>(`/cards/${encodeURIComponent(cardId)}/i18n`);
}

export async function fetchGameConfig(): Promise<Record<string, unknown>> {
  if (isFresh(configCache)) return configCache.data;
  const data = await request<Record<string, unknown>>('/config');
  configCache = { data, expiresAt: Date.now() + PUBLIC_DATA_CACHE_MS };
  return data;
}

export async function fetchPresetDecks(): Promise<Array<{ id: string; name: string; cardIds: string[] }>> {
  if (isFresh(presetDecksCache)) return presetDecksCache.data;
  const data = await request<Array<{ id: string; name: string; cardIds: string[] }>>('/preset-decks');
  presetDecksCache = { data, expiresAt: Date.now() + PUBLIC_DATA_CACHE_MS };
  return data;
}

export function logout() {
  accessTokenProvider = null;
  localStorage.removeItem(LOGTO_AUTH_KEY);
}

export function isLoggedIn(): boolean {
  return localStorage.getItem(LOGTO_AUTH_KEY) === '1';
}

// ===== Profile =====
export async function getProfile(): Promise<ProfileResponse> {
  return request('/profile');
}

export async function syncLogtoProfile(profile: {
  email?: string | null;
  nickname?: string | null;
}): Promise<ProfileResponse> {
  return request('/logto/profile', {
    method: 'POST',
    body: JSON.stringify(profile),
  });
}

// ===== Decks =====
export async function getDecks(): Promise<DeckResponse[]> {
  const data = await request<DeckListResponse>('/decks');
  return data.decks.map((deck) => ({
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
  sourceMatchId?: string,
  winnerPlayer?: 0 | 1,
) {
  return request('/matches', {
    method: 'POST',
    body: JSON.stringify({ winnerId, loserId, turns, duration, actionLog, sourceMatchId, winnerPlayer }),
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

export async function adminUpdateCard(id: string, card: Partial<CardDef>): Promise<CardDef> {
  const updated = await request<CardDef>(`/admin/cards/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: adminAuthHeaders(),
    body: JSON.stringify(card),
  });
  cardsCache = null;
  return updated;
}

export async function adminUpdateConfig(key: string, value: unknown): Promise<void> {
  await request<{ key: string; value: unknown }>(`/admin/config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: adminAuthHeaders(),
    body: JSON.stringify({ value }),
  });
  configCache = null;
}

export async function adminUpdateCardI18n(cardId: string, lang: string, effectText: string): Promise<void> {
  await request<{ ok: boolean }>(`/admin/cards/${encodeURIComponent(cardId)}/i18n`, {
    method: 'PUT',
    headers: adminAuthHeaders(),
    body: JSON.stringify({ lang, effectText }),
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
