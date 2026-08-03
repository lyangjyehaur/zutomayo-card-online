import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  adminGetCards: vi.fn(),
  adminLogin: vi.fn(),
  adminLoginWithAccount: vi.fn(),
  adminLogout: vi.fn(),
  adminUpdateCard: vi.fn(),
}));

vi.mock('../../api/client', () => api);

import {
  ADMIN_ROLE_KEY,
  ADMIN_TOKEN_KEY,
  adminAccessControlProvider,
  adminAuthProvider,
  adminDataProvider,
} from '../providers';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const card = {
  id: 'PROMO-001',
  name: 'テスト',
  pack: 'PROMO',
  song: '',
  illustrator: '',
  rarity: 'N',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 1, day: 1 },
  powerCost: 1,
  sendToPower: 1,
  effect: '',
  image: '',
  errata: '',
  publicationStatus: 'draft',
  playStatus: 'disabled',
};

describe('Refine admin providers', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() });
    vi.clearAllMocks();
  });

  it('logs in through Refine and redirects each role to an available resource', async () => {
    api.adminLogin.mockResolvedValue({ token: 'token', role: 'moderator', expiresIn: 900 });
    const result = await adminAuthProvider.login({ username: 'staff', password: 'secret', totpCode: '123456' });
    expect(result).toMatchObject({ success: true, redirectTo: '/admin/chat' });
    expect(sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBe('token');
    expect(sessionStorage.getItem(ADMIN_ROLE_KEY)).toBe('moderator');
  });

  it('exchanges an existing account session through the same auth provider', async () => {
    api.adminLoginWithAccount.mockResolvedValue({ token: 'linked', role: 'viewer', expiresIn: 900 });
    const result = await adminAuthProvider.login({ accountSession: true });
    expect(api.adminLoginWithAccount).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, redirectTo: '/admin/users' });
  });

  it('keeps Refine resources aligned with backend role capabilities', async () => {
    sessionStorage.setItem(ADMIN_ROLE_KEY, 'viewer');
    await expect(
      adminAccessControlProvider.can({ resource: 'users', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: true });
    await expect(
      adminAccessControlProvider.can({ resource: 'cards', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: false });
    sessionStorage.setItem(ADMIN_ROLE_KEY, 'moderator');
    await expect(
      adminAccessControlProvider.can({ resource: 'chat', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: true });
    await expect(
      adminAccessControlProvider.can({ resource: 'support-inbox', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: true });
    await expect(
      adminAccessControlProvider.can({ resource: 'official-rulings', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: false });
    sessionStorage.setItem(ADMIN_ROLE_KEY, 'operator');
    await expect(
      adminAccessControlProvider.can({ resource: 'cards', action: 'edit', params: {} }),
    ).resolves.toMatchObject({ can: true });
    await expect(
      adminAccessControlProvider.can({ resource: 'official-rulings', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: true });
    await expect(
      adminAccessControlProvider.can({ resource: 'notifications', action: 'list', params: {} }),
    ).resolves.toMatchObject({ can: true });
  });

  it('uses the PostgreSQL-backed card endpoint for list, create and update', async () => {
    api.adminGetCards.mockResolvedValue([card]);
    api.adminUpdateCard.mockImplementation(async (id: string, values: object) => ({ ...card, ...values, id }));
    const list = await adminDataProvider.getList({
      resource: 'cards',
      pagination: { mode: 'off' },
      filters: [],
      sorters: [],
    });
    expect(list.data).toEqual([card]);
    const created = await adminDataProvider.create({ resource: 'cards', variables: card });
    expect(created.data).toMatchObject({ id: 'PROMO-001' });
    expect(api.adminUpdateCard).toHaveBeenCalledWith('PROMO-001', expect.not.objectContaining({ id: 'PROMO-001' }));
    await adminDataProvider.update({
      resource: 'cards',
      id: 'PROMO-001',
      variables: { publicationStatus: 'reviewed' },
    });
    expect(api.adminUpdateCard).toHaveBeenLastCalledWith('PROMO-001', { publicationStatus: 'reviewed' });
  });
});
