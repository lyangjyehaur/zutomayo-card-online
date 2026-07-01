import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, useLocale, type TranslationKey } from '../i18n';
import { isLoggedIn } from '../api/client';
import {
  addFeedbackComment,
  adminDeleteFeedbackPost,
  adminUpdatePostStatus,
  adminUpdatePostTag,
  createFeedbackPost,
  getFeedbackPost,
  getFeedbackStats,
  isAdminMode,
  listFeedbackPosts,
  toggleFeedbackVote,
  type FeedbackPost,
  type FeedbackSort,
  type FeedbackStatus,
  type FeedbackStats,
} from '../api/feedbackClient';

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

function commentAuthorLabel(authorNickname: string | null): string {
  if (authorNickname) return authorNickname;
  return t('feedback.anonymous');
}

export function FeedbackPage() {
  const navigate = useNavigate();
  const locale = useLocale();
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<FeedbackSort>('top');
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [search, setSearch] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const adminMode = isAdminMode();

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, st] = await Promise.all([
        listFeedbackPosts({ sort, status: statusFilter, q: search }),
        getFeedbackStats(),
      ]);
      setPosts(list);
      setStats(st);
    } catch {
      setError(t('feedback.loadError'));
    } finally {
      setLoading(false);
    }
  }, [sort, statusFilter, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleVote = async (postId: string) => {
    const prev = posts;
    // 樂觀更新：切換 hasVoted 並調整 voteCount
    setPosts((cur) =>
      cur.map((p) =>
        p.id === postId ? { ...p, hasVoted: !p.hasVoted, voteCount: p.voteCount + (p.hasVoted ? -1 : 1) } : p,
      ),
    );
    try {
      await toggleFeedbackVote(postId);
    } catch {
      setPosts(prev); // 還原
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
        <input
          className="search-input input input-bordered input-sm"
          placeholder={t('feedback.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="primary-action" onClick={() => setShowSubmit((v) => !v)}>
          {t('feedback.submitNew')}
        </button>
      </section>

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
                {post.tag && <span className="post-tag">#{post.tag}</span>}
                <h3 className="post-title font-display">{post.title}</h3>
              </div>
              {post.description && <p className="post-desc">{post.description}</p>}
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
  const [tagInput, setTagInput] = useState('');

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
      await addFeedbackComment(postId, comment.trim());
      setComment('');
      await load();
      onChanged();
    } catch {
      // 留言失敗：保留輸入內容讓使用者重試
    } finally {
      setCommenting(false);
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
            <div className="post-head">
              <div className={statusBadgeClass(post.status)}>{t(statusKey(post.status))}</div>
              {post.tag && <span className="post-tag">#{post.tag}</span>}
              <h2 className="font-display text-2xl text-bone">{post.title}</h2>
            </div>
            {post.description && <p className="post-desc-full">{post.description}</p>}
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
            </div>

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
              {(!post.comments || post.comments.length === 0) && (
                <p className="feedback-empty">{t('feedback.noComments')}</p>
              )}
              <ul className="comment-list">
                {(post.comments ?? []).map((c) => (
                  <li key={c.id} className="comment-item">
                    <div className="comment-head">
                      <span className="comment-author">{commentAuthorLabel(c.authorNickname)}</span>
                      <span className="comment-time">{relativeTime(c.createdAt, locale)}</span>
                    </div>
                    <p className="comment-content">{c.content}</p>
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
                <p className="feedback-identity-hint">
                  {isLoggedIn() ? t('feedback.commentingAs') : t('feedback.anonymousNotice')}
                </p>
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
