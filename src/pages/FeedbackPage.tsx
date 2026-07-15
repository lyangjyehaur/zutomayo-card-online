import { useCallback, useEffect, useRef, useState } from 'react';
import { SmilePlus, X } from 'lucide-react';
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
import {
  Alert,
  AppHeader,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FilterToolbar,
  IconButton,
  Input,
  LoadingState,
  SegmentedControl,
  Select,
  Sheet,
  StatsGrid,
  Tag,
  TagButton,
  Textarea,
  type BadgeTone,
} from '../ui';

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
    <main className="feedback-page relative flex min-h-screen flex-col gap-4 overflow-y-auto bg-surface-canvas px-4 pb-10 pt-20 md:px-6 md:pt-24">
      <AppHeader title={t('feedback.title')} subtitle={t('feedback.subtitle')} backTo="/" />

      {!isLoggedIn() && (
        <p className="feedback-anon-notice text-caption text-content-primary/40">{t('feedback.anonymousNotice')}</p>
      )}

      {stats && (
        <StatsGrid className="feedback-stats grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <div className="stat-cell flex min-h-14 items-center justify-between gap-2 rounded-sm border border-border-soft bg-surface-panel/55 px-3 py-2">
            <span className="stat-label text-caption leading-tight text-content-primary/55">
              {t('feedback.statsTotal')}
            </span>
            <span className="stat-num shrink-0 font-mono text-lg font-bold text-accent-primary">
              {Number(stats.total) || 0}
            </span>
          </div>
          <div className="stat-cell flex min-h-14 items-center justify-between gap-2 rounded-sm border border-border-soft bg-surface-panel/55 px-3 py-2">
            <span className="stat-label text-caption leading-tight text-content-primary/55">
              {t('feedback.statsVotes')}
            </span>
            <span className="stat-num shrink-0 font-mono text-lg font-bold text-accent-primary">
              {Number(stats.total_votes) || 0}
            </span>
          </div>
          {STATUS_OPTIONS.map((s) => (
            <div
              key={s}
              className="stat-cell flex min-h-14 items-center justify-between gap-2 rounded-sm border border-border-soft bg-surface-panel/55 px-3 py-2"
            >
              <span className="stat-label text-caption leading-tight text-content-primary/55">{t(statusKey(s))}</span>
              <span className="stat-num shrink-0 font-mono text-lg font-bold text-content-primary">
                {Number(stats[s as keyof FeedbackStats]) || 0}
              </span>
            </div>
          ))}
        </StatsGrid>
      )}

      <FilterToolbar
        as="section"
        className="feedback-toolbar rounded-sm border border-border-soft bg-surface-panel/55 p-3"
        contentClassName="grid w-full grid-cols-1 gap-3 md:flex md:flex-wrap md:items-center"
        actionsClassName="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:w-auto"
        primary={
          <>
            <SegmentedControl
              className="sort-tabs w-full overflow-x-auto md:w-auto"
              options={SORT_OPTIONS.map((s) => ({ value: s, label: t(sortKey(s)) }))}
              value={sort}
              onChange={setSort}
              ariaLabel={t('feedback.sortTop')}
              size="sm"
              optionClassName="!min-h-11 px-3"
            />
            <Select
              className="status-filter min-h-11 w-full text-body-sm md:w-44"
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
                className="status-filter min-h-11 w-full text-body-sm md:w-44"
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
              className="search-input min-h-11 w-full md:w-64"
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
              className="feedback-submit-toggle min-h-11 w-full md:w-auto"
              aria-expanded={showSubmit}
              onClick={() => setShowSubmit((v) => !v)}
            >
              {t('feedback.submitNew')}
            </Button>
            {adminMode && (
              <Button
                type="button"
                className="feedback-tag-toggle min-h-11 w-full md:w-auto"
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
          {t('feedback.filteringTag')}: <Tag>#{tagFilter}</Tag>
          <IconButton
            size="sm"
            label={t('common.close')}
            icon={<X className="size-3" aria-hidden="true" />}
            onClick={() => setTagFilter('')}
          />
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

      {loading && <LoadingState className="feedback-empty" label={t('feedback.loading')} />}
      {error && (
        <Alert className="feedback-error" tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {!loading && !error && posts.length === 0 && (
        <EmptyState className="feedback-empty" description={t('feedback.empty')} />
      )}

      <ul className="feedback-list grid gap-3">
        {posts.map((post) => (
          <li key={post.id}>
            <article className="feedback-card grid gap-3 rounded-sm border border-border-soft bg-surface-panel/70 p-3 shadow-raised sm:grid-cols-[4rem_minmax(0,1fr)] sm:p-4">
              <button
                type="button"
                className={
                  'vote-column flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm border px-3 py-2 text-accent-primary transition hover:border-accent-primary/60 hover:bg-accent-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-16 sm:flex-col ' +
                  (post.hasVoted
                    ? 'voted border-accent-primary bg-accent-primary/15 '
                    : 'border-border-soft bg-surface-base/75 ') +
                  (NO_VOTE_STATUSES.includes(post.status) ? 'disabled ' : '')
                }
                onClick={() => {
                  void handleVote(post.id, post.status);
                }}
                disabled={NO_VOTE_STATUSES.includes(post.status)}
                aria-pressed={post.hasVoted}
                aria-label={`${post.hasVoted ? t('feedback.voted') : t('feedback.vote')}: ${post.title}`}
              >
                <span className="vote-arrow">{post.hasVoted ? '▲' : '△'}</span>
                <span className="vote-count font-mono text-lg font-bold leading-none">{post.voteCount}</span>
              </button>
              <div className="post-body min-w-0">
                <div className="post-title-row flex flex-wrap items-center gap-2">
                  <Badge tone={statusBadgeTone(post.status)}>{t(statusKey(post.status))}</Badge>
                  {post.tag && (
                    <TagButton
                      className="post-tag !min-h-11 !min-w-11"
                      onClick={() => {
                        setTagFilter(post.tag);
                      }}
                    >
                      #{post.tag}
                    </TagButton>
                  )}
                  <h3 className="post-title min-w-0 flex-1 font-display text-body-lg font-bold leading-snug text-content-primary">
                    {post.title}
                  </h3>
                  {post.editedAt && (
                    <span className="edited-mark font-mono text-caption uppercase text-content-primary/40">
                      {t('feedback.edited')}
                    </span>
                  )}
                </div>
                {post.description && (
                  <p className="post-desc mt-2 text-body-sm leading-relaxed text-content-muted">
                    <Markdown text={post.description} />
                  </p>
                )}
                <div className="post-footer mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="post-meta flex flex-wrap items-center gap-1 text-caption text-content-primary/45">
                    <span>{authorLabel(post)}</span>
                    <span>·</span>
                    <span>{relativeTime(post.createdAt, locale)}</span>
                    <span>·</span>
                    <span>
                      {post.commentCount} {t('feedback.comments')}
                    </span>
                  </div>
                  <Button
                    type="button"
                    className="post-detail-button min-h-11 w-full justify-center px-3 sm:w-auto"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedId(post.id)}
                    aria-label={`${t('feedback.openDetail')}: ${post.title}`}
                  >
                    {t('feedback.openDetail')}
                  </Button>
                </div>
              </div>
            </article>
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
      <label className="field-label" htmlFor="feedback-title">
        {t('feedback.titleLabel')}
      </label>
      <Input
        id="feedback-title"
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
      <label className="field-label" htmlFor="feedback-description">
        {t('feedback.descriptionLabel')}
      </label>
      <Textarea
        id="feedback-description"
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
            <Tag swatch={tg.color}>#{tg.name}</Tag>
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
          <IconButton
            className="modal-close"
            label={t('feedback.detailBack')}
            icon={<X className="size-4" aria-hidden="true" />}
            onClick={onClose}
          />
        </header>
        {loading && <LoadingState className="feedback-empty" label={t('feedback.loading')} />}
        {error && (
          <Alert className="feedback-error" tone="danger">
            {error}
          </Alert>
        )}
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
                {post.tag && <Tag>#{post.tag}</Tag>}
                <h2 className="font-display text-2xl text-content-primary">{post.title}</h2>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="original-post-link"
                  onClick={() => onNavigate(post.originalPostId!)}
                >
                  {t('feedback.originalPost')}: {post.originalPostTitle || post.originalPostId}
                </Button>
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
              <Button
                type="button"
                variant={post.hasVoted ? 'primary' : 'secondary'}
                size="sm"
                className={'vote-button' + (post.hasVoted ? ' voted' : '') + (!canVote ? ' disabled' : '')}
                onClick={handleVote}
                disabled={!canVote}
                aria-pressed={post.hasVoted}
              >
                <span>{post.hasVoted ? '▲' : '△'}</span>
                <span className="font-mono">{post.voteCount}</span>
                <span>{t(post.hasVoted ? 'feedback.voted' : 'feedback.vote')}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="voters-toggle" onClick={loadVoters}>
                {t('feedback.voters')} ({post.voteCount})
              </Button>
            </div>

            {voters && (
              <section className="voters-list">
                {voters.length === 0 && <p className="feedback-empty">{t('feedback.noVoters')}</p>}
                {voters.map((v, i) => (
                  <Tag key={i}>{v.nickname || t('feedback.anonymous')}</Tag>
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={'comment-vote-button' + (c.hasVoted ? ' voted' : '')}
                            onClick={() => void handleCommentVote(c.id)}
                            aria-pressed={c.hasVoted}
                          >
                            {c.hasVoted ? '▲' : '△'} {c.voteCount}
                          </Button>
                          {/* Emoji 反應 */}
                          <div className="reaction-group">
                            {c.reactions.map((r: FeedbackReaction) => (
                              <TagButton
                                key={r.emoji}
                                type="button"
                                className={'reaction-chip !min-h-11 !min-w-11' + (r.includesMe ? ' includes-me' : '')}
                                onClick={() => void handleReaction(c.id, r.emoji)}
                                aria-pressed={r.includesMe}
                              >
                                {r.emoji} <span className="font-mono">{r.count}</span>
                              </TagButton>
                            ))}
                            <IconButton
                              className="reaction-add-button"
                              label={t('feedback.addReaction')}
                              icon={<SmilePlus className="size-3.5" aria-hidden="true" />}
                              aria-expanded={openReactionPickerCommentId === c.id}
                              onClick={() =>
                                setOpenReactionPickerCommentId((current) => (current === c.id ? null : c.id))
                              }
                              title={t('feedback.addReaction')}
                            />
                            <div
                              className={
                                'reaction-picker' +
                                (openReactionPickerCommentId === c.id ? ' reaction-picker-open' : '')
                              }
                            >
                              {(['👍', '❤️', '🎉', '😄', '😕', '👎'] as const).map((emoji) => (
                                <IconButton
                                  key={emoji}
                                  className="reaction-picker-button"
                                  label={`${t('feedback.addReaction')} ${emoji}`}
                                  icon={<span aria-hidden="true">{emoji}</span>}
                                  onClick={() => void handleReaction(c.id, emoji)}
                                />
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
                  <Checkbox
                    className="official-toggle"
                    checked={isOfficial}
                    onChange={(e) => setIsOfficial(e.target.checked)}
                  >
                    {t('feedback.officialResponse')}
                  </Checkbox>
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
