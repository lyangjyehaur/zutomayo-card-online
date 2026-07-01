import { ApiError } from './client';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const ANON_ID_KEY = 'zutomayo_feedback_anon_id';

export type FeedbackStatus = 'open' | 'planned' | 'started' | 'completed' | 'declined' | 'duplicate';
export type FeedbackSort = 'top' | 'newest' | 'recent' | 'trending' | 'most-discussed';

export interface FeedbackPost {
  id: string;
  title: string;
  description: string;
  status: FeedbackStatus;
  tag: string;
  authorUserId: string | null;
  authorNickname: string | null;
  anonymousId: string | null;
  voteCount: number;
  commentCount: number;
  hasVoted: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  originalPostId: string | null;
  originalPostTitle: string | null;
  originalPostStatus: FeedbackStatus | null;
  comments?: FeedbackComment[];
}

export interface FeedbackReaction {
  emoji: string;
  count: number;
  includesMe: boolean;
}

export interface FeedbackComment {
  id: string;
  postId: string;
  content: string;
  authorUserId: string | null;
  authorNickname: string | null;
  anonymousId: string | null;
  isOfficial: boolean;
  voteCount: number;
  hasVoted: boolean;
  createdAt: string;
  editedAt: string | null;
  reactions: FeedbackReaction[];
}

export interface FeedbackVoter {
  userId: string | null;
  nickname: string | null;
  isAnonymous: boolean;
  createdAt: string;
}

export interface FeedbackTag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface FeedbackStats {
  open: string;
  planned: string;
  started: string;
  completed: string;
  declined: string;
  duplicate: string;
  total: string;
  total_votes: string;
}

// 匿名身份：從 localStorage 取得或產生固定 UUID（用於匿名投票/發文追蹤，避免重複投票）。
export function getAnonymousId(): string {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      // 產生符合後端正則 /^[a-zA-Z0-9_-]{8,64}$/ 的隨機 ID
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage 不可用時回退隨機 ID（無法跨頁持久，但仍允許單次操作）
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// 投票者身份查詢參數（登入用戶不需要，匿名用戶附帶 anonymousId）。
function voterQuery(): string {
  const token = localStorage.getItem('zutomayo_token');
  if (token) return '';
  return `?anonymousId=${encodeURIComponent(getAnonymousId())}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('zutomayo_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) throw new ApiError((data.error as string) || 'Request failed', res.status);
  return data as T;
}

// 匿名身份附帶於 body（登入時由 JWT 識別，無需附加）。
function withVoter(body: Record<string, unknown>): Record<string, unknown> {
  const token = localStorage.getItem('zutomayo_token');
  if (token) return body;
  return { ...body, anonymousId: getAnonymousId() };
}

// ===== 列表與詳情 =====
export async function listFeedbackPosts(
  params: {
    status?: FeedbackStatus | '';
    tag?: string;
    sort?: FeedbackSort;
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<FeedbackPost[]> {
  const query = new URLSearchParams();
  const token = localStorage.getItem('zutomayo_token');
  if (!token) query.set('anonymousId', getAnonymousId());
  if (params.status) query.set('status', params.status);
  if (params.tag) query.set('tag', params.tag);
  if (params.sort) query.set('sort', params.sort);
  if (params.q) query.set('q', params.q);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const data = await request<{ posts: FeedbackPost[] }>(`/feedback/posts?${query.toString()}`);
  return data.posts;
}

export async function getFeedbackPost(id: string): Promise<FeedbackPost> {
  return request<FeedbackPost>(`/feedback/posts/${encodeURIComponent(id)}${voterQuery()}`);
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  return request<FeedbackStats>('/feedback/stats');
}

// ===== 發文 / 投票 / 留言 =====
export async function createFeedbackPost(title: string, description: string): Promise<FeedbackPost> {
  return request<FeedbackPost>('/feedback/posts', {
    method: 'POST',
    body: JSON.stringify(withVoter({ title, description })),
  });
}

export async function toggleFeedbackVote(postId: string): Promise<{ voted: boolean }> {
  return request<{ voted: boolean }>(`/feedback/posts/${encodeURIComponent(postId)}/votes`, {
    method: 'POST',
    body: JSON.stringify(withVoter({})),
  });
}

export async function addFeedbackComment(
  postId: string,
  content: string,
  isOfficial = false,
): Promise<FeedbackComment> {
  return request<FeedbackComment>(`/feedback/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: JSON.stringify(withVoter({ content, isOfficial })),
  });
}

