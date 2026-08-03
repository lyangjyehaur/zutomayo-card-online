import type { AccessControlProvider, AuthProvider, DataProvider, HttpError } from '@refinedev/core';
import {
  adminGetCards,
  adminLogin,
  adminLoginWithAccount,
  adminLogout,
  adminUpdateCard,
  type AdminRole,
} from '../api/client';
import type { CardDef } from '../game/types';

export const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';
export const ADMIN_ROLE_KEY = 'zutomayo_admin_role';

function errorResponse(error: unknown, fallback = 'Admin request failed'): HttpError {
  const source = error instanceof Error ? error : new Error(fallback);
  const statusCode = Number((error as { status?: unknown })?.status) || 500;
  return { message: source.message || fallback, statusCode };
}

function storedRole(): AdminRole | null {
  const role = sessionStorage.getItem(ADMIN_ROLE_KEY);
  return ['viewer', 'moderator', 'operator', 'admin'].includes(role || '') ? (role as AdminRole) : null;
}

export const adminAuthProvider: AuthProvider = {
  async login(params: { username?: string; password?: string; totpCode?: string; accountSession?: boolean }) {
    try {
      const result = params.accountSession
        ? await adminLoginWithAccount()
        : await adminLogin({
            username: params.username || '',
            password: params.password || '',
            totpCode: params.totpCode || '',
          });
      sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
      sessionStorage.setItem(ADMIN_ROLE_KEY, result.role);
      const redirectTo =
        result.role === 'viewer' ? '/admin/users' : result.role === 'moderator' ? '/admin/chat' : '/admin/cards';
      return { success: true, redirectTo };
    } catch (error) {
      return { success: false, error: errorResponse(error, '登入失敗') };
    }
  },
  async logout() {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) await adminLogout(token).catch(() => undefined);
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_ROLE_KEY);
    return { success: true, redirectTo: '/admin/login' };
  },
  async check() {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY)
      ? { authenticated: true }
      : { authenticated: false, redirectTo: '/admin/login', logout: true };
  },
  async onError(error) {
    const status = Number(error?.statusCode || error?.status);
    if (status === 401 || status === 403) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_ROLE_KEY);
      return { logout: true, redirectTo: '/admin/login', error };
    }
    return { error };
  },
  async getPermissions() {
    return storedRole();
  },
  async getIdentity() {
    return { id: 'current-admin', name: '管理員', role: storedRole() };
  },
};

const READ_ONLY_RESOURCES = new Set(['matches', 'i18n']);
const VIEWER_RESOURCES = new Set(['users', 'matches', 'i18n']);
const MODERATOR_RESOURCES = new Set([...VIEWER_RESOURCES, 'chat', 'deck-shares', 'support-inbox']);
const OPERATOR_RESOURCES = new Set([
  ...MODERATOR_RESOURCES,
  'cards',
  'songs',
  'synergies',
  'official-rulings',
  'about',
  'announcements',
  'translation',
  'notifications',
  'operations',
  'i18n',
]);

export const adminAccessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const role = storedRole();
    if (!role) return { can: false, reason: 'Not authenticated' };
    if (role === 'admin') return { can: true };
    if (role === 'viewer') {
      return {
        can: VIEWER_RESOURCES.has(resource || '') && (action === 'list' || action === 'show'),
        reason: 'Viewer access is read-only',
      };
    }
    const allowed = role === 'operator' ? OPERATOR_RESOURCES : MODERATOR_RESOURCES;
    if (!allowed.has(resource || '')) return { can: false, reason: 'Resource is not available for this role' };
    if (READ_ONLY_RESOURCES.has(resource || '') && !['list', 'show'].includes(action)) {
      return { can: false, reason: 'Resource is read-only' };
    }
    return { can: true };
  },
  options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true } },
};

function cardIdFromVariables(variables: unknown): string {
  const value = (variables as { id?: unknown })?.id;
  return typeof value === 'string' ? value.trim() : '';
}

export const adminDataProvider: DataProvider = {
  getApiUrl: () => '/api/admin',
  async getList({ resource }) {
    if (resource !== 'cards') throw errorResponse(null, `Unsupported Refine resource: ${resource}`);
    try {
      const cards = await adminGetCards();
      return { data: cards as unknown as never[], total: cards.length };
    } catch (error) {
      throw errorResponse(error);
    }
  },
  async getOne({ resource, id }) {
    if (resource !== 'cards') throw errorResponse(null, `Unsupported Refine resource: ${resource}`);
    const cards = await adminGetCards();
    const card = cards.find((entry) => entry.id === String(id));
    if (!card) throw { message: 'Card not found', statusCode: 404 } satisfies HttpError;
    return { data: card as never };
  },
  async create({ resource, variables }) {
    if (resource !== 'cards') throw errorResponse(null, `Unsupported Refine resource: ${resource}`);
    const id = cardIdFromVariables(variables);
    if (!id) throw { message: 'Card ID is required', statusCode: 400 } satisfies HttpError;
    try {
      const { id: _id, ...input } = variables as CardDef;
      return { data: (await adminUpdateCard(id, input)) as never };
    } catch (error) {
      throw errorResponse(error);
    }
  },
  async update({ resource, id, variables }) {
    if (resource !== 'cards') throw errorResponse(null, `Unsupported Refine resource: ${resource}`);
    try {
      return { data: (await adminUpdateCard(String(id), variables as Partial<CardDef>)) as never };
    } catch (error) {
      throw errorResponse(error);
    }
  },
  async deleteOne({ resource }) {
    throw { message: `${resource} records cannot be deleted`, statusCode: 405 } satisfies HttpError;
  },
};
