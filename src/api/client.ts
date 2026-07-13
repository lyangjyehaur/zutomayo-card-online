import type { ServerMatchSummary } from '../game/matchHistory';
import type { ActionLogEntry, CardDef } from '../game/types';
import { Sentry } from '../sentry';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';
const SESSION_HINT_KEY = 'zutomayo_session';
const LEGACY_TOKEN_KEY = 'zutomayo_token';
const PUBLIC_DATA_CACHE_MS = 0;

let cardsCache: { expiresAt: number; data: CardDef[] } | null = null;
let configCache: { expiresAt: number; data: Record<string, unknown> } | null = null;
let presetDecksCache: { expiresAt: number; data: Array<{ id: string; name: string; cardIds: string[] }> } | null = null;

export interface DeckResponse {
  id: string;
  name: string;
  cardIds: string[];
}

export interface DeckReservationResponse {
  reservationId: string;
  deckId: string;
  deckVersion: string;
  rulesVersion: string;
  expiresAt: string;
}

export interface ProfileResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  nickname: string;
  avatarUrl?: string;
  avatarFallbackUrls?: string[];
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
  createdAt: string;
  /** Credential capabilities for this account, independent of AUTH_MODE. */
  hasLocalPassword?: boolean;
  hasLogtoIdentity?: boolean;
}

export interface FriendProfile {
  userId: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  createdAt: string;
}

export interface FriendRequest {
  id: number;
  requesterUserId: string;
  recipientUserId: string;
  nickname: string;
  createdAt: string;
  direction: 'incoming' | 'outgoing';
}

export interface BlockedProfile {
  userId: string;
  nickname: string;
  createdAt: string;
}

export interface Season {
  id: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  startingRating: number;
  placementMatches: number;
}

export interface SeasonRating {
  seasonId: string;
  name: string;
  endsAt: string;
  placementMatches: number;
  rating: number | null;
  matchCount: number;
  wins: number;
  placementComplete: boolean;
  rank: number | null;
}

export interface SeasonLeaderboardEntry {
  userId: string;
  nickname: string;
  rating: number;
  matchCount: number;
  wins: number;
  placementComplete: boolean;
}

export interface SeasonReward {
  seasonId: string;
  seasonName: string;
  finalRank: number;
  finalRating: number;
  rewardTier: string;
  rewardPayload: Record<string, unknown>;
  grantedAt: string;
  claimedAt: string | null;
}

