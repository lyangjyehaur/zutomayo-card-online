import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, useLocale, type TranslationKey } from '../i18n';
import { getProfile, isLoggedIn } from '../api/client';
import {
  addFeedbackComment,
  adminCreateFeedbackTag,
  adminDeleteFeedbackPost,
  adminDeleteFeedbackTag,
  adminUpdatePostStatus,
  adminUpdatePostTag,
  createFeedbackPost,
  deleteFeedbackComment,
  editFeedbackComment,
  editFeedbackPost,
  getFeedbackPost,
  getFeedbackStats,
  isAdminMode,
  listFeedbackPosts,
  listFeedbackTags,
  listFeedbackVoters,
  toggleFeedbackCommentVote,
  toggleFeedbackVote,
  type FeedbackComment,
  type FeedbackPost,
  type FeedbackSort,
  type FeedbackStatus,
  type FeedbackStats,
  type FeedbackTag,
  type FeedbackVoter,
} from '../api/feedbackClient';
import { getAnonymousId } from '../api/feedbackClient';

const STATUS_OPTIONS: FeedbackStatus[] = ['open', 'planned', 'started', 'completed', 'declined'];
const SORT_OPTIONS: FeedbackSort[] = ['top', 'newest', 'recent'];

function statusKey(status: FeedbackStatus): TranslationKey {
  return ('feedback.status' + status[0].toUpperCase() + status.slice(1)) as TranslationKey;
}
function sortKey(sort: FeedbackSort): TranslationKey {
  return ('feedback.sort' + sort[0].toUpperCase() + sort.slice(1)) as TranslationKey;
}

function statusBadgeClass(status: FeedbackStatus): string {
  switch (status) {
    case 'open':
      return 'badge badge-warning badge-sm';
    case 'planned':
      return 'badge badge-info badge-sm';
    case 'started':
      return 'badge badge-primary badge-sm';
    case 'completed':
      return 'badge badge-success badge-sm';
    case 'declined':
      return 'badge badge-error badge-sm';
  }
}

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
  return rtf.format(Math.round(diffSec / 31536000), 'year');
}

function authorLabel(post: FeedbackPost): string {
  if (post.authorNickname) return post.authorNickname;
  return t('feedback.anonymous');
}
function commentAuthorLabel(c: FeedbackComment): string {
  if (c.authorNickname) return c.authorNickname;
  return t('feedback.anonymous');
}

// ===== 簡易安全 Markdown 渲染器 =====
// 先 escape HTML 防 XSS，再替換 Markdown 語法。
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = escapeHtml(text);
  // 標題
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // 連結 [text](url) — 只允許 http/https
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // 行內程式碼 `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 粗體 **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜體 *text*
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // 列表項 - item 或 * item
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)/g, '<ul>$1</ul>');
  // 換行
  html = html.replace(/\n/g, '<br/>');
  // 清理 ul 重複
  html = html.replace(/<\/ul><br\/><ul>/g, '');
  return html;
}

