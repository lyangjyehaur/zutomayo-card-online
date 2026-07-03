import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SmilePlus } from 'lucide-react';
import { t, useLocale, type TranslationKey } from '../i18n';
import { getProfile, isLoggedIn } from '../api/client';
import {
  addFeedbackComment,
  adminCreateFeedbackTag,
  adminDeleteFeedbackPost,
  adminDeleteFeedbackTag,
  adminMarkAsDuplicate,
  adminUpdatePostStatus,
  adminUpdatePostTag,
  createFeedbackPost,
  deleteFeedbackComment,
  editFeedbackComment,
  editFeedbackPost,
  findSimilarPosts,
  getFeedbackPost,
  getFeedbackStats,
  isAdminMode,
  listFeedbackPosts,
  listFeedbackTags,
  listFeedbackVoters,
  toggleFeedbackCommentReaction,
  toggleFeedbackCommentVote,
  toggleFeedbackVote,
  uploadFeedbackImage,
  type FeedbackComment,
  type FeedbackPost,
  type FeedbackReaction,
  type FeedbackSort,
  type FeedbackStatus,
  type FeedbackStats,
  type FeedbackTag,
  type FeedbackVoter,
  type SimilarPost,
} from '../api/feedbackClient';
import { getAnonymousId } from '../api/feedbackClient';
import { Badge, Button, Input, ResponsiveToolbar, Select, Sheet, Textarea, type BadgeTone } from '../components/ui';

const STATUS_OPTIONS: FeedbackStatus[] = ['open', 'planned', 'started', 'completed', 'declined', 'duplicate'];
const SORT_OPTIONS: FeedbackSort[] = ['top', 'trending', 'newest', 'recent', 'most-discussed'];
const NO_VOTE_STATUSES: FeedbackStatus[] = ['completed', 'declined', 'duplicate'];
const SORT_KEYS: Record<FeedbackSort, TranslationKey> = {
  top: 'feedback.sortTop',
  trending: 'feedback.sortTrending',
  newest: 'feedback.sortNewest',
  recent: 'feedback.sortRecent',
  'most-discussed': 'feedback.sortMostDiscussed',
};

function statusKey(status: FeedbackStatus): TranslationKey {
  return ('feedback.status' + status[0].toUpperCase() + status.slice(1)) as TranslationKey;
}
function sortKey(sort: FeedbackSort): TranslationKey {
  return SORT_KEYS[sort];
}

function statusBadgeTone(status: FeedbackStatus): BadgeTone {
  switch (status) {
    case 'open':
      return 'gold';
    case 'planned':
      return 'neutral';
    case 'started':
      return 'gold';
    case 'completed':
      return 'jade';
    case 'declined':
      return 'vermilion';
    case 'duplicate':
      return 'neutral';
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

// ===== 安全 Markdown 渲染器（擴展版）=====
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
  // 圍欄程式碼 ```code```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // 標題
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // 圖片 ![alt](feedback-image:<bkey>) → 替換為實際 URL
  html = html.replace(
    /!\[([^\]]*)\]\(feedback-image:([^)]+)\)/g,
    '<img src="/api/feedback/images/$2" alt="$1" class="feedback-image" />',
  );
  // 一般圖片 ![alt](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // 行內程式碼
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 刪除線 ~~text~~
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 粗體
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜體
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // 表格（簡易）
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter((c) => c.trim());
    if (cells.every((c) => /^[\s-:]+$/.test(c))) return ''; // 分隔行
    return '<tr>' + cells.map((c) => '<td>' + c.trim() + '</td>').join('') + '</tr>';
  });
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table class="md-table">$&</table>');
  // 列表
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul><br\/><ul>/g, '');
  // 換行
  html = html.replace(/\n/g, '<br/>');
  return html;
}

