const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('zutomayo_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===== Auth =====
export async function register(email: string, password: string, nickname?: string) {
  const data = await request('/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, nickname }),
  });
  localStorage.setItem('zutomayo_token', data.token);
  return data.user;
}

export async function login(email: string, password: string) {
  const data = await request('/login', {
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
export async function getProfile() {
  return request('/profile');
}

// ===== Decks =====
export async function getDecks() {
  return request('/decks');
}

export async function createDeck(name: string, cardIds: string[]) {
  return request('/decks', {
    method: 'POST',
    body: JSON.stringify({ name, cardIds }),
  });
}

export async function deleteDeck(deckId: string) {
  return request(`/decks/${deckId}`, { method: 'DELETE' });
}

// ===== Matches =====
export async function submitMatch(winnerId: string, loserId: string, turns: number, duration?: number) {
  return request('/matches', {
    method: 'POST',
    body: JSON.stringify({ winnerId, loserId, turns, duration }),
  });
}

// ===== Leaderboard =====
export async function getLeaderboard(limit = 100) {
  return request(`/leaderboard?limit=${limit}`);
}