function Markdown({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

export function FeedbackPage() {
  const navigate = useNavigate();
  const locale = useLocale();
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<FeedbackSort>('top');
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const adminMode = isAdminMode();

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, st, tagList] = await Promise.all([
        listFeedbackPosts({ sort, status: statusFilter, tag: tagFilter, q: search }),
        getFeedbackStats(),
        listFeedbackTags(),
      ]);
      setPosts(list);
      setStats(st);
      setTags(tagList);
    } catch {
      setError(t('feedback.loadError'));
    } finally {
      setLoading(false);
    }
  }, [sort, statusFilter, tagFilter, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleVote = async (postId: string) => {
    const prev = posts;
    setPosts((cur) =>
      cur.map((p) =>
        p.id === postId ? { ...p, hasVoted: !p.hasVoted, voteCount: p.voteCount + (p.hasVoted ? -1 : 1) } : p,
      ),
    );
    try {
      await toggleFeedbackVote(postId);
    } catch {
      setPosts(prev);
    }
  };

  return (
    <main className="app-screen feedback-page min-h-screen">
      <header className="feedback-header">
        <button
          className="text-[10px] uppercase tracking-[0.3em] text-bone/50 hover:text-bone"
          type="button"
          onClick={() => navigate('/')}
        >
          {t('feedback.back')}
        </button>
        <div className="feedback-title-block">
          <h1 className="font-display text-3xl text-gold">{t('feedback.title')}</h1>
          <p className="text-xs text-bone/60">{t('feedback.subtitle')}</p>
        </div>
        {!isLoggedIn() && (
          <p className="feedback-anon-notice text-[10px] text-bone/40">{t('feedback.anonymousNotice')}</p>
        )}
      </header>

      {stats && (
        <section className="feedback-stats">
          <div className="stat-cell">
            <span className="stat-num font-mono">{Number(stats.total) || 0}</span>
            <span className="stat-label">{t('feedback.statsTotal')}</span>
          </div>
          <div className="stat-cell">
            <span className="stat-num font-mono">{Number(stats.total_votes) || 0}</span>
            <span className="stat-label">{t('feedback.statsVotes')}</span>
          </div>
          {STATUS_OPTIONS.map((s) => (
            <div key={s} className="stat-cell">
              <span className="stat-num font-mono">{Number(stats[s]) || 0}</span>
              <span className="stat-label">{t(statusKey(s))}</span>
            </div>
          ))}
        </section>
      )}

      <section className="feedback-toolbar">
        <div className="sort-tabs">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={sort === s ? 'sort-tab active' : 'sort-tab'}
              onClick={() => setSort(s)}
            >
              {t(sortKey(s))}
            </button>
          ))}
        </div>
        <select
          className="status-filter select select-bordered select-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FeedbackStatus | '')}
        >
          <option value="">{t('feedback.filterAll')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(statusKey(s))}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select
            className="status-filter select select-bordered select-xs"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">{t('feedback.filterAllTags')}</option>
            {tags.map((tg) => (
              <option key={tg.id} value={tg.name}>
                #{tg.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="search-input input input-bordered input-sm"
          placeholder={t('feedback.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="primary-action" onClick={() => setShowSubmit((v) => !v)}>
          {t('feedback.submitNew')}
        </button>
        {adminMode && (
          <button type="button" className="secondary-action" onClick={() => setShowTagPanel((v) => !v)}>
            {t('feedback.tagManage')}
          </button>
        )}
      </section>

      {tagFilter && (
        <p className="feedback-tag-active">
          {t('feedback.filteringTag')}: <span className="post-tag">#{tagFilter}</span>
          <button type="button" onClick={() => setTagFilter('')}>
            ✕
          </button>
        </p>
      )}

      {showTagPanel && adminMode && <TagManagePanel tags={tags} onChanged={() => void reload()} />}

      {showSubmit && (
        <SubmitForm
          onSubmitted={() => {
            setShowSubmit(false);
            void reload();
          }}
          onCancel={() => setShowSubmit(false)}
        />
      )}

      {loading && <p className="feedback-empty">{t('feedback.loading')}</p>}
      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && posts.length === 0 && <p className="feedback-empty">{t('feedback.empty')}</p>}

      <ul className="feedback-list">
        {posts.map((post) => (
          <li
            key={post.id}
            className="feedback-card"
            onClick={() => setSelectedId(post.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedId(post.id);
              }
            }}
          >
            <button
              type="button"
              className={'vote-column' + (post.hasVoted ? ' voted' : '')}
              onClick={(e) => {
                e.stopPropagation();
                void handleVote(post.id);
              }}
              aria-pressed={post.hasVoted}
            >
              <span className="vote-arrow">{post.hasVoted ? '▲' : '△'}</span>
              <span className="vote-count font-mono">{post.voteCount}</span>
            </button>
            <div className="post-body">
              <div className="post-title-row">
                <span className={statusBadgeClass(post.status)}>{t(statusKey(post.status))}</span>
                {post.tag && (
                  <span
                    className="post-tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTagFilter(post.tag);
                    }}
                  >
                    #{post.tag}
                  </span>
                )}
                <h3 className="post-title font-display">{post.title}</h3>
                {post.editedAt && <span className="edited-mark">{t('feedback.edited')}</span>}
              </div>
              {post.description && (
                <p className="post-desc">
                  <Markdown text={post.description} />
                </p>
              )}
              <div className="post-meta">
                <span>{authorLabel(post)}</span>
                <span>·</span>
                <span>{relativeTime(post.createdAt, locale)}</span>
                <span>·</span>
                <span>
                  {post.commentCount} {t('feedback.comments')}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selectedId && (
        <PostDetailModal
          postId={selectedId}
          adminMode={adminMode}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            void reload();
          }}
        />
      )}
    </main>
  );
}

