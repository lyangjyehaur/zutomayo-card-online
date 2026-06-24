const API_BASE = '/api';

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

// ===== Matches =====

export async function submitMatch(winner: string, loser: string, turns: number, duration?: number) {
  return request('/match', {
    method: 'POST',
    body: JSON.stringify({ winner, loser, turns, duration }),
  });
}

// ===== Leaderboard =====

export async function getLeaderboard(limit = 100) {
  return request(`/leaderboard?limit=${limit}`);
}

// ===== Anonymous Merge =====

export async function mergeAnonymousData(anonymousMatches: any[]) {
  return request('/merge', {
    method: 'POST',
    body: JSON.stringify({ anonymousMatches }),
  });
}
