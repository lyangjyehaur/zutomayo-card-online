import { useCallback, useEffect, useState } from 'react';
import { useGetIdentity, useList } from '@refinedev/core';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import {
  adminCreateChatUserSanction,
  adminGetChatConversationMessages,
  adminGetChatReports,
  adminGetMatches,
  adminGetUsers,
  adminReviewChatMessageModeration,
  adminReviewChatReport,
  adminRevokeChatUserSanction,
  adminUpdateUserRole,
  type AdminMatch,
  type AdminRole,
  type AdminUser,
  type ChatConversation,
  type ChatMessage,
  type ChatReport,
} from '../api/client';
import type { CardDef } from '../game/types';
import { AboutSettingsEditor, SongTitleEditor } from '../pages/AdminPage';
import { AdminAnnouncementsPanel } from '../components/AdminAnnouncementsPanel';
import { AdminDeckShareReportsPanel } from '../components/AdminDeckShareReportsPanel';
import { AdminOfficialRulingsPanel } from '../components/AdminOfficialRulingsPanel';
import { AdminOperationsPanel } from '../components/AdminOperationsPanel';
import { AdminTranslationSettingsPanel } from '../components/AdminTranslationSettingsPanel';
import { AdminNotificationSettingsPanel } from '../components/AdminNotificationSettingsPanel';
import { AdminSupportInboxPanel } from '../components/AdminSupportInboxPanel';
import {
  Alert,
  Badge,
  Button,
  DataListCell,
  DataListTable,
  EmptyState,
  LoadingState,
  SearchInput,
  SegmentedControl,
  Select,
} from '../ui';
import { ADMIN_TOKEN_KEY } from './providers';

function token() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
}

function ResourceFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-resource-page">
      <header className="admin-resource-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export function SongsPage() {
  const { query } = useList<CardDef>({ resource: 'cards', pagination: { mode: 'off' } });
  return (
    <ResourceFrame title="歌曲名稱" description="維護各語言的歌曲標題顯示，不改動卡牌的官方來源資料。">
      {query.isLoading ? (
        <LoadingState label="載入卡牌…" />
      ) : query.isError ? (
        <Alert tone="danger">卡牌載入失敗</Alert>
      ) : (
        <SongTitleEditor cards={query.data?.data ?? []} />
      )}
    </ResourceFrame>
  );
}

export function AboutPage() {
  return (
    <ResourceFrame title="About 內容" description="維護首頁 About 彈窗的多語內容與社群連結。">
      <AboutSettingsEditor />
    </ResourceFrame>
  );
}
export function OfficialRulingsPage() {
  return (
    <ResourceFrame title="官方 Q&A 與勘誤" description="檢查官方來源差異、翻譯覆蓋率與人工複核狀態。">
      <AdminOfficialRulingsPanel />
    </ResourceFrame>
  );
}
export function DeckSharesPage() {
  return (
    <ResourceFrame title="分享內容審核" description="處理牌組分享的檢舉、隱藏與恢復。">
      <AdminDeckShareReportsPanel token={token()} />
    </ResourceFrame>
  );
}
export function OperationsPage() {
  return (
    <ResourceFrame title="營運與合規" description="管理賽季、資料保留與 legal hold 工作流。">
      <AdminOperationsPanel token={token()} />
    </ResourceFrame>
  );
}
export function SupportInboxPage() {
  return (
    <ResourceFrame title="聯絡信箱" description="同步 Resend 收件、查看詢問內容並在原郵件討論串直接回覆。">
      <AdminSupportInboxPanel token={token()} />
    </ResourceFrame>
  );
}
export function AnnouncementsPage() {
  return (
    <ResourceFrame title="公告" description="建立、發布、排程與封存站內公告。">
      <AdminAnnouncementsPanel />
    </ResourceFrame>
  );
}
export function TranslationPage() {
  return (
    <ResourceFrame title="翻譯服務" description="設定自動翻譯端點、模型與連線測試。">
      <AdminTranslationSettingsPanel token={token()} />
    </ResourceFrame>
  );
}
export function NotificationsPage() {
  return (
    <ResourceFrame title="管理員通知" description="設定新郵件等營運事件的 Bark、Telegram 與 Webhook 通知。">
      <AdminNotificationSettingsPanel token={token()} />
    </ResourceFrame>
  );
}