function SubmitForm({ onSubmitted, onCancel }: { onSubmitted: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim()) {
      setError(t('feedback.titlePlaceholder'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createFeedbackPost(title.trim(), description.trim());
      setTitle('');
      setDescription('');
      onSubmitted();
    } catch {
      setError(t('feedback.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="feedback-submit-form">
      <label className="field-label">{t('feedback.titleLabel')}</label>
      <input
        className="input input-bordered input-sm"
        placeholder={t('feedback.titlePlaceholder')}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="field-label">{t('feedback.descriptionLabel')}</label>
      <textarea
        className="textarea textarea-bordered textarea-sm"
        placeholder={t('feedback.descriptionPlaceholder')}
        value={description}
        maxLength={2000}
        rows={3}
        onChange={(e) => setDescription(e.target.value)}
      />
      <p className="feedback-md-hint">{t('feedback.markdownHint')}</p>
      <p className="feedback-identity-hint">
        {isLoggedIn() ? t('feedback.commentingAs') : t('feedback.anonymousNotice')}
      </p>
      {error && <p className="feedback-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="secondary-action" onClick={onCancel} disabled={submitting}>
          {t('feedback.cancel')}
        </button>
        <button type="button" className="primary-action" onClick={submit} disabled={submitting}>
          {submitting ? t('feedback.submitting') : t('feedback.submitAction')}
        </button>
      </div>
    </section>
  );
}

function TagManagePanel({ tags, onChanged }: { tags: FeedbackTag[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    try {
      await adminCreateFeedbackTag(name.trim(), color.trim());
      setName('');
      setColor('');
      onChanged();
    } catch {
      setError(t('feedback.tagCreateError'));
    }
  };

  const remove = async (id: string) => {
    try {
      await adminDeleteFeedbackTag(id);
      onChanged();
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="tag-manage-panel">
      <h4 className="moderation-title">{t('feedback.tagManage')}</h4>
      <div className="tag-create-row">
        <input
          className="input input-bordered input-xs"
          placeholder={t('feedback.tagNamePlaceholder')}
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input input-bordered input-xs"
          placeholder={t('feedback.tagColorPlaceholder')}
          value={color}
          maxLength={20}
          onChange={(e) => setColor(e.target.value)}
        />
        <button type="button" className="primary-action" onClick={create}>
          {t('feedback.tagCreate')}
        </button>
      </div>
      {error && <p className="feedback-error">{error}</p>}
      <ul className="tag-list">
        {tags.map((tg) => (
          <li key={tg.id} className="tag-list-item">
            <span className="post-tag">#{tg.name}</span>
            {tg.color && <span className="tag-color-chip" style={{ background: tg.color }} />}
            <button type="button" className="danger-action" onClick={() => void remove(tg.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PostDetailModal({
  postId,
  adminMode,
  onClose,
  onChanged,
}: {
  postId: string;
  adminMode: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const locale = useLocale();
  const [post, setPost] = useState<FeedbackPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [isOfficial, setIsOfficial] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [voters, setVoters] = useState<FeedbackVoter[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getFeedbackPost(postId);
      setPost(data);
      setTagInput(data.tag);
    } catch {
      setError(t('feedback.loadError'));
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isLoggedIn()) {
      getProfile()
        .then((p) => setCurrentUserId(p.id))
        .catch(() => setCurrentUserId(null));
    }
  }, []);

  const handleVote = async () => {
    if (!post) return;
    const prev = post;
    setPost({ ...post, hasVoted: !post.hasVoted, voteCount: post.voteCount + (post.hasVoted ? -1 : 1) });
    try {
      await toggleFeedbackVote(postId);
      onChanged();
    } catch {
      setPost(prev);
    }
  };

  const handleComment = async () => {
    if (!comment.trim()) return;
    setCommenting(true);
    try {
      await addFeedbackComment(postId, comment.trim(), isOfficial);
      setComment('');
      setIsOfficial(false);
      await load();
      onChanged();
    } catch {
      /* keep input for retry */
    } finally {
      setCommenting(false);
    }
  };

  const handleCommentVote = async (commentId: string) => {
    if (!post) return;
    // 樂觀更新
    setPost({
      ...post,
      comments: (post.comments ?? []).map((c) =>
        c.id === commentId ? { ...c, hasVoted: !c.hasVoted, voteCount: c.voteCount + (c.hasVoted ? -1 : 1) } : c,
      ),
    });
    try {
      await toggleFeedbackCommentVote(commentId);
    } catch {
      await load();
    }
  };

  const handleStatus = async (status: FeedbackStatus) => {
    try {
      await adminUpdatePostStatus(postId, status);
      await load();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  const handleTag = async () => {
    try {
      await adminUpdatePostTag(postId, tagInput.trim());
      await load();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('feedback.deleteConfirm'))) return;
    try {
      await adminDeleteFeedbackPost(postId);
      onClose();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  const handleEditPost = async () => {
    if (!editTitle.trim()) return;
    try {
      await editFeedbackPost(postId, editTitle.trim(), editDesc.trim());
      setEditingPost(false);
      await load();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  const startEditPost = () => {
    if (!post) return;
    setEditTitle(post.title);
    setEditDesc(post.description);
    setEditingPost(true);
  };

  const handleEditComment = async (commentId: string) => {
    if (!editCommentText.trim()) return;
    try {
      await editFeedbackComment(commentId, editCommentText.trim());
      setEditingCommentId(null);
      setEditCommentText('');
      await load();
    } catch {
      /* ignore */
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm(t('feedback.deleteCommentConfirm'))) return;
    try {
      await deleteFeedbackComment(commentId);
      await load();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  const loadVoters = async () => {
    if (voters) {
      setVoters(null);
      return;
    }
    try {
      const v = await listFeedbackVoters(postId);
      setVoters(v);
    } catch {
      /* ignore */
    }
  };

  const isPostAuthor =
    post &&
    ((post.authorUserId && post.authorUserId === currentUserId) ||
      (!isLoggedIn() && post.anonymousId && post.anonymousId === getAnonymousId()));

  const comments = post?.comments ?? [];

  return (
    <div className="feedback-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('feedback.detailBack')}>
            ✕
          </button>
        </header>
        {loading && <p className="feedback-empty">{t('feedback.loading')}</p>}
        {error && <p className="feedback-error">{error}</p>}
        {post && (
          <div className="modal-body">
            {editingPost ? (
              <section className="edit-post-form">
                <label className="field-label">{t('feedback.titleLabel')}</label>
                <input
                  className="input input-bordered input-sm"
                  value={editTitle}
                  maxLength={120}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
                <label className="field-label">{t('feedback.descriptionLabel')}</label>
                <textarea
                  className="textarea textarea-bordered textarea-sm"
                  value={editDesc}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
                <div className="form-actions">
                  <button type="button" className="secondary-action" onClick={() => setEditingPost(false)}>
                    {t('feedback.cancel')}
                  </button>
                  <button type="button" className="primary-action" onClick={handleEditPost}>
                    {t('feedback.save')}
                  </button>
                </div>
              </section>
            ) : (
              <div className="post-head">
                <div className={statusBadgeClass(post.status)}>{t(statusKey(post.status))}</div>
                {post.tag && <span className="post-tag">#{post.tag}</span>}
                <h2 className="font-display text-2xl text-bone">{post.title}</h2>
                {post.editedAt && <span className="edited-mark">{t('feedback.edited')}</span>}
                {isPostAuthor && (
                  <button type="button" className="edit-btn" onClick={startEditPost}>
                    {t('feedback.edit')}
                  </button>
                )}
              </div>
            )}
            {!editingPost && post.description && (
              <p className="post-desc-full">
                <Markdown text={post.description} />
              </p>
            )}
            <div className="post-meta">
              <span>
                {t('feedback.postedBy')}: {authorLabel(post)}
              </span>
              <span>·</span>
              <span>{relativeTime(post.createdAt, locale)}</span>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className={'vote-button' + (post.hasVoted ? ' voted' : '')}
                onClick={handleVote}
                aria-pressed={post.hasVoted}
              >
                <span>{post.hasVoted ? '▲' : '△'}</span>
                <span className="font-mono">{post.voteCount}</span>
                <span>{t(post.hasVoted ? 'feedback.voted' : 'feedback.vote')}</span>
              </button>
              <button type="button" className="voters-toggle" onClick={loadVoters}>
                {t('feedback.voters')} ({post.voteCount})
              </button>
            </div>

            {voters && (
              <section className="voters-list">
                {voters.length === 0 && <p className="feedback-empty">{t('feedback.noVoters')}</p>}
                {voters.map((v, i) => (
                  <span key={i} className="voter-chip">
                    {v.nickname || t('feedback.anonymous')}
                  </span>
                ))}
              </section>
            )}

            {adminMode && (
              <section className="moderation-panel">
                <h4 className="moderation-title">{t('feedback.moderation')}</h4>
                <div className="moderation-row">
                  <label className="field-label">{t('feedback.statusLabel')}</label>
                  <select
                    className="select select-bordered select-xs"
                    value={post.status}
                    onChange={(e) => void handleStatus(e.target.value as FeedbackStatus)}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {t(statusKey(s))}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="moderation-row">
                  <label className="field-label">{t('feedback.tagLabel')}</label>
                  <input
                    className="input input-bordered input-xs"
                    placeholder={t('feedback.tagPlaceholder')}
                    value={tagInput}
                    maxLength={30}
                    onChange={(e) => setTagInput(e.target.value)}
                  />
                  <button type="button" className="secondary-action" onClick={handleTag}>
                    {t('feedback.save')}
                  </button>
                </div>
                <button type="button" className="danger-action" onClick={handleDelete}>
                  {t('feedback.delete')}
                </button>
              </section>
            )}

            <section className="comments-section">
              <h4 className="comments-title">
                {t('feedback.comments')} ({post.commentCount})
              </h4>
              {comments.length === 0 && <p className="feedback-empty">{t('feedback.noComments')}</p>}
              <ul className="comment-list">
                {comments.map((c) => (
                  <li key={c.id} className={'comment-item' + (c.isOfficial ? ' official' : '')}>
                    <div className="comment-head">
                      {c.isOfficial && <span className="official-badge">{t('feedback.officialResponse')}</span>}
                      <span className="comment-author">{commentAuthorLabel(c)}</span>
                      <span className="comment-time">{relativeTime(c.createdAt, locale)}</span>
                      {c.editedAt && <span className="edited-mark">{t('feedback.edited')}</span>}
                    </div>
                    {editingCommentId === c.id ? (
                      <div className="comment-edit-form">
                        <textarea
                          className="textarea textarea-bordered textarea-xs"
                          value={editCommentText}
                          maxLength={1000}
                          rows={2}
                          onChange={(e) => setEditCommentText(e.target.value)}
                        />
                        <div className="form-actions">
                          <button type="button" className="secondary-action" onClick={() => setEditingCommentId(null)}>
                            {t('feedback.cancel')}
                          </button>
                          <button type="button" className="primary-action" onClick={() => void handleEditComment(c.id)}>
                            {t('feedback.save')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="comment-content">
                          <Markdown text={c.content} />
                        </p>
                        <div className="comment-actions">
                          <button
                            type="button"
                            className={'comment-vote-btn' + (c.hasVoted ? ' voted' : '')}
                            onClick={() => void handleCommentVote(c.id)}
                            aria-pressed={c.hasVoted}
                          >
                            {c.hasVoted ? '▲' : '△'} {c.voteCount}
                          </button>
                          {((c.authorUserId && c.authorUserId === currentUserId) ||
                            (!isLoggedIn() && c.anonymousId && c.anonymousId === getAnonymousId())) && (
                            <>
                              <button
                                type="button"
                                className="edit-btn"
                                onClick={() => {
                                  setEditingCommentId(c.id);
                                  setEditCommentText(c.content);
                                }}
                              >
                                {t('feedback.edit')}
                              </button>
                              <button
                                type="button"
                                className="danger-action"
                                onClick={() => void handleDeleteComment(c.id)}
                              >
                                {t('feedback.delete')}
                              </button>
                            </>
                          )}
                          {adminMode && !c.isOfficial && (
                            <button
                              type="button"
                              className="secondary-action"
                              onClick={() => void handleDeleteComment(c.id)}
                            >
                              {t('feedback.delete')}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <div className="comment-form">
                <textarea
                  className="textarea textarea-bordered textarea-sm"
                  placeholder={t('feedback.commentPlaceholder')}
                  value={comment}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => setComment(e.target.value)}
                />
                <p className="feedback-md-hint">{t('feedback.markdownHint')}</p>
                <p className="feedback-identity-hint">
                  {isLoggedIn() ? t('feedback.commentingAs') : t('feedback.anonymousNotice')}
                </p>
                {adminMode && (
                  <label className="official-toggle">
                    <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} />
                    {t('feedback.officialResponse')}
                  </label>
                )}
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleComment}
                  disabled={commenting || !comment.trim()}
                >
                  {commenting ? t('feedback.submitting') : t('feedback.commentSubmit')}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
