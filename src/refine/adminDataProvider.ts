import type {
  BaseRecord,
  DataProvider,
  DeleteOneParams,
  DeleteOneResponse,
  GetListParams,
  GetListResponse,
  GetOneParams,
  GetOneResponse,
  UpdateParams,
  UpdateResponse,
} from '@refinedev/core';
import {
  adminGetMatches,
  adminGetUsers,
  adminResetElo,
  adminUpdateCard,
  adminUpdateCardI18n,
  adminUpdateConfig,
  fetchCardI18n,
  fetchCards,
} from '../api/client';
import type { CardDef } from '../game/types';

const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';

type CardI18nUpdate = {
  effectText?: string;
  lang?: string;
};

type ConfigUpdate = {
  value?: unknown;
};

type UserEloUpdate = {
  elo?: number;
};

type EmptyVariables = Record<string, never>;

function adminToken(): string {
  return (
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ADMIN_TOKEN_KEY)) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(ADMIN_TOKEN_KEY)) ||
    ''
  );
}

function pageSizeFromPagination(pagination: Parameters<DataProvider['getList']>[0]['pagination'], fallback: number) {
  return pagination && pagination.mode !== 'off' && typeof pagination.pageSize === 'number'
    ? pagination.pageSize
    : fallback;
}

function unsupported(resource: string, action: string): never {
  throw new Error(`Refine admin dataProvider does not support ${action} for ${resource}`);
}

export const adminRefineDataProvider: DataProvider = {
  getApiUrl: () => '/api/admin',

  getList: async <TData extends BaseRecord = BaseRecord>({
    resource,
    pagination,
  }: GetListParams): Promise<GetListResponse<TData>> => {
    if (resource === 'users') {
      const { users } = await adminGetUsers(adminToken(), pageSizeFromPagination(pagination, 100));
      return { data: users as unknown as TData[], total: users.length };
    }

    if (resource === 'matches') {
      const { matches } = await adminGetMatches(adminToken(), pageSizeFromPagination(pagination, 50));
      return { data: matches as unknown as TData[], total: matches.length };
    }

    if (resource === 'cards') {
      const cards = await fetchCards(true);
      return { data: cards as unknown as TData[], total: cards.length };
    }

    unsupported(resource, 'getList');
  },

  getOne: async <TData extends BaseRecord = BaseRecord>({
    resource,
    id,
  }: GetOneParams): Promise<GetOneResponse<TData>> => {
    if (resource === 'cards') {
      const cards = await fetchCards();
      const card = cards.find((item) => item.id === id);
      if (!card) throw new Error(`Card not found: ${id}`);
      return { data: card as unknown as TData };
    }

    if (resource === 'cardI18n') {
      const data = await fetchCardI18n(String(id));
      return { data: { id, ...data } as unknown as TData };
    }

    unsupported(resource, 'getOne');
  },

  create: async ({ resource }) => {
    unsupported(resource, 'create');
  },

  update: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>({
    resource,
    id,
    variables,
  }: UpdateParams<TVariables>): Promise<UpdateResponse<TData>> => {
    if (resource === 'users') {
      const { elo = 1000 } = variables as UserEloUpdate;
      const data = await adminResetElo(adminToken(), String(id), Math.trunc(Number(elo) || 1000));
      return { data: data as unknown as TData };
    }

    if (resource === 'cards') {
      const data = await adminUpdateCard(String(id), variables as Partial<CardDef>);
      return { data: data as unknown as TData };
    }

    if (resource === 'cardI18n') {
      const { effectText = '', lang = '' } = variables as CardI18nUpdate;
      await adminUpdateCardI18n(String(id), lang, effectText);
      return { data: { id, effectText, lang } as unknown as TData };
    }

    if (resource === 'config') {
      const { value } = variables as ConfigUpdate;
      await adminUpdateConfig(String(id), value);
      return { data: { id, value } as unknown as TData };
    }

    unsupported(resource, 'update');
  },

  deleteOne: async <TData extends BaseRecord = BaseRecord, TVariables = EmptyVariables>({
    resource,
    id,
  }: DeleteOneParams<TVariables>): Promise<DeleteOneResponse<TData>> => {
    if (resource === 'users' || resource === 'matches' || resource === 'cards') {
      unsupported(resource, 'deleteOne');
    }
    return { data: { id } as unknown as TData };
  },
};

export const adminRefineResources = [
  { name: 'cards', meta: { label: '卡牌資料' } },
  { name: 'cardI18n', meta: { label: '卡牌翻譯' } },
  { name: 'users', meta: { label: '使用者' } },
  { name: 'matches', meta: { label: '對戰' } },
  { name: 'config', meta: { label: '設定' } },
];