export interface AdminSeason extends Season {
  ratingDecayPercent: number;
  rulesVersion: string;
  rewardConfig: { tiers: Array<{ id: string; maxRank: number; payload: Record<string, unknown> }> };
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface AdminSeasonCreateInput {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  startingRating: number;
  placementMatches: number;
  ratingDecayPercent: number;
  rulesVersion: string;
  rewardConfig: AdminSeason['rewardConfig'];
}

export type LegalHoldSubjectType = 'account' | 'match' | 'conversation' | 'message' | 'report' | 'feedback';

export interface LegalHold {
  id: string;
  subjectType: LegalHoldSubjectType;
  subjectId: string;
  reason: string;
  owner: string;
  expiresAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export type AccountExportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

export interface AccountExportJob {
  id: string;
  status: AccountExportStatus;
  formatVersion: number;
  sizeBytes: number | null;
  uncompressedSizeBytes: number | null;
  contentSha256: string | null;
  attemptCount: number;
  maxAttempts: number;
  requestedAt: string;
  snapshotAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  downloadCount: number;
  errorCode: string;
}

export type OAuthProviderId = 'logto' | 'google' | 'github' | 'discord';

export interface OAuthProvider {
  provider: OAuthProviderId;
  label: string;
  enabled: boolean;
}

export interface AuthConfig {
  authMode: 'hybrid' | 'logto' | string;
  localAuthEnabled: boolean;
  accountLinkingEnabled: boolean;
  accountCenterUrl: string;
  providers: OAuthProvider[];
}

export interface OAuthIdentity {
  provider: OAuthProviderId;
  providerUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  linkedAt: string;
  updatedAt: string;
}

export interface LogtoAccountIdentity {
  target?: string;
  userId?: string;
  details?: Record<string, unknown>;
}

export interface LogtoAccountCenterResponse {
  account: Record<string, unknown> & {
    id?: string;
    username?: string;
    name?: string;
    avatar?: string;
    primaryEmail?: string;
    primaryPhone?: string;
    hasPassword?: boolean;
    hasSecurityVerificationMethod?: boolean;
    identities?: Record<string, LogtoAccountIdentity>;
  };
  identities: unknown;
  mfaVerifications: unknown;
  logtoConfigs: unknown;
}

export interface LeaderboardEntry {
  id: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
}

export interface AboutPageLink {
  title: string;
  url: string;
  description: string;
}

export interface AboutPagePerson {
  name: string;
  url: string;
}

export const ABOUT_PAGE_LOCALES = ['zh-TW', 'zh-HK', 'zh-CN', 'ja', 'en', 'ko'] as const;
export type AboutPageLocale = (typeof ABOUT_PAGE_LOCALES)[number];

export interface AboutPageConfig {
  title: string;
  description: string;
  author: AboutPagePerson;
  artist: AboutPagePerson;
  github: AboutPageLink;
  otherProjects: AboutPageLink;
  community: {
    description: string;
    qqUrl: string;
    telegramUrl: string;
    discordUrl: string;
  };
}

const DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW: AboutPageConfig = {
  title: 'About ZUTOMAYO CARD ONLINE',
  description: '這是一個由玩家維護的非官方線上對戰項目，目標是讓更多人能方便體驗 ZUTOMAYO CARD 的夜晝攻防與牌組構築。',
  author: {
    name: 'lyangjyehaur',
    url: 'https://github.com/lyangjyehaur',
  },
  artist: {
    name: '待補充',
    url: '',
  },
  github: {
    title: 'GitHub Repository',
    url: 'https://github.com/lyangjyehaur/zutomayo-card-online',
    description: '項目代碼與開發進度在 GitHub 公開。歡迎透過 Issue 或 Pull Request 參與規則校對、功能改進與介面優化。',
  },
  otherProjects: {
    title: 'ZUTOMAYO Gallery',
    url: 'https://ztmy.art',
    description: '一個 ZUTOMAYO MV 資料庫，用於整理 MV 設定圖、相關資料與內容維護流程。',
  },
  community: {
    description: '加入社群可以回報問題、提出建議，也可以找人組局對戰。',
    qqUrl: 'https://qm.qq.com/',
    telegramUrl: 'https://t.me/',
    discordUrl: 'https://discord.gg/',
  },
};

export const DEFAULT_ABOUT_PAGE_I18N_CONFIG: Record<AboutPageLocale, AboutPageConfig> = {
  'zh-TW': DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW,
  'zh-HK': {
    ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW,
    description: '呢個係由玩家維護嘅非官方綫上對戰項目，希望更多人可以方便體驗 ZUTOMAYO CARD 嘅夜晝攻防同牌組構築。',
    artist: { name: '待補充', url: '' },
    github: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.github,
      description:
        '項目代碼同開發進度喺 GitHub 公開。歡迎透過 Issue 或 Pull Request 參與規則校對、功能改進同介面優化。',
    },
    otherProjects: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.otherProjects,
      description: '一個 ZUTOMAYO MV 資料庫，用嚟整理 MV 設定圖、相關資料同內容維護流程。',
    },
    community: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.community,
      description: '加入社群可以回報問題、提出建議，亦可以搵人組局對戰。',
    },
  },
  'zh-CN': {
    ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW,
    description:
      '这是一个由玩家维护的非官方在线对战项目，目标是让更多人能方便体验 ZUTOMAYO CARD 的夜昼攻防与牌组构筑。',
    artist: { name: '待补充', url: '' },
    github: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.github,
      description:
        '项目代码与开发进度在 GitHub 公开。欢迎通过 Issue 或 Pull Request 参与规则校对、功能改进与界面优化。',
    },
    otherProjects: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.otherProjects,
      description: '一个 ZUTOMAYO MV 数据库，用于整理 MV 设定图、相关资料与内容维护流程。',
    },
    community: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.community,
      description: '加入社群可以反馈问题、提出建议，也可以找人组局对战。',
    },
  },
  ja: {
    ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW,
    description:
      'プレイヤーによって運営されている非公式オンライン対戦プロジェクトです。ZUTOMAYO CARD の夜昼の攻防とデッキ構築を、より手軽に楽しめる場を目指しています。',
    artist: { name: '未設定', url: '' },
    github: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.github,
      description:
        'プロジェクトのコードと開発状況は GitHub で公開されています。ルール確認、機能改善、UI 改善は Issue や Pull Request で参加できます。',
    },
    otherProjects: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.otherProjects,
      description: 'ZUTOMAYO の MV 設定画、関連資料、コンテンツ管理フローを整理する MV データベースです。',
    },
    community: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.community,
      description: 'コミュニティでは不具合報告や提案、対戦相手の募集ができます。',
    },
  },
  en: {
    ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW,
    description:
      'A player-maintained, unofficial online battle project built to make ZUTOMAYO CARD easier to play, test, and share with others.',
    artist: { name: 'TBD', url: '' },
    github: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.github,
      description:
        'Project code and development progress are public on GitHub. Issues and Pull Requests for rules review, feature work, and UI polish are welcome.',
    },
    otherProjects: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.otherProjects,
      description:
        'A ZUTOMAYO MV database for organizing MV reference images, related metadata, and content maintenance workflows.',
    },
    community: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.community,
      description: 'Join the community to report issues, share suggestions, and find players for matches.',
    },
  },
  ko: {
    ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW,
    description:
      '플레이어가 운영하는 비공식 온라인 대전 프로젝트입니다. ZUTOMAYO CARD의 밤낮 전투와 덱 구성을 더 쉽게 즐기고 공유할 수 있도록 만들고 있습니다.',
    artist: { name: '미정', url: '' },
    github: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.github,
      description:
        '프로젝트 코드와 개발 진행 상황은 GitHub에 공개되어 있습니다. 규칙 검토, 기능 개선, UI 개선은 Issue 또는 Pull Request로 참여할 수 있습니다.',
    },
    otherProjects: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.otherProjects,
      description: 'ZUTOMAYO MV 설정 이미지, 관련 자료, 콘텐츠 유지 관리 흐름을 정리하는 MV 데이터베이스입니다.',
    },
    community: {
      ...DEFAULT_ABOUT_PAGE_CONFIG_ZH_TW.community,
      description: '커뮤니티에서 문제를 제보하고 의견을 공유하며 함께 대전할 플레이어를 찾을 수 있습니다.',
    },
  },
};