export function UsersPage() {
  const { data: identity } = useGetIdentity<{ role: AdminRole | null }>();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, AdminRole | 'none'>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(
    async (search = query) => {
      setLoading(true);
      setError('');
      try {
        setUsers((await adminGetUsers(token(), { query: search })).users);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '使用者載入失敗');
      } finally {
        setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    void refresh('');
  }, [refresh]);
  const saveRole = async (user: AdminUser) => {
    const selected = drafts[user.id] ?? user.adminRole ?? 'none';
    const role = selected === 'none' ? null : selected;
    if (role === user.adminRole || user.isCurrentAdmin) return;
    if (role === null && !window.confirm(`確定撤回 ${user.email} 的管理權限？`)) return;
    setSaving(user.id);
    setError('');
    setNotice('');
    try {
      await adminUpdateUserRole(token(), user.id, role);
      setNotice(`已更新 ${user.email} 的管理權限`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '權限更新失敗');
    } finally {
      setSaving('');
    }
  };
  return (
    <ResourceFrame title="使用者" description="查詢帳號、對戰統計與管理角色。">
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
      >
        <SearchInput
          containerClassName="min-w-[16rem] flex-1"
          icon={<Search className="size-4" />}
          placeholder="Email、暱稱或 ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" size="sm">
          搜尋
        </Button>
        <Badge>{users.length} 位</Badge>
      </form>
      {notice && (
        <Alert className="mb-3" tone="success">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert className="mb-3" tone="danger">
          {error}
        </Alert>
      )}
      {loading ? (
        <LoadingState label="載入使用者…" />
      ) : users.length === 0 ? (
        <EmptyState title="找不到使用者" />
      ) : (
        <DataListTable className="admin-responsive-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>暱稱</th>
              <th>場次</th>
              <th>勝率</th>
              {identity?.role === 'admin' && <th>管理權限</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <DataListCell label="ID" className="font-mono text-xs">
                  {user.id}
                </DataListCell>
                <DataListCell label="Email">{user.email}</DataListCell>
                <DataListCell label="暱稱">{user.nickname}</DataListCell>
                <DataListCell label="場次">{user.matchCount}</DataListCell>
                <DataListCell label="勝率">{user.winRate}%</DataListCell>
                {identity?.role === 'admin' && (
                  <DataListCell label="管理權限">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        disabled={user.isCurrentAdmin || saving === user.id}
                        value={drafts[user.id] ?? user.adminRole ?? 'none'}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [user.id]: event.target.value as AdminRole | 'none' }))
                        }
                      >
                        <option value="none">無管理權限</option>
                        <option value="viewer">viewer</option>
                        <option value="moderator">moderator</option>
                        <option value="operator">operator</option>
                        <option value="admin">admin</option>
                      </Select>
                      {user.isCurrentAdmin ? (
                        <Badge tone="gold">目前帳號</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            saving === user.id ||
                            (drafts[user.id] ?? user.adminRole ?? 'none') === (user.adminRole ?? 'none')
                          }
                          onClick={() => void saveRole(user)}
                        >
                          <ShieldCheck className="size-4" />
                          套用
                        </Button>
                      )}
                    </div>
                  </DataListCell>
                )}
              </tr>
            ))}
          </tbody>
        </DataListTable>
      )}
    </ResourceFrame>
  );
}

