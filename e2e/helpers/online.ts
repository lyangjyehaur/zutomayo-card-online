import type { APIRequestContext, APIResponse, BrowserContext, Page } from '@playwright/test';

const ONLINE_SESSION_STORAGE_KEY = 'zutomayo_online_session';

export type OnlinePlayerID = '0' | '1';

export interface AppVersionInfo {
  appVersion: string;
  buildId: string;
  rulesVersion: string;
}

export interface OnlineSeat {
  playerID: OnlinePlayerID;
  playerName: string;
  playerCredentials: string;
  platformSeatToken?: string;
  platformUserId?: string;
}

export interface ProvisionedOnlineMatch {
  matchID: string;
  clientVersion: AppVersionInfo;
  seats: Record<OnlinePlayerID, OnlineSeat>;
}

export interface AuthenticatedOnlineAccount {
  id: string;
  email: string;
  nickname: string;
  elo: number;
}

const AUTH_PASSWORD = process.env.E2E_AUTH_PASSWORD || 'E2e-service-secret-123!';

export interface AuthenticatedMatchHistoryEntry {
  id: string;
  winnerId?: string | null;
  loserId?: string | null;
  sourceMatchId?: string | null;
  winnerNickname?: string | null;
  loserNickname?: string | null;
}

async function responseError(response: APIResponse): Promise<Error> {
  return new Error(`${response.url()} failed with ${response.status()}: ${await response.text()}`);
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  if (!response.ok()) throw await responseError(response);
  return response.json() as Promise<T>;
}

async function postJson<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(path, { data });
  if (!response.ok()) throw await responseError(response);
  return response.json() as Promise<T>;
}

async function csrfToken(context: BrowserContext): Promise<string> {
  let token = (await context.cookies()).find((cookie) => cookie.name === 'zutomayo_csrf')?.value;
  if (!token) {
    const response = await context.request.get('/api/csrf-token');
    if (!response.ok()) throw await responseError(response);
    token = (await context.cookies()).find((cookie) => cookie.name === 'zutomayo_csrf')?.value;
  }
  if (!token) throw new Error('Authenticated browser context did not receive a CSRF cookie');
  return token;
}

async function postAuthenticatedJson<T>(context: BrowserContext, path: string, data: unknown): Promise<T> {
  const response = await context.request.post(path, {
    data,
    headers: { 'X-CSRF-Token': await csrfToken(context) },
  });
  if (!response.ok()) throw await responseError(response);
  return response.json() as Promise<T>;
}