export const DEFAULT_ABOUT_PAGE_CONFIG = DEFAULT_ABOUT_PAGE_I18N_CONFIG['zh-TW'];

export type AboutPageI18nConfig = Record<AboutPageLocale, AboutPageConfig>;

interface DeckListResponse {
  decks: DeckResponse[];
}

interface FriendListResponse {
  friends: FriendProfile[];
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

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|; )zutomayo_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function ensureCsrfToken(): Promise<string> {
  const existing = getCsrfToken();
  if (existing) return existing;
  try {
    const response = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' });
    if (!response.ok) return '';
    const body = (await response.json()) as { token?: unknown };
    return getCsrfToken() || (typeof body.token === 'string' ? body.token : '');
  } catch {
    return '';
  }
}

async function tryRefreshToken(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      markAccountSession();
      return true;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(LEGACY_TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // CSRF: double-submit cookie pattern — attach X-CSRF-Token for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }

  const doFetch = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

  let res = await doFetch();

  // 401 攔截：嘗試 refresh token 後重試一次（refresh 路由自身不遞迴）
  if (res.status === 401 && !path.startsWith('/auth/refresh') && !path.startsWith('/logout')) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    // refresh 失敗後的 401 清除前端 session 狀態
    if (res.status === 401) {
      clearAccountSession();
    }
    // 5xx 為伺服器錯誤，上報 Sentry 以利定位線上問題；4xx 為客戶端錯誤，不上報。
    if (res.status >= 500) {
      Sentry.captureException(new Error(`API ${res.status}: ${path}`), {
        tags: { layer: 'api-client', http_status: String(res.status), route: path },
      });
    }
    throw new ApiError((data.error as string) || 'Request failed', res.status);
  }
  return data as T;
}

function adminAuthHeaders(): Record<string, string> {
  const token =
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ADMIN_TOKEN_KEY)) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(ADMIN_TOKEN_KEY)) ||
    '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function markAccountSession() {
  localStorage.setItem(SESSION_HINT_KEY, '1');
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

