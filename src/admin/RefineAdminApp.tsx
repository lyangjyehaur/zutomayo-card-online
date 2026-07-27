import { Authenticated, CanAccess, Refine, useGetIdentity } from '@refinedev/core';
import routerProvider from '@refinedev/react-router';
import {
  Activity,
  BookOpenText,
  Info,
  Languages,
  Library,
  MessageSquareWarning,
  Megaphone,
  Music2,
  Network,
  Settings2,
  Share2,
  Swords,
  Users,
} from 'lucide-react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Alert, LoadingState } from '../ui';
import { AdminLayout } from './AdminLayout';
import { AdminLoginPage } from './AdminLoginPage';
import { CardCreatePage, CardEditPage, CardListPage } from './CardPages';
import { I18nAuditPage } from './I18nAuditPage';
import {
  AboutPage,
  AnnouncementsPage,
  ChatPage,
  DeckSharesPage,
  MatchesPage,
  OfficialRulingsPage,
  OperationsPage,
  SongsPage,
  TranslationPage,
  UsersPage,
} from './ResourcePages';
import { adminAccessControlProvider, adminAuthProvider, adminDataProvider } from './providers';
import type { AdminRole } from '../api/client';
import { SynergyPage } from './SynergyPage';

const resources = [
  {
    name: 'cards',
    list: '/admin/cards',
    create: '/admin/cards/create',
    edit: '/admin/cards/edit/:id',
    meta: { label: '卡牌維護', icon: <Library className="size-4" /> },
  },
  { name: 'songs', list: '/admin/songs', meta: { label: '歌曲名稱', icon: <Music2 className="size-4" /> } },
  { name: 'synergies', list: '/admin/synergies', meta: { label: '卡牌聯動', icon: <Network className="size-4" /> } },
  {
    name: 'official-rulings',
    list: '/admin/official-rulings',
    meta: { label: '官方裁定', icon: <BookOpenText className="size-4" /> },
  },
  { name: 'users', list: '/admin/users', meta: { label: '使用者', icon: <Users className="size-4" /> } },
  { name: 'matches', list: '/admin/matches', meta: { label: '對戰紀錄', icon: <Swords className="size-4" /> } },
  { name: 'chat', list: '/admin/chat', meta: { label: '聊天安全', icon: <MessageSquareWarning className="size-4" /> } },
  { name: 'deck-shares', list: '/admin/deck-shares', meta: { label: '分享審核', icon: <Share2 className="size-4" /> } },
  {
    name: 'operations',
    list: '/admin/operations',
    meta: { label: '營運與合規', icon: <Activity className="size-4" /> },
  },
  { name: 'about', list: '/admin/about', meta: { label: 'About 內容', icon: <Info className="size-4" /> } },
  {
    name: 'announcements',
    list: '/admin/announcements',
    meta: { label: '公告', icon: <Megaphone className="size-4" /> },
  },
  {
    name: 'translation',
    list: '/admin/translation',
    meta: { label: '翻譯服務', icon: <Settings2 className="size-4" /> },
  },
  { name: 'i18n', list: '/admin/i18n', meta: { label: '介面翻譯稽核', icon: <Languages className="size-4" /> } },
];

function AccessRoute({ resource, children }: { resource: string; children: React.ReactNode }) {
  return (
    <CanAccess
      resource={resource}
      action="list"
      fallback={<Alert tone="danger">目前管理角色沒有權限存取這項功能。</Alert>}
    >
      {children}
    </CanAccess>
  );
}

function AdminHome() {
  const { data, isLoading } = useGetIdentity<{ role: AdminRole | null }>();
  if (isLoading) return <LoadingState label="載入管理功能…" />;
  const destination =
    data?.role === 'viewer' ? '/admin/users' : data?.role === 'moderator' ? '/admin/chat' : '/admin/cards';
  return <Navigate to={destination} replace />;
}

export function RefineAdminApp() {
  return (
    <Refine
      routerProvider={routerProvider}
      authProvider={adminAuthProvider}
      accessControlProvider={adminAccessControlProvider}
      dataProvider={adminDataProvider}
      resources={resources}
      options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, disableTelemetry: true }}
    >
      <Routes>
        <Route
          path="login"
          element={
            <Authenticated key="admin-login" fallback={<AdminLoginPage />}>
              <AdminHome />
            </Authenticated>
          }
        />
        <Route
          element={
            <Authenticated
              key="admin-protected"
              redirectOnFail="/admin/login"
              loading={<LoadingState label="驗證管理員身分…" />}
            >
              <Outlet />
            </Authenticated>
          }
        >
          <Route element={<AdminLayout />}>
            <Route index element={<AdminHome />} />
            <Route
              path="cards"
              element={
                <AccessRoute resource="cards">
                  <CardListPage />
                </AccessRoute>
              }
            />
            <Route
              path="cards/create"
              element={
                <CanAccess
                  resource="cards"
                  action="create"
                  fallback={<Alert tone="danger">沒有新增卡牌的權限。</Alert>}
                >
                  <CardCreatePage />
                </CanAccess>
              }
            />
            <Route
              path="cards/edit/:id"
              element={
                <CanAccess resource="cards" action="edit" fallback={<Alert tone="danger">沒有編輯卡牌的權限。</Alert>}>
                  <CardEditPage />
                </CanAccess>
              }
            />
            <Route
              path="songs"
              element={
                <AccessRoute resource="songs">
                  <SongsPage />
                </AccessRoute>
              }
            />
            <Route
              path="official-rulings"
              element={
                <AccessRoute resource="official-rulings">
                  <OfficialRulingsPage />
                </AccessRoute>
              }
            />
            <Route
              path="synergies"
              element={
                <AccessRoute resource="synergies">
                  <SynergyPage />
                </AccessRoute>
              }
            />
            <Route
              path="users"
              element={
                <AccessRoute resource="users">
                  <UsersPage />
                </AccessRoute>
              }
            />
            <Route
              path="matches"
              element={
                <AccessRoute resource="matches">
                  <MatchesPage />
                </AccessRoute>
              }
            />
            <Route
              path="chat"
              element={
                <AccessRoute resource="chat">
                  <ChatPage />
                </AccessRoute>
              }
            />
            <Route
              path="deck-shares"
              element={
                <AccessRoute resource="deck-shares">
                  <DeckSharesPage />
                </AccessRoute>
              }
            />
            <Route
              path="operations"
              element={
                <AccessRoute resource="operations">
                  <OperationsPage />
                </AccessRoute>
              }
            />
            <Route
              path="about"
              element={
                <AccessRoute resource="about">
                  <AboutPage />
                </AccessRoute>
              }
            />
            <Route
              path="announcements"
              element={
                <AccessRoute resource="announcements">
                  <AnnouncementsPage />
                </AccessRoute>
              }
            />
            <Route
              path="translation"
              element={
                <AccessRoute resource="translation">
                  <TranslationPage />
                </AccessRoute>
              }
            />
            <Route
              path="i18n"
              element={
                <AccessRoute resource="i18n">
                  <I18nAuditPage />
                </AccessRoute>
              }
            />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Route>
      </Routes>
    </Refine>
  );
}
