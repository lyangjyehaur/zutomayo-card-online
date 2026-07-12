import type { APIRequestContext, APIResponse, Page } from '@playwright/test';

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