function clearAccountSession() {
  localStorage.removeItem(SESSION_HINT_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

function isFresh<T>(cache: { expiresAt: number; data: T } | null): cache is { expiresAt: number; data: T } {
  return Boolean(cache && cache.expiresAt > Date.now());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeAboutLink(value: unknown, fallback: AboutPageLink): AboutPageLink {
  const record = asRecord(value);
  return {
    title: readString(record.title, fallback.title),
    url: readString(record.url, fallback.url),
    description: readString(record.description, fallback.description),
  };
}

function normalizeAboutPerson(value: unknown, fallback: AboutPagePerson, legacyName?: unknown): AboutPagePerson {
  const record = asRecord(value);
  return {
    name: readString(record.name, readString(legacyName, fallback.name)),
    url: readString(record.url, fallback.url),
  };
}

function isAboutPageLocale(value: string): value is AboutPageLocale {
  return ABOUT_PAGE_LOCALES.includes(value as AboutPageLocale);
}

function normalizeAboutPageConfig(value: unknown, locale: AboutPageLocale = 'zh-TW'): AboutPageConfig {
  const record = asRecord(value);
  const fallback = DEFAULT_ABOUT_PAGE_I18N_CONFIG[locale];
  const community = asRecord(record.community);
  return {
    title: readString(record.title, fallback.title),
    description: readString(record.description, fallback.description),
    author: normalizeAboutPerson(record.author, fallback.author, record.authorName),
    artist: normalizeAboutPerson(record.artist, fallback.artist, record.artistName),
    github: normalizeAboutLink(record.github, fallback.github),
    otherProjects: normalizeAboutLink(record.otherProjects, fallback.otherProjects),
    community: {
      description: readString(community.description, fallback.community.description),
      qqUrl: readString(community.qqUrl, fallback.community.qqUrl),
      telegramUrl: readString(community.telegramUrl, fallback.community.telegramUrl),
      discordUrl: readString(community.discordUrl, fallback.community.discordUrl),
    },
  };
}

function normalizeAboutPageI18nConfig(value: unknown): AboutPageI18nConfig {
  const record = asRecord(value);
  const hasLocaleKeys = Object.keys(record).some(isAboutPageLocale);
  if (!hasLocaleKeys) {
    if (Object.keys(record).length === 0) return DEFAULT_ABOUT_PAGE_I18N_CONFIG;
    return Object.fromEntries(
      ABOUT_PAGE_LOCALES.map((locale) => [locale, normalizeAboutPageConfig(value, locale)]),
    ) as AboutPageI18nConfig;
  }

  return Object.fromEntries(
    ABOUT_PAGE_LOCALES.map((locale) => {
      const localeValue = record[locale] ?? record['zh-TW'] ?? record.en;
      return [locale, normalizeAboutPageConfig(localeValue, locale)];
    }),
  ) as AboutPageI18nConfig;
}

// ===== Public Data =====
export async function fetchCards(force = false): Promise<CardDef[]> {
  if (!force && PUBLIC_DATA_CACHE_MS > 0 && isFresh(cardsCache)) return cardsCache.data;
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
  if (PUBLIC_DATA_CACHE_MS > 0 && isFresh(configCache)) return configCache.data;
  const data = await request<Record<string, unknown>>('/config');
  configCache = { data, expiresAt: Date.now() + PUBLIC_DATA_CACHE_MS };
  return data;
}

export async function fetchAboutPage(locale: string = 'zh-TW'): Promise<AboutPageConfig> {
  try {
    const config = await fetchGameConfig();
    const aboutLocale = isAboutPageLocale(locale) ? locale : 'zh-TW';
    return normalizeAboutPageI18nConfig(config.about_page)[aboutLocale];
  } catch {
    return DEFAULT_ABOUT_PAGE_I18N_CONFIG[isAboutPageLocale(locale) ? locale : 'zh-TW'];
  }
}

export async function fetchAboutPageI18n(): Promise<AboutPageI18nConfig> {
  try {
    const config = await fetchGameConfig();
    return normalizeAboutPageI18nConfig(config.about_page);
  } catch {
    return DEFAULT_ABOUT_PAGE_I18N_CONFIG;
  }
}

export async function fetchPresetDecks(): Promise<Array<{ id: string; name: string; cardIds: string[] }>> {
  if (PUBLIC_DATA_CACHE_MS > 0 && isFresh(presetDecksCache)) return presetDecksCache.data;
  const data = await request<Array<{ id: string; name: string; cardIds: string[] }>>('/preset-decks');
  presetDecksCache = { data, expiresAt: Date.now() + PUBLIC_DATA_CACHE_MS };
  return data;
}

// ===== Auth =====
interface AuthResponse {
  token: string;
  user: ProfileResponse;
}

export async function register(email: string, password: string, nickname?: string) {
  return registerWithVerification({ email, password, nickname });
}

export async function registerWithVerification({
  email,
  password,
  nickname,
  verificationToken,
}: {
  email: string;
  password: string;
  nickname?: string;
  verificationToken?: string;
}) {
  const data = await request<AuthResponse>('/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, nickname, verificationToken }),
  });
  markAccountSession();
  return data.user;
}

export async function login(email: string, password: string) {
  return loginWithVerification({ email, password });
}

export async function loginWithVerification({
  email,
  password,
  verificationToken,
}: {
  email: string;
  password: string;
  verificationToken?: string;
}) {
  const data = await request<AuthResponse>('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, verificationToken }),
  });
  markAccountSession();
  return data.user;
}

export function logout() {
  clearAccountSession();
  void request('/logout', { method: 'POST' }).catch(() => {});
}

export function isLoggedIn(): boolean {
  return Boolean(localStorage.getItem(SESSION_HINT_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY));
}

// ===== Profile =====
export async function getProfile(): Promise<ProfileResponse> {
  return request('/profile');
}

export async function updateProfile(nickname: string): Promise<ProfileResponse> {
  return request('/profile', {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  });
}

export async function updatePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  const result = await request<{ ok: boolean }>('/profile/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  logout();
  return result;
}

export async function requestEmailVerification(): Promise<{ accepted: boolean; alreadyVerified?: boolean }> {
  return request('/auth/email-verification/request', { method: 'POST' });
}

export async function confirmEmailVerification(token: string): Promise<{ verified: boolean }> {
  return request('/auth/email-verification/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function requestPasswordReset(email: string): Promise<{ accepted: boolean }> {
  return request('/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ reset: boolean }> {
  const result = await request<{ reset: boolean }>('/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  clearAccountSession();
  return result;
}

export async function createAccountExport(): Promise<AccountExportJob> {
  const data = await request<{ job: AccountExportJob }>('/account/exports', { method: 'POST' });
  return data.job;
}

export async function listAccountExports(): Promise<AccountExportJob[]> {
  const data = await request<{ jobs: AccountExportJob[] }>('/account/exports');
  return data.jobs;
}

export async function getAccountExport(jobId: string): Promise<AccountExportJob> {
  const data = await request<{ job: AccountExportJob }>(`/account/exports/${encodeURIComponent(jobId)}`);
  return data.job;
}

export function getAccountExportDownloadUrl(jobId: string): string {
  return `${API_BASE}/account/exports/${encodeURIComponent(jobId)}/download`;
}

export async function deleteAccount(stepUp: {
  currentPassword?: string;
  stepUpToken?: string;
}): Promise<{ deleted: boolean }> {
  const result = await request<{ deleted: boolean }>('/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirmation: 'DELETE', ...stepUp }),
  });
  clearAccountSession();
  return result;
}

export async function getOAuthProviders(): Promise<OAuthProvider[]> {
  return (await getAuthConfig()).providers;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const data = await request<Partial<AuthConfig> & { providers?: OAuthProvider[] }>('/oauth/providers');
  return {
    authMode: data.authMode || 'hybrid',
    localAuthEnabled: data.localAuthEnabled ?? true,
    accountLinkingEnabled: data.accountLinkingEnabled ?? true,
    accountCenterUrl: typeof data.accountCenterUrl === 'string' ? data.accountCenterUrl : '',
    providers: data.providers || [],
  };
}

export async function getLinkedOAuthIdentities(): Promise<OAuthIdentity[]> {
  const data = await request<{ identities: OAuthIdentity[] }>('/profile/identities');
  return data.identities;
}

export async function unlinkOAuthIdentity(provider: OAuthProviderId): Promise<{ unlinked: boolean; provider: string }> {
  return request(`/profile/identities/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

export async function getLogtoAccountCenter(): Promise<LogtoAccountCenterResponse> {
  return request('/account-center');
}

export async function verifyLogtoPassword(
  currentPassword: string,
): Promise<{ stepUpToken: string; expiresIn: number }> {
  return request('/account-center/verifications/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword }),
  });
}

export async function updateLogtoPassword(newPassword: string, stepUpToken: string): Promise<{ ok: boolean }> {
  return request('/account-center/password', {
    method: 'POST',
    body: JSON.stringify({ newPassword, stepUpToken }),
  });
}

export function getOAuthStartUrl(provider: OAuthProviderId, mode: 'login' | 'link', returnTo = '/'): string {
  const target = returnTo.startsWith('/') ? returnTo : '/';
  return `${API_BASE}/oauth/${encodeURIComponent(provider)}/start?mode=${mode}&returnTo=${encodeURIComponent(target)}`;
}

// ===== Friends =====
export async function getFriends(): Promise<FriendProfile[]> {
  const data = await request<FriendListResponse>('/friends');
  return data.friends;
}

export async function addFriend(friendUserId: string): Promise<{
  accepted?: boolean;
  friendUserId: string;
  request?: { id: string | number; status: string };
}> {
  return request('/friends', {
    method: 'POST',
    body: JSON.stringify({ friendUserId }),
  });
}

export async function removeFriend(friendUserId: string): Promise<{ ok: boolean }> {
  return request(`/friends/${encodeURIComponent(friendUserId)}`, { method: 'DELETE' });
}

export async function getFriendRequests(currentUserId: string): Promise<FriendRequest[]> {
  const data = await request<{
    requests: Array<{
      id: string | number;
      requester_user_id: string;
      recipient_user_id: string;
      nickname?: string;
      created_at: string;
    }>;
  }>('/friend-requests');
  return (data.requests || []).map((item) => ({
    id: Number(item.id),
    requesterUserId: item.requester_user_id,
    recipientUserId: item.recipient_user_id,
    nickname: item.nickname || '',
    createdAt: item.created_at,
    direction: item.recipient_user_id === currentUserId ? 'incoming' : 'outgoing',
  }));
}

export async function respondToFriendRequest(requestId: number, accept: boolean): Promise<{ accepted: boolean }> {
  return request(`/friend-requests/${requestId}`, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  });
}

export async function getBlocks(): Promise<BlockedProfile[]> {
  const data = await request<{
    blocks: Array<{ blocked_user_id: string; nickname?: string; created_at: string }>;
  }>('/blocks');
  return (data.blocks || []).map((item) => ({
    userId: item.blocked_user_id,
    nickname: item.nickname || '',
    createdAt: item.created_at,
  }));
}

export async function blockUser(targetUserId: string): Promise<{ blocked: boolean; userId: string }> {
  return request('/blocks', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
}

export async function unblockUser(targetUserId: string): Promise<{ blocked: boolean; userId: string }> {
  return request(`/blocks/${encodeURIComponent(targetUserId)}`, { method: 'DELETE' });
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

export async function reserveDeck(deckId: string, rulesVersion?: string): Promise<DeckReservationResponse> {
  return request<DeckReservationResponse>('/deck-reservations', {
    method: 'POST',
    body: JSON.stringify({ deckId, ...(rulesVersion ? { rulesVersion } : {}) }),
  });
}

export async function createDeck(name: string, cardIds: string[]): Promise<DeckResponse> {
  return request<DeckResponse>('/decks', {
    method: 'POST',
    body: JSON.stringify({ name, cardIds }),
  });
}

export async function updateDeck(deckId: string, name: string, cardIds: string[]): Promise<DeckResponse> {
  return request<DeckResponse>(`/decks/${deckId}`, {
    method: 'PUT',
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

export async function getMatches(limit = 50, offset = 0): Promise<ServerMatchSummary[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const data = await request<{ matches: ServerMatchSummary[] }>(`/matches?${params.toString()}`);
  return Array.isArray(data.matches) ? data.matches : [];
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

export async function getCurrentSeason(): Promise<Season | null> {
  const data = await request<{
    season: {
      id: string;
      name: string;
      status: string;
      starts_at: string;
      ends_at: string;
      starting_rating: number;
      placement_matches: number;
    } | null;
  }>('/seasons/current');
  if (!data.season) return null;
  return {
    id: data.season.id,
    name: data.season.name,
    status: data.season.status,
    startsAt: data.season.starts_at,
    endsAt: data.season.ends_at,
    startingRating: Number(data.season.starting_rating),
    placementMatches: Number(data.season.placement_matches),
  };
}

export async function getMySeasonRating(): Promise<SeasonRating | null> {
  const data = await request<{
    rating: {
      season_id: string;
      name: string;
      ends_at: string;
      placement_matches: number;
      rating: number | null;
      match_count: number | null;
      wins: number | null;
      placement_complete: boolean | null;
      rank: number | null;
    } | null;
  }>('/seasons/me');
  if (!data.rating) return null;
  return {
    seasonId: data.rating.season_id,
    name: data.rating.name,
    endsAt: data.rating.ends_at,
    placementMatches: Number(data.rating.placement_matches),
    rating: data.rating.rating === null ? null : Number(data.rating.rating),
    matchCount: Number(data.rating.match_count || 0),
    wins: Number(data.rating.wins || 0),
    placementComplete: Boolean(data.rating.placement_complete),
    rank: data.rating.rank === null ? null : Number(data.rating.rank),
  };
}

export async function getSeasonLeaderboard(limit = 100, offset = 0): Promise<SeasonLeaderboardEntry[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const data = await request<{
    entries: Array<{
      user_id: string;
      nickname: string;
      rating: number;
      match_count: number;
      wins: number;
      placement_complete: boolean;
    }>;
  }>(`/seasons/leaderboard?${params.toString()}`);
  return (data.entries || []).map((entry) => ({
    userId: entry.user_id,
    nickname: entry.nickname,
    rating: Number(entry.rating),
    matchCount: Number(entry.match_count),
    wins: Number(entry.wins),
    placementComplete: Boolean(entry.placement_complete),
  }));
}

function mapSeasonReward(reward: {
  season_id: string;
  season_name: string;
  final_rank: number;
  final_rating: number;
  reward_tier: string;
  reward_payload: Record<string, unknown>;
  granted_at: string;
  claimed_at: string | null;
}): SeasonReward {
  return {
    seasonId: reward.season_id,
    seasonName: reward.season_name,
    finalRank: Number(reward.final_rank),
    finalRating: Number(reward.final_rating),
    rewardTier: reward.reward_tier,
    rewardPayload: reward.reward_payload || {},
    grantedAt: reward.granted_at,
    claimedAt: reward.claimed_at,
  };
}

export async function getSeasonRewards(): Promise<SeasonReward[]> {
  const data = await request<{ rewards: Parameters<typeof mapSeasonReward>[0][] }>('/seasons/rewards');
  return (data.rewards || []).map(mapSeasonReward);
}

export async function claimSeasonReward(
  seasonId: string,
): Promise<{ claimed: boolean; reason?: string; claimedAt?: string }> {
  return request(`/seasons/${encodeURIComponent(seasonId)}/rewards/claim`, { method: 'POST' });
}

// ===== Presence =====
export interface OnlinePresenceResponse {
  onlineCount: number;
  activeWindowSeconds: number;
}

export async function fetchOnlinePresence(): Promise<OnlinePresenceResponse> {
  return request<OnlinePresenceResponse>('/presence');
}

export async function sendOnlinePresenceHeartbeat(visitorId: string): Promise<OnlinePresenceResponse> {
  return request<OnlinePresenceResponse>('/presence/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ visitorId }),
  });
}

// ===== Chat =====
export type ChatConversationType = 'match' | 'room' | 'direct' | 'global';
export type ChatPublicAuthorRole = 'player' | 'spectator';
export type ChatAuthorRole = ChatPublicAuthorRole | 'moderator';

export interface ChatConversation {
  id: string;
  type: ChatConversationType;
  subjectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatUnreadConversation extends ChatConversation {
  unreadCount: number;
  latestMessageAt: string | null;
  latestMessageId: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorRole: ChatAuthorRole;
  content: string;
  sourceLanguage: string;
  moderationStatus: 'visible' | 'pending_review' | 'blocked' | 'deleted' | string;
  moderationReason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatMessageTranslation {
  messageId: string;
  targetLanguage: string;
  translatedContent: string;
  provider: string;
  model: string;
  status: 'pending' | 'ready' | string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageInput {
  conversationType: ChatConversationType;
  subjectId: string;
  content: string;
  title?: string;
  authorDisplayName?: string;
  authorRole?: ChatPublicAuthorRole;
  clientMessageId?: string;
  sourceLanguage?: string;
}

export async function fetchChatMessages({
  conversationType,
  subjectId,
  limit = 50,
  before,
}: {
  conversationType: ChatConversationType;
  subjectId: string;
  limit?: number;
  before?: string;
}): Promise<ChatMessage[]> {
  const params = new URLSearchParams({
    type: conversationType,
    subjectId,
    limit: String(limit),
  });
  if (before) params.set('before', before);
  const data = await request<{ messages: ChatMessage[] }>(`/chat/messages?${params.toString()}`);
  return data.messages;
}

export async function sendChatMessage(input: ChatMessageInput): Promise<{
  conversation: ChatConversation;
  message: ChatMessage;
}> {
  return request('/chat/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function markChatRead(input: {
  conversationType: ChatConversationType;
  subjectId: string;
  lastReadMessageId?: string;
}): Promise<{ ok: boolean }> {
  return request('/chat/read', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchUnreadChat(limit = 20): Promise<ChatUnreadConversation[]> {
  const cleanLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 20;
  const data = await request<{ conversations: ChatUnreadConversation[] }>(`/chat/unread?limit=${cleanLimit}`);
  return data.conversations;
}

export async function requestChatTranslation(
  messageId: string,
  targetLanguage: string,
): Promise<{ translation: ChatMessageTranslation; cached: boolean }> {
  return request(`/chat/messages/${encodeURIComponent(messageId)}/translate`, {
    method: 'POST',
    body: JSON.stringify({ targetLanguage }),
  });
}

export interface ChatReport {
  id: string;
  messageId: string;
  conversationId: string;
  reporterUserId: string | null;
  reason: string;
  note: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed' | string;
  reviewerUserId: string | null;
  resolutionNote: string;
  createdAt: string;
  reviewedAt: string | null;
  message?: {
    content: string;
    authorUserId: string | null;
    authorDisplayName: string;
    authorRole: ChatAuthorRole;
    moderationStatus: string;
    createdAt: string | null;
    activeSanction?: ChatUserSanction;
  };
}

export interface ChatUserSanction {
  id: string;
  targetUserId: string;
  type: 'chat_mute' | string;
  status: 'active' | 'revoked' | string;
  reason: string;
  sourceReportId: string | null;
  sourceMessageId: string | null;
  conversationId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revocationReason: string;
}

export async function reportChatMessage(
  messageId: string,
  input: { reason: string; note?: string },
): Promise<{ report: ChatReport }> {
  return request(`/chat/messages/${encodeURIComponent(messageId)}/report`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
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

export async function adminLogin(credentials: {
  username: string;
  password: string;
  totpCode: string;
}): Promise<{ token: string; role: string; expiresIn: number }> {
  return request<{ token: string; role: string; expiresIn: number }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export async function adminLogout(token: string): Promise<void> {
  await request('/admin/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
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

type AdminSeasonRow = {
  id: string;
  name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  starting_rating: number;
  placement_matches: number;
  rating_decay_percent: number;
  rules_version: string;
  reward_config: AdminSeason['rewardConfig'];
  activated_at: string | null;
  closed_at: string | null;
  created_at: string;
};

function mapAdminSeason(season: AdminSeasonRow): AdminSeason {
  return {
    id: season.id,
    name: season.name,
    status: season.status,
    startsAt: season.starts_at,
    endsAt: season.ends_at,
    startingRating: Number(season.starting_rating),
    placementMatches: Number(season.placement_matches),
    ratingDecayPercent: Number(season.rating_decay_percent),
    rulesVersion: season.rules_version,
    rewardConfig: season.reward_config || { tiers: [] },
    activatedAt: season.activated_at,
    closedAt: season.closed_at,
    createdAt: season.created_at,
  };
}

export async function adminGetSeasons(token: string): Promise<AdminSeason[]> {
  const data = await request<{ seasons: AdminSeasonRow[] }>('/admin/seasons', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (data.seasons || []).map(mapAdminSeason);
}

export async function adminCreateSeason(token: string, input: AdminSeasonCreateInput): Promise<AdminSeason> {
  const data = await request<{ season: AdminSeasonRow }>('/admin/seasons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  return mapAdminSeason(data.season);
}

export async function adminActivateSeason(token: string, seasonId: string): Promise<void> {
  await request(`/admin/seasons/${encodeURIComponent(seasonId)}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminCloseSeason(token: string, seasonId: string): Promise<void> {
  await request(`/admin/seasons/${encodeURIComponent(seasonId)}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

type LegalHoldRow = {
  id: string;
  subject_type: LegalHoldSubjectType;
  subject_id: string;
  reason: string;
  owner: string;
  expires_at: string | null;
  released_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

function mapLegalHold(hold: LegalHoldRow): LegalHold {
  return {
    id: hold.id,
    subjectType: hold.subject_type,
    subjectId: hold.subject_id,
    reason: hold.reason,
    owner: hold.owner,
    expiresAt: hold.expires_at,
    releasedAt: hold.released_at,
    createdAt: hold.created_at,
    metadata: hold.metadata || {},
  };
}

export async function adminGetLegalHolds(
  token: string,
  status: 'active' | 'released' | 'expired' | 'all' = 'active',
): Promise<LegalHold[]> {
  const data = await request<{ holds: LegalHoldRow[] }>(`/admin/legal-holds?status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (data.holds || []).map(mapLegalHold);
}

export async function adminCreateLegalHold(
  token: string,
  input: {
    subjectType: LegalHoldSubjectType;
    subjectId: string;
    reason: string;
    owner: string;
    expiresAt: string;
    caseReference?: string;
  },
): Promise<LegalHold> {
  const data = await request<{ hold: LegalHoldRow }>('/admin/legal-holds', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  return mapLegalHold(data.hold);
}

export async function adminReleaseLegalHold(token: string, holdId: string, reason: string): Promise<LegalHold> {
  const data = await request<{ hold: LegalHoldRow }>(`/admin/legal-holds/${encodeURIComponent(holdId)}/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
  return mapLegalHold(data.hold);
}

export async function adminGetChatReports(
  token: string,
  status = 'open',
  limit = 50,
): Promise<{ reports: ChatReport[] }> {
  return request<{ reports: ChatReport[] }>(`/admin/chat/reports?status=${encodeURIComponent(status)}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminGetChatConversationMessages(
  token: string,
  conversationId: string,
  limit = 100,
): Promise<{ conversation: ChatConversation; messages: ChatMessage[] }> {
  return request<{ conversation: ChatConversation; messages: ChatMessage[] }>(
    `/admin/chat/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function adminCreateChatUserSanction(
  token: string,
  input: {
    targetUserId: string;
    type?: 'chat_mute';
    durationMinutes?: number;
    reason?: string;
    sourceReportId?: string;
    sourceMessageId?: string;
    conversationId?: string;
  },
): Promise<{ sanction: ChatUserSanction }> {
  return request<{ sanction: ChatUserSanction }>('/admin/chat/sanctions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export async function adminRevokeChatUserSanction(
  token: string,
  sanctionId: string,
): Promise<{ sanction: ChatUserSanction }> {
  return request<{ sanction: ChatUserSanction }>(`/admin/chat/sanctions/${encodeURIComponent(sanctionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function adminReviewChatReport(
  token: string,
  reportId: string,
  input: { status: 'reviewing' | 'resolved' | 'dismissed'; resolutionNote?: string },
): Promise<{ report: ChatReport }> {
  return request<{ report: ChatReport }>(`/admin/chat/reports/${encodeURIComponent(reportId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export async function adminReviewChatMessageModeration(
  token: string,
  messageId: string,
  input: { status: 'visible' | 'blocked' | 'deleted'; reason?: string },
): Promise<{ message: ChatMessage }> {
  return request<{ message: ChatMessage }>(`/admin/chat/messages/${encodeURIComponent(messageId)}/moderation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
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
  await adminReloadGameCards();
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

export async function adminUpdateAboutPage(value: AboutPageI18nConfig): Promise<void> {
  await adminUpdateConfig('about_page', value);
}

export async function adminUpdateCardI18n(cardId: string, lang: string, effectText: string): Promise<void> {
  await request<{ ok: boolean }>(`/admin/cards/${encodeURIComponent(cardId)}/i18n`, {
    method: 'PUT',
    headers: adminAuthHeaders(),
    body: JSON.stringify({ lang, effectText }),
  });
  await adminReloadGameCards();
}

export async function adminReloadGameCards(): Promise<void> {
  await request<{ ok: boolean }>('/admin/cards/reload', {
    method: 'POST',
    headers: adminAuthHeaders(),
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