export function MatchesPage() {
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMatches((await adminGetMatches(token(), 100)).matches);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '對戰紀錄載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <ResourceFrame title="對戰紀錄" description="查看最近已提交的線上對戰與計分結果。">
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => void refresh()}>
          <RefreshCw className="size-4" />
          重新整理
        </Button>
      </div>
      {error && (
        <Alert className="mb-3" tone="danger">
          {error}
        </Alert>
      )}
      {loading ? (
        <LoadingState label="載入對戰…" />
      ) : (
        <DataListTable className="admin-responsive-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>勝者</th>
              <th>敗者</th>
              <th>回合</th>
              <th>時長</th>
              <th>時間</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => (
              <tr key={match.id}>
                <DataListCell label="ID" className="font-mono text-xs">
                  {match.id}
                </DataListCell>
                <DataListCell label="勝者">{match.winnerNickname ?? match.winnerId}</DataListCell>
                <DataListCell label="敗者">{match.loserNickname ?? match.loserId}</DataListCell>
                <DataListCell label="回合">{match.turns ?? '—'}</DataListCell>
                <DataListCell label="時長">
                  {match.duration == null ? '—' : `${Math.round(match.duration / 60)}m`}
                </DataListCell>
                <DataListCell label="時間">{new Date(match.createdAt).toLocaleString()}</DataListCell>
              </tr>
            ))}
          </tbody>
        </DataListTable>
      )}
    </ResourceFrame>
  );
}

type Evidence = { conversation: ChatConversation; messages: ChatMessage[] };