function accountSuffix(label: string): string {
  const cleanLabel =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'player';
  return `${cleanLabel}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function registerAuthenticatedOnlineAccount(
  context: BrowserContext,
  nickname: string,
): Promise<AuthenticatedOnlineAccount> {
  const email = `${accountSuffix(nickname)}@e2e.example.test`;
  const response = await context.request.post('/api/register', {
    data: {
      email,
      password: AUTH_PASSWORD,
      nickname,
    },
  });
  if (!response.ok()) throw await responseError(response);
  const body = (await response.json()) as {
    token?: unknown;
    user?: Partial<AuthenticatedOnlineAccount>;
  };
  if (
    typeof body.token !== 'string' ||
    !body.token ||
    typeof body.user?.id !== 'string' ||
    typeof body.user.nickname !== 'string' ||
    typeof body.user.elo !== 'number'
  ) {
    throw new Error('Registration did not return a complete authenticated account');
  }

  // Registration proves account creation, but RR-05 explicitly requires the
  // returning-player login path. Clear the newly issued cookies and establish
  // the session again through /api/login before opening the lobby.
  await context.clearCookies();
  const loginResponse = await context.request.post('/api/login', {
    data: { email, password: AUTH_PASSWORD },
  });
  if (!loginResponse.ok()) throw await responseError(loginResponse);
  const loginBody = (await loginResponse.json()) as { user?: Partial<AuthenticatedOnlineAccount> };
  if (loginBody.user?.id !== body.user.id) {
    throw new Error('Login did not restore the account created for authenticated E2E');
  }

  await context.addInitScript(() => {
    localStorage.setItem('zutomayo_session', '1');
    localStorage.setItem('zutomayo_locale', 'zh-TW');
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
  });

  return {
    id: body.user.id,
    email,
    nickname: body.user.nickname,
    elo: body.user.elo,
  };
}

export async function assertSecureAuthenticatedCookies(context: BrowserContext, baseURL: string): Promise<void> {
  const cookies = await context.cookies();
  const expectedHost = new URL(baseURL).hostname;
  const matchesExpectedHost = (domain: string) => {
    const normalized = domain.replace(/^\./, '');
    return expectedHost === normalized || expectedHost.endsWith(`.${normalized}`);
  };
  const session = cookies.find((cookie) => cookie.name === 'zutomayo_session');
  const refresh = cookies.find((cookie) => cookie.name === 'zutomayo_refresh');
  const csrf = cookies.find((cookie) => cookie.name === 'zutomayo_csrf');
  const failures: string[] = [];
  if (!session) failures.push('zutomayo_session is missing');
  else {
    if (!matchesExpectedHost(session.domain)) failures.push('zutomayo_session domain is invalid');
    if (!session.httpOnly) failures.push('zutomayo_session is not HttpOnly');
    if (!session.secure) failures.push('zutomayo_session is not Secure');
  }
  if (!refresh) failures.push('zutomayo_refresh is missing');
  else {
    if (!matchesExpectedHost(refresh.domain)) failures.push('zutomayo_refresh domain is invalid');
    if (!refresh.httpOnly) failures.push('zutomayo_refresh is not HttpOnly');
    if (!refresh.secure) failures.push('zutomayo_refresh is not Secure');
  }
  if (!csrf) failures.push('zutomayo_csrf is missing');
  else {
    if (!matchesExpectedHost(csrf.domain)) failures.push('zutomayo_csrf domain is invalid');
    if (!csrf.secure) failures.push('zutomayo_csrf is not Secure');
  }
  if (failures.length > 0) throw new Error(`Authenticated cookie gate failed: ${failures.join('; ')}`);
}

export async function establishAuthenticatedFriendship(
  requesterContext: BrowserContext,
  requester: AuthenticatedOnlineAccount,
  recipientContext: BrowserContext,
  recipient: AuthenticatedOnlineAccount,
): Promise<void> {
  await postAuthenticatedJson(requesterContext, '/api/friends', { friendUserId: recipient.id });
  const pending = await getJson<{
    requests?: Array<{ id?: string | number; requester_user_id?: string; recipient_user_id?: string }>;
  }>(recipientContext.request, '/api/friend-requests');
  const request = pending.requests?.find(
    (item) => item.requester_user_id === requester.id && item.recipient_user_id === recipient.id,
  );
  if (!request || !/^\d+$/.test(String(request.id))) {
    throw new Error('Recipient did not receive the authenticated friend request');
  }
  await postAuthenticatedJson(recipientContext, `/api/friend-requests/${request.id}`, { accept: true });

  const [requesterFriends, recipientFriends] = await Promise.all([
    getJson<{ friends?: Array<{ userId?: string }> }>(requesterContext.request, '/api/friends'),
    getJson<{ friends?: Array<{ userId?: string }> }>(recipientContext.request, '/api/friends'),
  ]);
  if (!requesterFriends.friends?.some((friend) => friend.userId === recipient.id)) {
    throw new Error('Requester friendship was not persisted');
  }
  if (!recipientFriends.friends?.some((friend) => friend.userId === requester.id)) {
    throw new Error('Recipient friendship was not persisted');
  }
}

export async function getAuthenticatedMatchHistory(context: BrowserContext): Promise<AuthenticatedMatchHistoryEntry[]> {
  const data = await getJson<{ matches?: AuthenticatedMatchHistoryEntry[] }>(
    context.request,
    '/api/matches?limit=20&offset=0',
  );
  return Array.isArray(data.matches) ? data.matches : [];
}

export async function openAuthenticatedOnlineLobby(page: Page): Promise<void> {
  await page.goto('/online');
}

function isAppVersionInfo(value: unknown): value is AppVersionInfo {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppVersionInfo>;
  return (
    typeof data.appVersion === 'string' && typeof data.buildId === 'string' && typeof data.rulesVersion === 'string'
  );
}

async function joinSeat(
  request: APIRequestContext,
  matchID: string,
  playerID: OnlinePlayerID,
  playerName: string,
  clientVersion: AppVersionInfo,
): Promise<OnlineSeat> {
  const joined = await postJson<{
    playerID?: OnlinePlayerID;
    playerCredentials: string;
    platformSeatToken?: string;
    platformUserId?: string;
  }>(request, `/games/zutomayo-card/${encodeURIComponent(matchID)}/join`, {
    playerID,
    playerName,
    data: { clientVersion },
    clientVersion,
  });
  if (joined.playerID && joined.playerID !== playerID) {
    throw new Error(`Expected player ${playerID}, server joined player ${joined.playerID}`);
  }
  if (!joined.playerCredentials) throw new Error(`Player ${playerID} did not receive credentials`);
  return { playerID, playerName, ...joined };
}

export async function provisionOnlineMatch(request: APIRequestContext): Promise<ProvisionedOnlineMatch> {
  const version = await getJson<unknown>(request, '/api/app-version');
  if (!isAppVersionInfo(version)) throw new Error('Game server returned an invalid app version');

  const created = await postJson<{ matchID?: string }>(request, '/games/zutomayo-card/create', {
    numPlayers: 2,
    setupData: { clientVersion: version },
  });
  if (!created.matchID) throw new Error('Game server did not return a match id');

  const seat0 = await joinSeat(request, created.matchID, '0', 'E2E Host', version);
  const seat1 = await joinSeat(request, created.matchID, '1', 'E2E Guest', version);
  return {
    matchID: created.matchID,
    clientVersion: version,
    seats: { '0': seat0, '1': seat1 },
  };
}

export async function getOnlineRoom(
  request: APIRequestContext,
  matchID: string,
): Promise<{
  players?: Array<{ id: number; name?: string }>;
}> {
  return getJson(request, `/games/zutomayo-card/${encodeURIComponent(matchID)}`);
}

export async function openOnlineSeat(page: Page, match: ProvisionedOnlineMatch, playerID: OnlinePlayerID) {
  const seat = match.seats[playerID];
  const session = {
    matchID: match.matchID,
    playerID,
    playerCredentials: seat.playerCredentials,
    platformSeatToken: seat.platformSeatToken,
    platformUserId: seat.platformUserId,
    platformDisplayName: seat.playerName,
  };
  await page.addInitScript(
    ({ storageKey, value }) => {
      localStorage.setItem(storageKey, JSON.stringify(value));
      localStorage.setItem('zutomayo_locale', 'zh-TW');
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    },
    { storageKey: ONLINE_SESSION_STORAGE_KEY, value: session },
  );
  await page.goto(`/play/online/${encodeURIComponent(match.matchID)}`);
}

export async function openOnlineSpectator(page: Page, matchID: string) {
  await page.addInitScript(() => {
    localStorage.setItem('zutomayo_locale', 'zh-TW');
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
  });
  await page.goto(`/play/online/${encodeURIComponent(matchID)}?spectate=1`);
}
