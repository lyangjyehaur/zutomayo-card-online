import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, Languages, Plus, RefreshCw, Send, Trash2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  addFriend,
  fetchChatMessages,
  fetchUnreadChat,
  getFriends,
  getProfile,
  isLoggedIn,
  markChatRead,
  removeFriend,
  reportChatMessage,
  requestChatTranslation,
  sendChatMessage,
  type ChatMessage,
  type ChatUnreadConversation,
  type FriendProfile,
  type ProfileResponse,
} from '../api/client';
import { buildDirectConversationSubjectId } from '../chat/directConversation';
import { resolveUnreadConversationAction } from '../chat/unreadNavigation';
import { buildMatchHistoryChatPath } from '../game/matchHistory';
import { AuthSection } from '../components/lobby/AuthSection';
import { useToast } from '../components/ToastProvider';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, IconButton, Input, PageShell, SegmentedControl } from '../ui';

const GLOBAL_LOBBY_CHAT_SUBJECT_ID = 'online-lobby';
type CommunityView = 'global' | 'direct';
type TranslationState = { status: string; content?: string };
type CommunityMessage = ChatMessage & { translation?: TranslationState };

function visibleMessage(message: ChatMessage): boolean {
  return message.moderationStatus === 'visible' || message.moderationStatus === 'pending_review';
}