function Markdown({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

function useFeedbackPanelSheet() {
  const [useSheet, setUseSheet] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setUseSheet(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return useSheet;
}

// ===== 圖片上傳 hook =====
function useImageUpload(onInserted: (markdown: string) => void) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const upload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError(t('feedback.imageError'));
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setError(t('feedback.imageTooLarge'));
        return;
      }
      setUploading(true);
      setError('');
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await uploadFeedbackImage(dataUrl, { fileName: file.name });
        onInserted(`![${file.name}](feedback-image:${result.bkey})`);
      } catch {
        setError(t('feedback.imageError'));
      } finally {
        setUploading(false);
      }
    },
    [onInserted],
  );

  return { uploading, error, upload, setError };
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
  const usePanelSheet = useFeedbackPanelSheet();

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

  const handleVote = async (postId: string, status: FeedbackStatus) => {
    if (NO_VOTE_STATUSES.includes(status)) return;
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
              <span className="stat-num font-mono">{Number(stats[s as keyof FeedbackStats]) || 0}</span>
              <span className="stat-label">{t(statusKey(s))}</span>
            </div>
          ))}
        </section>
      )}

      <ResponsiveToolbar
        as="section"
        className="feedback-toolbar"
        contentClassName="contents"
        actionsClassName="contents"
        primary={
          <>
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
            <Select
              className="status-filter text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FeedbackStatus | '')}
            >
              <option value="">{t('feedback.filterAll')}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(statusKey(s))}
                </option>
              ))}
            </Select>
            {tags.length > 0 && (
              <Select
                className="status-filter text-xs"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">{t('feedback.filterAllTags')}</option>
                {tags.map((tg) => (
                  <option key={tg.id} value={tg.name}>
                    #{tg.name}
                  </option>
                ))}
              </Select>
            )}
            <Input
              className="search-input"
              placeholder={t('feedback.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </>
        }
        actions={
          <>
            <Button
              type="button"
              className="feedback-submit-toggle"
              aria-expanded={showSubmit}
              onClick={() => setShowSubmit((v) => !v)}
            >
              {t('feedback.submitNew')}
            </Button>
            {adminMode && (
              <Button
                type="button"
                className="feedback-tag-toggle"
                variant="secondary"
                aria-expanded={showTagPanel}
                onClick={() => setShowTagPanel((v) => !v)}
              >
                {t('feedback.tagManage')}
              </Button>
            )}
          </>
        }
      />

      {tagFilter && (
        <p className="feedback-tag-active">
          {t('feedback.filteringTag')}: <span className="post-tag">#{tagFilter}</span>
          <button type="button" onClick={() => setTagFilter('')}>
            ✕
          </button>
        </p>
      )}

      {showTagPanel && adminMode && !usePanelSheet && <TagManagePanel tags={tags} onChanged={() => void reload()} />}
      <Sheet
        open={showTagPanel && adminMode && usePanelSheet}
        onOpenChange={(open) => setShowTagPanel(open)}
        title={t('feedback.tagManage')}
        closeLabel={t('common.close')}
        className="feedback-panel-sheet"
      >
        <TagManagePanel tags={tags} onChanged={() => void reload()} />
      </Sheet>

      {showSubmit && !usePanelSheet && (
        <SubmitForm
          onSubmitted={() => {
            setShowSubmit(false);
            void reload();
          }}
          onCancel={() => setShowSubmit(false)}
        />
      )}
      <Sheet
        open={showSubmit && usePanelSheet}
        onOpenChange={(open) => setShowSubmit(open)}
        title={t('feedback.submitNew')}
        closeLabel={t('common.close')}
        className="feedback-panel-sheet"
      >
        <SubmitForm
          onSubmitted={() => {
            setShowSubmit(false);
            void reload();
          }}
          onCancel={() => setShowSubmit(false)}
        />
      </Sheet>

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
              className={
                'vote-column' +
                (post.hasVoted ? ' voted' : '') +
                (NO_VOTE_STATUSES.includes(post.status) ? ' disabled' : '')
              }
              onClick={(e) => {
                e.stopPropagation();
                void handleVote(post.id, post.status);
              }}
              disabled={NO_VOTE_STATUSES.includes(post.status)}
              aria-pressed={post.hasVoted}
            >
              <span className="vote-arrow">{post.hasVoted ? '▲' : '△'}</span>
              <span className="vote-count font-mono">{post.voteCount}</span>
            </button>
            <div className="post-body">
              <div className="post-title-row">
                <Badge tone={statusBadgeTone(post.status)}>{t(statusKey(post.status))}</Badge>
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
          onNavigate={(id) => setSelectedId(id)}
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
  const [similar, setSimilar] = useState<SimilarPost[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // debounce 相似文章查詢
  useEffect(() => {
    if (title.trim().length < 2) {
      setSimilar([]);
      return;
    }
    setSimilarLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await findSimilarPosts(title.trim(), 5);
        setSimilar(results);
      } catch {
        setSimilar([]);
      } finally {
        setSimilarLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [title]);

  const insertText = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = description.slice(0, start) + text + description.slice(end);
    setDescription(newText);
    const newPos = start + text.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const { uploading: imageUploading, error: imageError, upload: uploadImage } = useImageUpload(insertText);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void uploadImage(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void uploadImage(file);
          return;
        }
      }
    }
  };

  const handleFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadImage(file);
    };
    input.click();
  };

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
      <Input
        placeholder={t('feedback.titlePlaceholder')}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      {/* 相似文章提示 */}
      {similarLoading && title.trim().length >= 2 && <p className="similar-loading">{t('feedback.loading')}</p>}
      {similar.length > 0 && (
        <div className="similar-posts-hint">
          <p className="similar-hint-text">{t('feedback.similarFound')}</p>
          <ul className="similar-list">
            {similar.map((sp) => (
              <li key={sp.id} className="similar-item">
                <Badge tone={statusBadgeTone(sp.status)}>{t(statusKey(sp.status))}</Badge>
                <span className="similar-title">{sp.title}</span>
                <span className="similar-votes font-mono">{sp.voteCount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {title.trim().length >= 2 && !similarLoading && similar.length === 0 && (
        <p className="similar-no-results">{t('feedback.noSimilar')}</p>
      )}
      <label className="field-label">{t('feedback.descriptionLabel')}</label>
      <Textarea
        ref={textareaRef}
        placeholder={t('feedback.descriptionPlaceholder')}
        value={description}
        maxLength={2000}
        rows={4}
        onChange={(e) => setDescription(e.target.value)}
        onDrop={handleDrop}
        onPaste={handlePaste}
      />
      <div className="upload-bar">
        <Button type="button" variant="secondary" size="sm" onClick={handleFileSelect} disabled={imageUploading}>
          {imageUploading ? t('feedback.submitting') : t('feedback.uploadImage')}
        </Button>
        <span className="upload-hint">
          {t('feedback.dragDrop')} · {t('feedback.pasteImage')}
        </span>
      </div>
      {imageError && <p className="feedback-error">{imageError}</p>}
      <p className="feedback-md-hint">{t('feedback.markdownHint')}</p>
      <p className="feedback-identity-hint">
        {isLoggedIn() ? t('feedback.commentingAs') : t('feedback.anonymousNotice')}
      </p>
      {error && <p className="feedback-error">{error}</p>}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t('feedback.cancel')}
        </Button>
        <Button type="button" onClick={submit} disabled={submitting}>
          {submitting ? t('feedback.submitting') : t('feedback.submitAction')}
        </Button>
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
        <Input
          placeholder={t('feedback.tagNamePlaceholder')}
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder={t('feedback.tagColorPlaceholder')}
          value={color}
          maxLength={20}
          onChange={(e) => setColor(e.target.value)}
        />
        <Button type="button" size="sm" onClick={create}>
          {t('feedback.tagCreate')}
        </Button>
      </div>
      {error && <p className="feedback-error">{error}</p>}
      <ul className="tag-list">
        {tags.map((tg) => (
          <li key={tg.id} className="tag-list-item">
            <span className="post-tag">#{tg.name}</span>
            {tg.color && <span className="tag-color-chip" style={{ background: tg.color }} />}
            <Button
              type="button"
              className="size-11 p-0 tracking-normal"
              variant="danger"
              size="sm"
              onClick={() => void remove(tg.id)}
              aria-label={t('feedback.delete')}
            >
              ✕
            </Button>
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
  onNavigate,
}: {
  postId: string;
  adminMode: boolean;
  onClose: () => void;
  onChanged: () => void;
  onNavigate: (id: string) => void;
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
  const [showDupPanel, setShowDupPanel] = useState(false);
  const [dupSearch, setDupSearch] = useState('');
  const [dupResults, setDupResults] = useState<SimilarPost[]>([]);
  const [openReactionPickerCommentId, setOpenReactionPickerCommentId] = useState<string | null>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (NO_VOTE_STATUSES.includes(post.status)) return;
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

  const handleReaction = async (commentId: string, emoji: string) => {
    if (!post) return;
    // 樂觀更新
    setPost({
      ...post,
      comments: (post.comments ?? []).map((c) => {
        if (c.id !== commentId) return c;
        const existing = c.reactions.find((r) => r.emoji === emoji);
        if (existing) {
          return {
            ...c,
            reactions: c.reactions.map((r) =>
              r.emoji === emoji
                ? {
                    ...r,
                    includesMe: !r.includesMe,
                    count: r.count + (r.includesMe ? -1 : 1),
                  }
                : r,
            ),
          };
        }
        return {
          ...c,
          reactions: [...c.reactions, { emoji, count: 1, includesMe: true }],
        };
      }),
    });
    try {
      await toggleFeedbackCommentReaction(commentId, emoji);
      setOpenReactionPickerCommentId(null);
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

  const handleMarkDuplicate = async (originalId: string) => {
    try {
      await adminMarkAsDuplicate(postId, originalId);
      setShowDupPanel(false);
      await load();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  // 搜尋原文章
  useEffect(() => {
    if (!showDupPanel || dupSearch.trim().length < 2) {
      setDupResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await findSimilarPosts(dupSearch.trim(), 10);
        setDupResults(results.filter((r) => r.id !== postId));
      } catch {
        setDupResults([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [showDupPanel, dupSearch, postId]);

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

  const insertCommentText = (text: string) => {
    const textarea = commentTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = comment.slice(0, start) + text + comment.slice(end);
    setComment(newText);
    const newPos = start + text.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const {
    uploading: commentImgUploading,
    error: commentImgError,
    upload: uploadCommentImage,
  } = useImageUpload(insertCommentText);

  const handleCommentDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void uploadCommentImage(file);
  };

  const handleCommentPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void uploadCommentImage(file);
          return;
        }
      }
    }
  };

  const handleCommentFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadCommentImage(file);
    };
    input.click();
  };

  const isPostAuthor =
    post &&
    ((post.authorUserId && post.authorUserId === currentUserId) ||
      (!isLoggedIn() && post.anonymousId && post.anonymousId === getAnonymousId()));

  const canVote = post && !NO_VOTE_STATUSES.includes(post.status);
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
                <Input value={editTitle} maxLength={120} onChange={(e) => setEditTitle(e.target.value)} />
                <label className="field-label">{t('feedback.descriptionLabel')}</label>
                <Textarea value={editDesc} maxLength={2000} rows={3} onChange={(e) => setEditDesc(e.target.value)} />
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setEditingPost(false)}>
                    {t('feedback.cancel')}
                  </Button>
                  <Button type="button" onClick={handleEditPost}>
                    {t('feedback.save')}
                  </Button>
                </div>
              </section>
            ) : (
              <div className="post-head">
                <Badge tone={statusBadgeTone(post.status)}>{t(statusKey(post.status))}</Badge>
                {post.tag && <span className="post-tag">#{post.tag}</span>}
                <h2 className="font-display text-2xl text-bone">{post.title}</h2>
                {post.editedAt && <span className="edited-mark">{t('feedback.edited')}</span>}
                {isPostAuthor && (
                  <Button type="button" size="sm" variant="ghost" onClick={startEditPost}>
                    {t('feedback.edit')}
                  </Button>
                )}
              </div>
            )}
            {/* Duplicate 提示 */}
            {post.status === 'duplicate' && post.originalPostId && (
              <div className="duplicate-notice">
                <p>{t('feedback.duplicateNotice')}</p>
                <button type="button" className="original-post-link" onClick={() => onNavigate(post.originalPostId!)}>
                  {t('feedback.originalPost')}: {post.originalPostTitle || post.originalPostId}
                </button>
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
                className={'vote-button' + (post.hasVoted ? ' voted' : '') + (!canVote ? ' disabled' : '')}
                onClick={handleVote}
                disabled={!canVote}
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
                  <Select
                    className="text-xs"
                    value={post.status}
                    onChange={(e) => void handleStatus(e.target.value as FeedbackStatus)}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {t(statusKey(s))}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="moderation-row">
                  <label className="field-label">{t('feedback.tagLabel')}</label>
                  <Input
                    placeholder={t('feedback.tagPlaceholder')}
                    value={tagInput}
                    maxLength={30}
                    onChange={(e) => setTagInput(e.target.value)}
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={handleTag}>
                    {t('feedback.save')}
                  </Button>
                </div>
                {/* Duplicate 標記 */}
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowDupPanel((v) => !v)}>
                  {t('feedback.markDuplicate')}
                </Button>
                {showDupPanel && (
                  <div className="dup-search-panel">
                    <Input
                      placeholder={t('feedback.searchPlaceholder')}
                      value={dupSearch}
                      onChange={(e) => setDupSearch(e.target.value)}
                    />
                    {dupResults.length > 0 && (
                      <ul className="dup-results">
                        {dupResults.map((dp) => (
                          <li key={dp.id} className="dup-result-item">
                            <Badge tone={statusBadgeTone(dp.status)}>{t(statusKey(dp.status))}</Badge>
                            <span className="dup-title">{dp.title}</span>
                            <span className="dup-votes font-mono">{dp.voteCount}</span>
                            <Button type="button" size="sm" onClick={() => void handleMarkDuplicate(dp.id)}>
                              ✓
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <Button type="button" size="sm" variant="danger" onClick={handleDelete}>
                  {t('feedback.delete')}
                </Button>
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
                      {c.isOfficial && <Badge tone="gold">{t('feedback.officialResponse')}</Badge>}
                      <span className="comment-author">{commentAuthorLabel(c)}</span>
                      <span className="comment-time">{relativeTime(c.createdAt, locale)}</span>
                      {c.editedAt && <span className="edited-mark">{t('feedback.edited')}</span>}
                    </div>
                    {editingCommentId === c.id ? (
                      <div className="comment-edit-form">
                        <Textarea
                          value={editCommentText}
                          maxLength={1000}
                          rows={2}
                          onChange={(e) => setEditCommentText(e.target.value)}
                        />
                        <div className="form-actions">
                          <Button type="button" variant="secondary" onClick={() => setEditingCommentId(null)}>
                            {t('feedback.cancel')}
                          </Button>
                          <Button type="button" onClick={() => void handleEditComment(c.id)}>
                            {t('feedback.save')}
                          </Button>
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
                            className={'comment-vote-button' + (c.hasVoted ? ' voted' : '')}
                            onClick={() => void handleCommentVote(c.id)}
                            aria-pressed={c.hasVoted}
                          >
                            {c.hasVoted ? '▲' : '△'} {c.voteCount}
                          </button>
                          {/* Emoji 反應 */}
                          <div className="reaction-group">
                            {c.reactions.map((r: FeedbackReaction) => (
                              <button
                                key={r.emoji}
                                type="button"
                                className={'reaction-chip' + (r.includesMe ? ' includes-me' : '')}
                                onClick={() => void handleReaction(c.id, r.emoji)}
                              >
                                {r.emoji} <span className="font-mono">{r.count}</span>
                              </button>
                            ))}
                            <button
                              type="button"
                              className="reaction-add-button"
                              aria-label={t('feedback.addReaction')}
                              aria-expanded={openReactionPickerCommentId === c.id}
                              onClick={() =>
                                setOpenReactionPickerCommentId((current) => (current === c.id ? null : c.id))
                              }
                              title={t('feedback.addReaction')}
                            >
                              <SmilePlus className="size-3.5" aria-hidden="true" />
                            </button>
                            <div
                              className={
                                'reaction-picker' +
                                (openReactionPickerCommentId === c.id ? ' reaction-picker-open' : '')
                              }
                            >
                              {(['👍', '❤️', '🎉', '😄', '😕', '👎'] as const).map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="reaction-picker-button"
                                  onClick={() => void handleReaction(c.id, emoji)}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                          {((c.authorUserId && c.authorUserId === currentUserId) ||
                            (!isLoggedIn() && c.anonymousId && c.anonymousId === getAnonymousId())) && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingCommentId(c.id);
                                  setEditCommentText(c.content);
                                }}
                              >
                                {t('feedback.edit')}
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => void handleDeleteComment(c.id)}
                              >
                                {t('feedback.delete')}
                              </Button>
                            </>
                          )}
                          {adminMode && !c.isOfficial && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleDeleteComment(c.id)}
                            >
                              {t('feedback.delete')}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <div className="comment-form">
                <Textarea
                  ref={commentTextareaRef}
                  placeholder={t('feedback.commentPlaceholder')}
                  value={comment}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => setComment(e.target.value)}
                  onDrop={handleCommentDrop}
                  onPaste={handleCommentPaste}
                />
                <div className="upload-bar">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleCommentFileSelect}
                    disabled={commentImgUploading}
                  >
                    {commentImgUploading ? t('feedback.submitting') : t('feedback.uploadImage')}
                  </Button>
                  <span className="upload-hint">
                    {t('feedback.dragDrop')} · {t('feedback.pasteImage')}
                  </span>
                </div>
                {commentImgError && <p className="feedback-error">{commentImgError}</p>}
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
                <Button type="button" onClick={handleComment} disabled={commenting || !comment.trim()}>
                  {commenting ? t('feedback.submitting') : t('feedback.commentSubmit')}
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