// ===== 留言按讚 / 投票者列表 =====
export async function toggleFeedbackCommentVote(commentId: string): Promise<{ voted: boolean }> {
  return request<{ voted: boolean }>(`/feedback/comments/${encodeURIComponent(commentId)}/votes`, {
    method: 'POST',
    body: JSON.stringify(withVoter({})),
  });
}

export async function listFeedbackVoters(postId: string): Promise<FeedbackVoter[]> {
  const data = await request<{ voters: FeedbackVoter[] }>(`/feedback/posts/${encodeURIComponent(postId)}/voters`);
  return data.voters;
}

// ===== 編輯 / 刪除 =====
export async function editFeedbackPost(postId: string, title: string, description: string): Promise<FeedbackPost> {
  return request<FeedbackPost>(`/feedback/posts/${encodeURIComponent(postId)}`, {
    method: 'PUT',
    body: JSON.stringify(withVoter({ title, description })),
  });
}

export async function editFeedbackComment(commentId: string, content: string): Promise<FeedbackComment> {
  return request<FeedbackComment>(`/feedback/comments/${encodeURIComponent(commentId)}`, {
    method: 'PUT',
    body: JSON.stringify(withVoter({ content })),
  });
}

export async function deleteFeedbackComment(commentId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/feedback/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
    body: JSON.stringify(withVoter({})),
  });
}

// ===== 標籤管理 =====
export async function listFeedbackTags(): Promise<FeedbackTag[]> {
  const data = await request<{ tags: FeedbackTag[] }>('/feedback/tags');
  return data.tags;
}

// ===== 管理員審核 =====
function adminHeaders(): Record<string, string> {
  const token =
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zutomayo_admin_token')) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('zutomayo_admin_token')) ||
    '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isAdminMode(): boolean {
  return Boolean(
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zutomayo_admin_token')) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('zutomayo_admin_token')),
  );
}

export async function adminUpdatePostStatus(postId: string, status: FeedbackStatus): Promise<FeedbackPost> {
  return request<FeedbackPost>(`/feedback/admin/posts/${encodeURIComponent(postId)}/status`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
}

export async function adminUpdatePostTag(postId: string, tag: string): Promise<FeedbackPost> {
  return request<FeedbackPost>(`/feedback/admin/posts/${encodeURIComponent(postId)}/tag`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ tag }),
  });
}

export async function adminDeleteFeedbackPost(postId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/feedback/admin/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
}

export async function adminCreateFeedbackTag(name: string, color: string): Promise<FeedbackTag> {
  return request<FeedbackTag>('/feedback/admin/tags', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name, color }),
  });
}

export async function adminDeleteFeedbackTag(tagId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/feedback/admin/tags/${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
}

// ===== 相似文章提示 =====
export interface SimilarPost {
  id: string;
  title: string;
  status: FeedbackStatus;
  tag: string;
  voteCount: number;
}

export async function findSimilarPosts(query: string, limit = 5): Promise<SimilarPost[]> {
  const q = new URLSearchParams({ q: query, limit: String(limit) });
  const data = await request<{ posts: SimilarPost[] }>(`/feedback/similar?${q.toString()}`);
  return data.posts;
}

// ===== Duplicate 文章（管理員）=====
export async function adminMarkAsDuplicate(postId: string, originalPostId: string): Promise<FeedbackPost> {
  return request<FeedbackPost>(`/feedback/admin/posts/${encodeURIComponent(postId)}/duplicate`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ originalPostId }),
  });
}

// ===== Emoji 反應 =====
export const FEEDBACK_EMOJIS = ['👍', '❤️', '🎉', '😄', '😕', '👎'] as const;

export async function toggleFeedbackCommentReaction(commentId: string, emoji: string): Promise<{ reacted: boolean }> {
  return request<{ reacted: boolean }>(
    `/feedback/comments/${encodeURIComponent(commentId)}/reactions/${encodeURIComponent(emoji)}`,
    {
      method: 'POST',
      body: JSON.stringify(withVoter({})),
    },
  );
}

// ===== 圖片上傳 =====
export async function uploadFeedbackImage(
  image: string,
  options: { postId?: string; commentId?: string; fileName?: string } = {},
): Promise<{ bkey: string; url: string }> {
  const data = await request<{ bkey: string; url: string }>('/feedback/uploads', {
    method: 'POST',
    body: JSON.stringify(withVoter({ image, ...options })),
  });
  return data;
}