export function CommunityPage({ onAuthChanged }: { onAuthChanged: () => void | Promise<void> }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [view, setView] = useState<CommunityView>('global');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [unreadChats, setUnreadChats] = useState<ChatUnreadConversation[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<FriendProfile | null>(null);
  const [friendDraft, setFriendDraft] = useState('');
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => new Set());

  const refreshIdentity = useCallback(async () => {
    if (!isLoggedIn()) {
      setProfile(null);
      setFriends([]);
      setUnreadChats([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextProfile, nextFriends, nextUnread] = await Promise.all([
        getProfile(),
        getFriends(),
        fetchUnreadChat(10),
      ]);
      setProfile(nextProfile);
      setFriends(nextFriends);
      setUnreadChats(nextUnread);
    } catch {
      setProfile(null);
      setFriends([]);
      setUnreadChats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  const directSubjectId =
    profile && selectedFriend ? buildDirectConversationSubjectId(profile.id, selectedFriend.userId) : '';
  const subjectId = view === 'global' ? GLOBAL_LOBBY_CHAT_SUBJECT_ID : directSubjectId;
  const conversationType = view === 'global' ? 'global' : 'direct';

  const refreshMessages = useCallback(async () => {
    if (!profile || !subjectId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await fetchChatMessages({ conversationType, subjectId, limit: 80 });
      const visible = next.filter(visibleMessage);
      setMessages(visible);
      await markChatRead({
        conversationType,
        subjectId,
        lastReadMessageId: visible.at(-1)?.id,
      }).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.historyUnavailable'));
    } finally {
      setLoading(false);
    }
  }, [conversationType, profile, subjectId]);

  useEffect(() => {
    void refreshMessages();
  }, [refreshMessages]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const handleAuthChanged = async () => {
    await onAuthChanged();
    await refreshIdentity();
  };

  const handleAddFriend = async () => {
    const userId = friendDraft.trim();
    if (!userId) return;
    try {
      await addFriend(userId);
      setFriendDraft('');
      setFriends(await getFriends());
      showToast({ title: t('friend.added'), kind: 'success' });
    } catch {
      showToast({ title: t('friend.addFailed'), kind: 'error' });
    }
  };

  const handleRemoveFriend = async (friend: FriendProfile) => {
    try {
      await removeFriend(friend.userId);
      if (selectedFriend?.userId === friend.userId) setSelectedFriend(null);
      setFriends(await getFriends());
      showToast({ title: t('friend.removed'), kind: 'success' });
    } catch {
      showToast({ title: t('friend.removeFailed'), kind: 'error' });
    }
  };

  const openUnreadConversation = (conversation: ChatUnreadConversation) => {
    const action = resolveUnreadConversationAction(conversation, { profileId: profile?.id, friends });
    if (!action) return;
    if (action.kind === 'match') {
      navigate(buildMatchHistoryChatPath(action.subjectId));
      return;
    }
    if (action.kind === 'room') {
      navigate(`/online?room=${encodeURIComponent(action.subjectId)}`);
      return;
    }
    if (action.kind === 'global') {
      setView('global');
      return;
    }
    setSelectedFriend(action.friend || friends.find((friend) => friend.userId === action.peerUserId) || null);
    setView('direct');
  };

  const handleSend = async () => {
    if (!profile || !subjectId || !draft.trim() || sending) return;
    setSending(true);
    try {
      const result = await sendChatMessage({
        conversationType,
        subjectId,
        content: draft.trim(),
        title:
          view === 'global'
            ? t('chat.globalTitle')
            : `${profile.nickname} / ${selectedFriend?.nickname || selectedFriend?.userId || ''}`,
        authorDisplayName: profile.nickname,
        authorRole: 'player',
      });
      if (visibleMessage(result.message)) setMessages((current) => [...current, result.message]);
      setDraft('');
    } catch {
      showToast({ title: t('chat.sendFailed'), kind: 'error' });
    } finally {
      setSending(false);
    }
  };

  const translateMessage = async (message: CommunityMessage) => {
    if (message.translation?.status === 'loading') return;
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, translation: { status: 'loading' } } : item)),
    );
    try {
      const result = await requestChatTranslation(message.id, locale.toLowerCase());
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                translation: {
                  status: result.translation.status,
                  content: result.translation.translatedContent || undefined,
                },
              }
            : item,
        ),
      );
    } catch {
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? { ...item, translation: { status: 'unavailable' } } : item)),
      );
    }
  };

  const reportMessage = async (message: CommunityMessage) => {
    if (message.authorUserId === profile?.id || reportedIds.has(message.id)) return;
    setReportedIds((current) => new Set(current).add(message.id));
    try {
      await reportChatMessage(message.id, { reason: 'inappropriate' });
      showToast({ title: t('chat.reported'), kind: 'success' });
    } catch {
      setReportedIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      showToast({ title: t('chat.reportFailed'), kind: 'error' });
    }
  };

  return (
    <PageShell className="overflow-y-auto bg-surface-canvas">
      <AppHeader
        title={t('community.title')}
        backTo="/"
        actions={<AuthSection onAuthChanged={handleAuthChanged} compact />}
      />
      <main className="mx-auto grid min-h-full w-full max-w-7xl gap-4 px-4 pb-6 pt-24 lg:grid-cols-[18rem_minmax(0,1fr)] lg:px-6">
        <aside className="min-w-0 border-r border-border-soft pr-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <Users className="size-4 text-accent-primary" aria-hidden="true" />
              {t('friend.title')}
            </h2>
            <IconButton
              label={t('friend.refresh')}
              icon={<RefreshCw className="size-4" />}
              onClick={() => void refreshIdentity()}
            />
          </div>
          {profile && (
            <div className="mt-3 flex gap-2">
              <Input
                value={friendDraft}
                onChange={(event) => setFriendDraft(event.target.value.slice(0, 128))}
                placeholder={t('friend.userId')}
                aria-label={t('friend.userId')}
              />
              <IconButton
                label={t('friend.add')}
                icon={<Plus className="size-4" />}
                onClick={() => void handleAddFriend()}
                disabled={!friendDraft.trim()}
              />
            </div>
          )}
          <div className="mt-3 grid gap-1">
            {friends.map((friend) => (
              <div
                key={friend.userId}
                data-friend-user-id={friend.userId}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border px-3 py-2 ${selectedFriend?.userId === friend.userId ? 'border-accent-primary bg-accent-primary/10' : 'border-border-soft'}`}
              >
                <button
                  type="button"
                  className="min-h-touch min-w-0 text-left"
                  data-direct-chat-open={friend.userId}
                  onClick={() => {
                    setSelectedFriend(friend);
                    setView('direct');
                  }}
                >
                  <strong className="block truncate text-body">{friend.nickname || friend.userId}</strong>
                  <span className="block truncate text-minutia text-content-dim">{friend.userId}</span>
                </button>
                <IconButton
                  label={t('friend.remove')}
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => void handleRemoveFriend(friend)}
                />
              </div>
            ))}
          </div>
          {unreadChats.length > 0 && (
            <div className="mt-5 border-t border-border-soft pt-3" data-chat-surface="unread">
              <h3 className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim">
                {t('chat.unreadTitle')}
              </h3>
              <div className="mt-2 grid gap-1">
                {unreadChats.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className="grid min-h-touch grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-border-soft px-3 py-2 text-left"
                    data-unread-conversation={conversation.type}
                    data-unread-subject={conversation.subjectId}
                    onClick={() => openUnreadConversation(conversation)}
                  >
                    <span className="truncate text-caption">{conversation.title || conversation.subjectId}</span>
                    <span className="font-mono text-caption text-accent-primary">{conversation.unreadCount}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section
          className="grid min-h-[65vh] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] border border-border-soft bg-surface-base/45"
          data-chat-surface={conversationType}
          data-chat-subject={subjectId}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft p-3">
            <SegmentedControl
              ariaLabel={t('community.title')}
              value={view}
              onChange={setView}
              options={[
                { value: 'global', label: t('chat.globalTitle') },
                { value: 'direct', label: t('chat.directTitle') },
              ]}
            />
            <IconButton
              label={t('chat.refreshUnread')}
              icon={<RefreshCw className="size-4" />}
              onClick={() => void refreshMessages()}
            />
          </header>

          <div ref={messagesRef} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
            {!profile && (
              <div className="m-auto max-w-md text-center text-body text-content-muted">
                {t('community.loginRequired')}
              </div>
            )}
            {profile && view === 'direct' && !selectedFriend && (
              <div className="m-auto text-body text-content-muted">{t('chat.selectDirect')}</div>
            )}
            {loading && profile && <div className="m-auto text-caption text-content-dim">{t('presence.syncing')}</div>}
            {error && <Alert tone="danger">{error}</Alert>}
            {messages.map((message) => {
              const self = message.authorUserId === profile?.id;
              return (
                <article
                  key={message.id}
                  data-chat-message={conversationType}
                  className={`max-w-[85%] ${self ? 'self-end text-right' : 'self-start'}`}
                >
                  <div className="mb-1 flex items-center gap-1 text-minutia text-content-dim">
                    <span>{message.authorDisplayName || t('auth.guest')}</span>
                    <IconButton
                      size="sm"
                      label={t('chat.translate')}
                      icon={<Languages className="size-3" />}
                      onClick={() => void translateMessage(message)}
                    />
                    {!self && (
                      <IconButton
                        size="sm"
                        label={reportedIds.has(message.id) ? t('chat.reported') : t('chat.report')}
                        icon={<Flag className="size-3" />}
                        disabled={reportedIds.has(message.id)}
                        onClick={() => void reportMessage(message)}
                      />
                    )}
                  </div>
                  <div
                    className={`rounded-sm border px-3 py-2 text-body [overflow-wrap:anywhere] ${self ? 'border-accent-primary/40 bg-accent-primary/10' : 'border-border-soft bg-surface-elevated/60'}`}
                  >
                    {message.content}
                  </div>
                  {message.translation && (
                    <div className="mt-1 rounded-sm border border-border-soft px-3 py-2 text-caption text-content-muted">
                      {message.translation.content ||
                        (message.translation.status === 'loading'
                          ? t('chat.translationTranslating')
                          : t('chat.translationOffline'))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <form
            className="grid grid-cols-[minmax(0,1fr)_var(--touch-target-min)] gap-2 border-t border-border-soft p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend();
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 500))}
              placeholder={t('chat.messagePlaceholder')}
              aria-label={t('chat.messagePlaceholder')}
              disabled={!profile || !subjectId || sending}
            />
            <IconButton
              type="submit"
              variant="secondary"
              label={t('chat.send')}
              icon={<Send className="size-4" />}
              disabled={!profile || !subjectId || !draft.trim() || sending}
            />
          </form>
        </section>
      </main>
    </PageShell>
  );
}