export function ChatPage() {
  const [status, setStatus] = useState<'open' | 'reviewing' | 'resolved' | 'dismissed'>('open');
  const [reports, setReports] = useState<ChatReport[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [focused, setFocused] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReports((await adminGetChatReports(token(), status)).reports);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '聊天檢舉載入失敗');
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const act = async (key: string, action: () => Promise<unknown>) => {
    setSaving(key);
    setError('');
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失敗');
    } finally {
      setSaving('');
    }
  };
  const loadEvidence = async (report: ChatReport) => {
    if (evidence?.conversation.id === report.conversationId) {
      setEvidence(null);
      return;
    }
    setSaving(`evidence:${report.id}`);
    try {
      setEvidence(await adminGetChatConversationMessages(token(), report.conversationId));
      setFocused(report.messageId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上下文載入失敗');
    } finally {
      setSaving('');
    }
  };
  const reloadEvidence = async () => {
    if (evidence) setEvidence(await adminGetChatConversationMessages(token(), evidence.conversation.id));
  };
  const reportActions = (report: ChatReport) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={Boolean(saving)} onClick={() => void loadEvidence(report)}>
        上下文
      </Button>
      {report.message?.activeSanction ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={Boolean(saving)}
          onClick={() =>
            void act(`unmute:${report.id}`, () =>
              adminRevokeChatUserSanction(token(), report.message!.activeSanction!.id),
            )
          }
        >
          解除禁言
        </Button>
      ) : report.message?.authorUserId ? (
        <Button
          size="sm"
          variant="danger"
          disabled={Boolean(saving)}
          onClick={() =>
            void act(`mute:${report.id}`, () =>
              adminCreateChatUserSanction(token(), {
                targetUserId: report.message!.authorUserId!,
                durationMinutes: 1440,
                reason: report.reason,
                sourceReportId: report.id,
                sourceMessageId: report.messageId,
                conversationId: report.conversationId,
              }),
            )
          }
        >
          禁言 24h
        </Button>
      ) : null}
      {report.status === 'open' && (
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(saving)}
          onClick={() =>
            void act(`review:${report.id}`, () => adminReviewChatReport(token(), report.id, { status: 'reviewing' }))
          }
        >
          審核中
        </Button>
      )}
      {report.status !== 'resolved' && (
        <Button
          size="sm"
          disabled={Boolean(saving)}
          onClick={() =>
            void act(`resolve:${report.id}`, () => adminReviewChatReport(token(), report.id, { status: 'resolved' }))
          }
        >
          已處理
        </Button>
      )}
      {report.status !== 'dismissed' && (
        <Button
          size="sm"
          variant="ghost"
          disabled={Boolean(saving)}
          onClick={() =>
            void act(`dismiss:${report.id}`, () => adminReviewChatReport(token(), report.id, { status: 'dismissed' }))
          }
        >
          駁回
        </Button>
      )}
    </div>
  );
  return (
    <ResourceFrame title="聊天安全" description="審查檢舉、查看上下文、處理訊息與使用者禁言。">
      <div className="mb-4 flex flex-wrap justify-between gap-3">
        <SegmentedControl
          behavior="tabs"
          size="sm"
          ariaLabel="檢舉狀態"
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          options={['open', 'reviewing', 'resolved', 'dismissed'].map((value) => ({ value, label: value }))}
        />
        <Button size="sm" variant="secondary" onClick={() => void refresh()}>
          <RefreshCw className="size-4" />
          重新整理
        </Button>
      </div>
      {error && (
        <Alert className="mb-3" tone="danger">
          {error}
        </Alert>
      )}
      {loading ? (
        <LoadingState label="載入聊天檢舉…" />
      ) : reports.length === 0 ? (
        <EmptyState title="沒有聊天檢舉" />
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <article key={report.id} className="grid gap-3 border border-border-soft bg-surface-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={report.status === 'resolved' ? 'jade' : report.status === 'dismissed' ? 'neutral' : 'gold'}
                >
                  {report.status}
                </Badge>
                <span className="font-mono text-xs text-content-muted">{report.id}</span>
                <time className="ml-auto text-xs text-content-muted">
                  {new Date(report.createdAt).toLocaleString()}
                </time>
              </div>
              <div>
                <span className="text-xs text-content-muted">
                  {report.message?.authorDisplayName || report.message?.authorUserId || 'Unknown'}
                </span>
                <p className="mt-1 whitespace-pre-wrap">{report.message?.content || '訊息已刪除或無法讀取'}</p>
              </div>
              <div className="border-l-2 border-accent-primary px-3 text-body-sm">
                <strong>{report.reason}</strong>
                {report.note && <p className="text-content-muted">{report.note}</p>}
              </div>
              {reportActions(report)}
            </article>
          ))}
        </div>
      )}
      {evidence && (
        <section className="mt-5 grid gap-2 border-t border-border-soft pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display font-bold">聊天上下文</h2>
              <span className="font-mono text-xs text-content-muted">{evidence.conversation.id}</span>
            </div>
            <Badge>{evidence.messages.length} messages</Badge>
          </div>
          {evidence.messages.map((message) => (
            <article
              key={message.id}
              className={`grid gap-2 border-l-2 p-3 ${message.id === focused ? 'border-accent-primary bg-accent-primary/10' : 'border-border-soft bg-surface-panel'}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                <span>{message.authorDisplayName || message.authorUserId || 'Unknown'}</span>
                <Badge
                  tone={
                    message.moderationStatus === 'visible'
                      ? 'jade'
                      : message.moderationStatus === 'blocked'
                        ? 'vermilion'
                        : 'gold'
                  }
                >
                  {message.deletedAt ? 'deleted' : message.moderationStatus}
                </Badge>
                <time>{new Date(message.createdAt).toLocaleString()}</time>
                <span className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(saving)}
                    onClick={() =>
                      void act(`message:${message.id}:visible`, async () => {
                        await adminReviewChatMessageModeration(token(), message.id, {
                          status: 'visible',
                          reason: 'manual_visible',
                        });
                        await reloadEvidence();
                      })
                    }
                  >
                    放行
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(saving)}
                    onClick={() =>
                      void act(`message:${message.id}:blocked`, async () => {
                        await adminReviewChatMessageModeration(token(), message.id, {
                          status: 'blocked',
                          reason: 'manual_blocked',
                        });
                        await reloadEvidence();
                      })
                    }
                  >
                    封鎖
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={Boolean(saving)}
                    onClick={() =>
                      void act(`message:${message.id}:deleted`, async () => {
                        await adminReviewChatMessageModeration(token(), message.id, {
                          status: 'deleted',
                          reason: 'manual_deleted',
                        });
                        await reloadEvidence();
                      })
                    }
                  >
                    刪除
                  </Button>
                </span>
              </div>
              <p className="whitespace-pre-wrap">{message.content || '（空白訊息）'}</p>
            </article>
          ))}
        </section>
      )}
    </ResourceFrame>
  );
}
