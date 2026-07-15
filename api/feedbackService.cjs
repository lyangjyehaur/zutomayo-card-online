/* global module, require */

// ===== 反饋功能服務（參考 Fider）=====

const { writeAuditLog } = require('./adminService.cjs');
// 支援匿名（anonymousId，前端 localStorage 產生）與登入用戶（JWT userId）雙軌。
// 投票/留言/發文皆以「用戶或匿名擇一」作為身份識別，避免重複投票。

const VALID_STATUSES = ['open', 'planned', 'started', 'completed', 'declined', 'duplicate'];
const VALID_SORTS = ['top', 'newest', 'recent', 'trending', 'most-discussed'];

// 不可投票的狀態（與 Fider 一致：已完成/拒絕/重複的文章不可投票）
const NO_VOTE_STATUSES = ['completed', 'declined', 'duplicate'];

// 投票者身份：userId 與 anonymousId 恰一者非空。
function voterRef(voter) {
  if (voter && voter.userId) return { column: 'voter_user_id', value: voter.userId };
  if (voter && voter.anonymousId) return { column: 'anonymous_id', value: voter.anonymousId };
  return null;
}

function viewerAnonymousId(row, voter) {
  return voter?.anonymousId && voter.anonymousId === row.anonymous_id ? row.anonymous_id : null;
}

function mapPost(row, voter) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    tag: row.tag || '',
    authorUserId: row.author_user_id || null,
    authorNickname: row.author_nickname || null,
    // anonymous_id is an edit/delete capability. Return it only to the
    // browser that already proved possession through its request identity.
    anonymousId: viewerAnonymousId(row, voter),
    voteCount: Number(row.vote_count) || 0,
    commentCount: Number(row.comment_count) || 0,
    hasVoted: Boolean(row.has_voted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at || null,
    originalPostId: row.original_post_id || null,
    originalPostTitle: row.original_post_title || null,
    originalPostStatus: row.original_post_status || null,
  };
}

function mapComment(row, voter) {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    authorUserId: row.author_user_id || null,
    authorNickname: row.author_nickname || null,
    anonymousId: viewerAnonymousId(row, voter),
    isOfficial: Boolean(row.is_official),
    voteCount: Number(row.vote_count) || 0,
    hasVoted: Boolean(row.has_voted),
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    reactions: row.reactions || [],
  };
}

function mapVoter(row) {
  return {
    userId: row.voter_user_id || null,
    nickname: row.nickname || null,
    // 不公開 anonymousId，避免被冒充
    isAnonymous: !row.voter_user_id && Boolean(row.anonymous_id),
    createdAt: row.created_at,
  };
}

function mapTag(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color || '',
    createdAt: row.created_at,
  };
}

// 列出反饋文章。
async function listPosts({ pool, voter, status, tag, sort, q, limit, offset }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  // 預設不顯示 duplicate 和 deleted；即使傳入無效 status 也套用排除
  const isValidStatus = status && VALID_STATUSES.includes(status);
  const excludeStatuses = isValidStatus ? [] : ['duplicate', 'deleted'];
  if (excludeStatuses.length > 0) {
    conditions.push('p.status NOT IN (' + excludeStatuses.map((_, i) => '$' + (idx + i)).join(', ') + ')');
    excludeStatuses.forEach((s) => params.push(s));
    idx += excludeStatuses.length;
  }

  if (isValidStatus) {
    conditions.push('p.status = $' + idx++);
    params.push(status);
  }
  if (tag) {
    conditions.push('p.tag = $' + idx++);
    params.push(tag);
  }
  if (q) {
    conditions.push('(p.title ILIKE $' + idx + ' OR p.description ILIKE $' + idx + ')');
    params.push('%' + q + '%');
    idx++;
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  let orderBy;
  switch (sort) {
    case 'newest':
      orderBy = 'p.created_at DESC';
      break;
    case 'recent':
      orderBy = 'p.updated_at DESC';
      break;
    case 'trending':
      // 熱度算法：(近30天投票×5 + 近30天留言×3) / (小時數+2)^1.4（HN 風格）
      orderBy =
        "((SELECT COUNT(*) FROM feedback_votes v WHERE v.post_id = p.id AND v.created_at > NOW() - INTERVAL '30 days') * 5 + " +
        "(SELECT COUNT(*) FROM feedback_comments c WHERE c.post_id = p.id AND c.created_at > NOW() - INTERVAL '30 days') * 3) " +
        '/ POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.4) DESC';
      break;
    case 'most-discussed':
      orderBy = 'comment_count DESC, p.created_at DESC';
      break;
    default: // 'top'
      orderBy = 'vote_count DESC, p.created_at DESC';
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);

  const ref = voterRef(voter);
  let hasVotedExpr = 'FALSE';
  if (ref) {
    hasVotedExpr =
      'EXISTS(SELECT 1 FROM feedback_votes v WHERE v.post_id = p.id AND v.' + ref.column + ' = $' + idx + ')';
    params.push(ref.value);
    idx++;
  }

  params.push(lim, off);
  const sql =
    'SELECT p.id, p.title, p.description, p.status, p.tag, ' +
    'p.author_user_id, p.anonymous_id, p.created_at, p.updated_at, p.edited_at, ' +
    'p.original_post_id, ' +
    'u.nickname AS author_nickname, ' +
    '(SELECT COUNT(*) FROM feedback_votes v WHERE v.post_id = p.id) AS vote_count, ' +
    '(SELECT COUNT(*) FROM feedback_comments c WHERE c.post_id = p.id) AS comment_count, ' +
    hasVotedExpr +
    ' AS has_voted ' +
    'FROM feedback_posts p ' +
    'LEFT JOIN users u ON u.id = p.author_user_id ' +
    where +
    ' ORDER BY ' +
    orderBy +
    ' LIMIT $' +
    idx++ +
    ' OFFSET $' +
    idx++;

  const { rows } = await pool.query(sql, params);
  return { ok: true, body: { posts: rows.map((row) => mapPost(row, voter)) } };
}

// 取得單一文章（含留言列表，留言含按讚數、emoji 反應、是否已按讚）。
async function getPost({ pool, voter, postId }) {
  const ref = voterRef(voter);
  const postParams = [postId];
  let hasVotedExpr = 'FALSE';
  if (ref) {
    hasVotedExpr = 'EXISTS(SELECT 1 FROM feedback_votes v WHERE v.post_id = p.id AND v.' + ref.column + ' = $2)';
    postParams.push(ref.value);
  }

  const postSql =
    'SELECT p.id, p.title, p.description, p.status, p.tag, ' +
    'p.author_user_id, p.anonymous_id, p.created_at, p.updated_at, p.edited_at, ' +
    'p.original_post_id, ' +
    'u.nickname AS author_nickname, ' +
    'op.title AS original_post_title, op.status AS original_post_status, ' +
    '(SELECT COUNT(*) FROM feedback_votes v WHERE v.post_id = p.id) AS vote_count, ' +
    '(SELECT COUNT(*) FROM feedback_comments c WHERE c.post_id = p.id) AS comment_count, ' +
    hasVotedExpr +
    ' AS has_voted ' +
    'FROM feedback_posts p ' +
    'LEFT JOIN users u ON u.id = p.author_user_id ' +
    'LEFT JOIN feedback_posts op ON op.id = p.original_post_id ' +
    'WHERE p.id = $1';

  const postRes = await pool.query(postSql, postParams);
  if (postRes.rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  const post = mapPost(postRes.rows[0], voter);

  // 留言查詢
  const commentParams = [postId];
  let commentHasVotedExpr = 'FALSE';
  if (ref) {
    commentHasVotedExpr =
      'EXISTS(SELECT 1 FROM feedback_comment_votes cv WHERE cv.comment_id = c.id AND cv.' + ref.column + ' = $2)';
    commentParams.push(ref.value);
  }
  const commentsRes = await pool.query(
    'SELECT c.id, c.post_id, c.content, c.is_official, c.edited_at, ' +
      'c.author_user_id, c.anonymous_id, c.created_at, ' +
      'u.nickname AS author_nickname, ' +
      '(SELECT COUNT(*) FROM feedback_comment_votes cv WHERE cv.comment_id = c.id) AS vote_count, ' +
      commentHasVotedExpr +
      ' AS has_voted ' +
      'FROM feedback_comments c ' +
      'LEFT JOIN users u ON u.id = c.author_user_id ' +
      'WHERE c.post_id = $1 ' +
      'ORDER BY c.is_official DESC, vote_count DESC, c.created_at ASC',
    commentParams,
  );

  // 取所有留言的 emoji 反應
  const commentIds = commentsRes.rows.map((r) => r.id);
  let reactionsMap = {};
  if (commentIds.length > 0) {
    const reactionsRes = ref
      ? await pool.query(
          'SELECT comment_id, emoji, COUNT(*) as count, ' +
            'BOOL_OR(cr.' +
            ref.column +
            ' = $1) AS includes_me ' +
            'FROM feedback_comment_reactions cr ' +
            'WHERE cr.comment_id = ANY($2) ' +
            'GROUP BY comment_id, emoji',
          [ref.value, commentIds],
        )
      : await pool.query(
          'SELECT comment_id, emoji, COUNT(*) as count, ' +
            'FALSE AS includes_me ' +
            'FROM feedback_comment_reactions cr ' +
            'WHERE cr.comment_id = ANY($1) ' +
            'GROUP BY comment_id, emoji',
          [commentIds],
        );
    for (const r of reactionsRes.rows) {
      if (!reactionsMap[r.comment_id]) reactionsMap[r.comment_id] = [];
      reactionsMap[r.comment_id].push({
        emoji: r.emoji,
        count: Number(r.count),
        includesMe: Boolean(r.includes_me),
      });
    }
  }

  post.comments = commentsRes.rows.map((row) => {
    const c = mapComment(row, voter);
    c.reactions = reactionsMap[row.id] || [];
    return c;
  });
  return { ok: true, body: post };
}

// 建立反饋文章。
async function createPost({ pool, voter, body, sanitizeText, generateId }) {
  const title = sanitizeText(body.title, 120);
  const description = sanitizeText(body.description, 2000);
  if (!title) return { ok: false, status: 400, error: 'Title is required' };
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  const id = generateId();
  const authorUserId = ref.column === 'voter_user_id' ? ref.value : null;
  const anonymousId = ref.column === 'anonymous_id' ? ref.value : null;

  const { rows } = await pool.query(
    'INSERT INTO feedback_posts (id, title, description, author_user_id, anonymous_id, status, tag) ' +
      "VALUES ($1, $2, $3, $4, $5, 'open', '') RETURNING *",
    [id, title, description, authorUserId, anonymousId],
  );
  // 作者自動 +1 票
  await pool.query('INSERT INTO feedback_votes (post_id, ' + ref.column + ') VALUES ($1, $2)', [id, ref.value]);
  const row = rows[0];
  return {
    ok: true,
    body: {
      id: row.id,
      title: row.title,
      description: row.description || '',
      status: row.status,
      tag: row.tag || '',
      authorUserId: row.author_user_id || null,
      authorNickname: null,
      anonymousId: row.anonymous_id || null,
      voteCount: 1,
      commentCount: 0,
      hasVoted: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      editedAt: null,
      originalPostId: null,
      originalPostTitle: null,
      originalPostStatus: null,
      comments: [],
    },
  };
}

// 切換投票。completed/declined/duplicate 狀態不可投票。
async function toggleVote({ pool, voter, postId }) {
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  const postRes = await pool.query('SELECT id, status FROM feedback_posts WHERE id = $1', [postId]);
  if (postRes.rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  const status = postRes.rows[0].status;
  if (NO_VOTE_STATUSES.includes(status)) {
    return { ok: false, status: 400, error: 'Cannot vote on posts with status: ' + status };
  }

  const cur = await pool.query('SELECT 1 FROM feedback_votes WHERE post_id = $1 AND ' + ref.column + ' = $2', [
    postId,
    ref.value,
  ]);
  if (cur.rows.length > 0) {
    await pool.query('DELETE FROM feedback_votes WHERE post_id = $1 AND ' + ref.column + ' = $2', [postId, ref.value]);
    return { ok: true, body: { voted: false } };
  }
  await pool.query('INSERT INTO feedback_votes (post_id, ' + ref.column + ') VALUES ($1, $2)', [postId, ref.value]);
  return { ok: true, body: { voted: true } };
}

// 新增留言。支援 isOfficial（管理員官方回應）。
async function addComment({ pool, voter, postId, body, sanitizeText, generateId, isOfficial }) {
  const content = sanitizeText(body.content, 1000);
  if (!content) return { ok: false, status: 400, error: 'Content is required' };
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  const exists = await pool.query('SELECT id FROM feedback_posts WHERE id = $1', [postId]);
  if (exists.rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };

  const id = generateId();
  const authorUserId = ref.column === 'voter_user_id' ? ref.value : null;
  const anonymousId = ref.column === 'anonymous_id' ? ref.value : null;
  const { rows } = await pool.query(
    'INSERT INTO feedback_comments (id, post_id, content, author_user_id, anonymous_id, is_official) ' +
      'VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [id, postId, content, authorUserId, anonymousId, Boolean(isOfficial)],
  );
  await pool.query('UPDATE feedback_posts SET updated_at = NOW() WHERE id = $1', [postId]);
  const row = rows[0];
  return {
    ok: true,
    body: {
      id: row.id,
      postId: row.post_id,
      content: row.content,
      authorUserId: row.author_user_id || null,
      authorNickname: null,
      anonymousId: row.anonymous_id || null,
      isOfficial: Boolean(row.is_official),
      voteCount: 0,
      hasVoted: false,
      createdAt: row.created_at,
      editedAt: null,
      reactions: [],
    },
  };
}

// 切換留言按讚。
async function toggleCommentVote({ pool, voter, commentId }) {
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  const exists = await pool.query('SELECT id FROM feedback_comments WHERE id = $1', [commentId]);
  if (exists.rows.length === 0) return { ok: false, status: 404, error: 'Comment not found' };

  const cur = await pool.query(
    'SELECT 1 FROM feedback_comment_votes WHERE comment_id = $1 AND ' + ref.column + ' = $2',
    [commentId, ref.value],
  );
  if (cur.rows.length > 0) {
    await pool.query('DELETE FROM feedback_comment_votes WHERE comment_id = $1 AND ' + ref.column + ' = $2', [
      commentId,
      ref.value,
    ]);
    return { ok: true, body: { voted: false } };
  }
  await pool.query('INSERT INTO feedback_comment_votes (comment_id, ' + ref.column + ') VALUES ($1, $2)', [
    commentId,
    ref.value,
  ]);
  return { ok: true, body: { voted: true } };
}

// 切換留言 emoji 反應。
async function toggleCommentReaction({ pool, voter, commentId, emoji }) {
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  // emoji 白名單（常見表情）
  const VALID_EMOJIS = ['👍', '❤️', '🎉', '😄', '😕', '👎'];
  if (!VALID_EMOJIS.includes(emoji)) {
    return { ok: false, status: 400, error: 'Invalid emoji' };
  }

  const exists = await pool.query('SELECT id FROM feedback_comments WHERE id = $1', [commentId]);
  if (exists.rows.length === 0) return { ok: false, status: 404, error: 'Comment not found' };

  const cur = await pool.query(
    'SELECT 1 FROM feedback_comment_reactions WHERE comment_id = $1 AND ' + ref.column + ' = $2 AND emoji = $3',
    [commentId, ref.value, emoji],
  );
  if (cur.rows.length > 0) {
    await pool.query(
      'DELETE FROM feedback_comment_reactions WHERE comment_id = $1 AND ' + ref.column + ' = $2 AND emoji = $3',
      [commentId, ref.value, emoji],
    );
    return { ok: true, body: { reacted: false } };
  }
  await pool.query(
    'INSERT INTO feedback_comment_reactions (comment_id, ' + ref.column + ', emoji) VALUES ($1, $2, $3)',
    [commentId, ref.value, emoji],
  );
  return { ok: true, body: { reacted: true } };
}

// 取得文章投票者列表。
async function listVoters({ pool, postId }) {
  const exists = await pool.query('SELECT id FROM feedback_posts WHERE id = $1', [postId]);
  if (exists.rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  const { rows } = await pool.query(
    'SELECT v.voter_user_id, v.anonymous_id, v.created_at, u.nickname ' +
      'FROM feedback_votes v ' +
      'LEFT JOIN users u ON u.id = v.voter_user_id ' +
      'WHERE v.post_id = $1 ' +
      'ORDER BY v.created_at ASC',
    [postId],
  );
  return { ok: true, body: { voters: rows.map(mapVoter) } };
}

// 編輯文章（作者）。
async function editPost({ pool, voter, postId, body, sanitizeText }) {
  const title = sanitizeText(body.title, 120);
  const description = sanitizeText(body.description, 2000);
  if (!title) return { ok: false, status: 400, error: 'Title is required' };
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  const post = await pool.query('SELECT author_user_id, anonymous_id FROM feedback_posts WHERE id = $1', [postId]);
  if (post.rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  const row = post.rows[0];
  if (ref.column === 'voter_user_id' && row.author_user_id !== ref.value) {
    return { ok: false, status: 403, error: 'Only author can edit' };
  }
  if (ref.column === 'anonymous_id' && row.anonymous_id !== ref.value) {
    return { ok: false, status: 403, error: 'Only author can edit' };
  }

  const { rows } = await pool.query(
    'UPDATE feedback_posts SET title = $1, description = $2, edited_at = NOW(), updated_at = NOW() ' +
      'WHERE id = $3 RETURNING *',
    [title, description, postId],
  );
  return { ok: true, body: mapPost(rows[0], voter) };
}

// 編輯留言（作者）。
async function editComment({ pool, voter, commentId, body, sanitizeText }) {
  const content = sanitizeText(body.content, 1000);
  if (!content) return { ok: false, status: 400, error: 'Content is required' };
  const ref = voterRef(voter);
  if (!ref) return { ok: false, status: 400, error: 'Identity is required' };

  const comment = await pool.query('SELECT author_user_id, anonymous_id FROM feedback_comments WHERE id = $1', [
    commentId,
  ]);
  if (comment.rows.length === 0) return { ok: false, status: 404, error: 'Comment not found' };
  const row = comment.rows[0];
  if (ref.column === 'voter_user_id' && row.author_user_id !== ref.value) {
    return { ok: false, status: 403, error: 'Only author can edit' };
  }
  if (ref.column === 'anonymous_id' && row.anonymous_id !== ref.value) {
    return { ok: false, status: 403, error: 'Only author can edit' };
  }

  const { rows } = await pool.query(
    'UPDATE feedback_comments SET content = $1, edited_at = NOW() WHERE id = $2 RETURNING *',
    [content, commentId],
  );
  return { ok: true, body: mapComment(rows[0], voter) };
}

// 刪除留言（作者或管理員）。
async function deleteComment({ pool, voter, commentId, isAdmin }) {
  const ref = voterRef(voter);
  if (!ref && !isAdmin) return { ok: false, status: 400, error: 'Identity is required' };

  const comment = await pool.query('SELECT author_user_id, anonymous_id FROM feedback_comments WHERE id = $1', [
    commentId,
  ]);
  if (comment.rows.length === 0) return { ok: false, status: 404, error: 'Comment not found' };

  if (!isAdmin) {
    const row = comment.rows[0];
    if (ref.column === 'voter_user_id' && row.author_user_id !== ref.value) {
      return { ok: false, status: 403, error: 'Only author can delete' };
    }
    if (ref.column === 'anonymous_id' && row.anonymous_id !== ref.value) {
      return { ok: false, status: 403, error: 'Only author can delete' };
    }
  }

  await pool.query('DELETE FROM feedback_comments WHERE id = $1', [commentId]);
  return { ok: true, body: { deleted: true } };
}

// 管理員：更新文章狀態。
async function updatePostStatus({ pool, postId, status, adminUserId }) {
  if (!VALID_STATUSES.includes(status)) {
    return { ok: false, status: 400, error: 'Invalid status' };
  }
  const { rows } = await pool.query(
    'UPDATE feedback_posts SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, postId],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'update_feedback_status',
    targetType: 'feedback_post',
    targetId: postId,
    details: { status },
  });
  return { ok: true, body: mapPost(rows[0]) };
}

// 管理員：標記為重複文章（指向原文章）。
async function markAsDuplicate({ pool, postId, originalPostId, adminUserId }) {
  if (postId === originalPostId) {
    return { ok: false, status: 400, error: 'Cannot mark post as duplicate of itself' };
  }
  // 確認原文章存在
  const orig = await pool.query('SELECT id, title, status FROM feedback_posts WHERE id = $1', [originalPostId]);
  if (orig.rows.length === 0) return { ok: false, status: 404, error: 'Original post not found' };

  const { rows } = await pool.query(
    "UPDATE feedback_posts SET status = 'duplicate', original_post_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [originalPostId, postId],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  const post = mapPost(rows[0]);
  post.originalPostTitle = orig.rows[0].title;
  post.originalPostStatus = orig.rows[0].status;
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'mark_feedback_duplicate',
    targetType: 'feedback_post',
    targetId: postId,
    details: { originalPostId },
  });
  return { ok: true, body: post };
}

// 管理員：更新文章標籤。
async function updatePostTag({ pool, postId, tag, sanitizeText, adminUserId }) {
  const clean = sanitizeText(tag, 30);
  const { rows } = await pool.query(
    'UPDATE feedback_posts SET tag = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [clean, postId],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'Post not found' };
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'update_feedback_tag',
    targetType: 'feedback_post',
    targetId: postId,
    details: { tag: clean },
  });
  return { ok: true, body: mapPost(rows[0]) };
}

// 管理員：刪除文章。
async function deletePost({ pool, postId, adminUserId }) {
  const { rowCount } = await pool.query('DELETE FROM feedback_posts WHERE id = $1', [postId]);
  if (rowCount === 0) return { ok: false, status: 404, error: 'Post not found' };
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'delete_feedback_post',
    targetType: 'feedback_post',
    targetId: postId,
    details: {},
  });
  return { ok: true, body: { deleted: true } };
}

// 統計資料。
async function getStats({ pool }) {
  const { rows } = await pool.query(
    'SELECT ' +
      "COUNT(*) FILTER (WHERE status = 'open') AS open, " +
      "COUNT(*) FILTER (WHERE status = 'planned') AS planned, " +
      "COUNT(*) FILTER (WHERE status = 'started') AS started, " +
      "COUNT(*) FILTER (WHERE status = 'completed') AS completed, " +
      "COUNT(*) FILTER (WHERE status = 'declined') AS declined, " +
      "COUNT(*) FILTER (WHERE status = 'duplicate') AS duplicate, " +
      'COUNT(*) AS total, ' +
      '(SELECT COUNT(*) FROM feedback_votes) AS total_votes ' +
      'FROM feedback_posts',
  );
  return { ok: true, body: rows[0] };
}

// 相似文章查詢（建立時提示重複）。
async function findSimilarPosts({ pool, q, limit }) {
  if (!q || q.trim().length < 2) return { ok: true, body: { posts: [] } };
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const { rows } = await pool.query(
    'SELECT id, title, status, tag, ' +
      '(SELECT COUNT(*) FROM feedback_votes v WHERE v.post_id = p.id) AS vote_count ' +
      'FROM feedback_posts p ' +
      "WHERE status NOT IN ('deleted', 'duplicate') " +
      'AND (title ILIKE $1 OR description ILIKE $1) ' +
      'ORDER BY vote_count DESC ' +
      'LIMIT $2',
    ['%' + q.trim() + '%', lim],
  );
  return {
    ok: true,
    body: {
      posts: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        tag: r.tag || '',
        voteCount: Number(r.vote_count) || 0,
      })),
    },
  };
}

// 標籤管理：列出所有標籤。
async function listTags({ pool }) {
  const { rows } = await pool.query(
    'SELECT t.id, t.name, t.color, t.created_at, ' +
      '(SELECT COUNT(*) FROM feedback_posts p WHERE p.tag = t.name) AS usage_count ' +
      'FROM feedback_tags t ORDER BY t.created_at ASC',
  );
  return { ok: true, body: { tags: rows.map(mapTag) } };
}

// 管理員：建立標籤。
async function createTag({ pool, body, sanitizeText, generateId, adminUserId }) {
  const name = sanitizeText(body.name, 30);
  const color = sanitizeText(body.color || '', 20);
  if (!name) return { ok: false, status: 400, error: 'Tag name is required' };
  const id = generateId();
  const { rows } = await pool.query('INSERT INTO feedback_tags (id, name, color) VALUES ($1, $2, $3) RETURNING *', [
    id,
    name,
    color,
  ]);
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'create_feedback_tag',
    targetType: 'feedback_tag',
    targetId: id,
    details: { name, color },
  });
  return { ok: true, body: mapTag(rows[0]) };
}

// 管理員：刪除標籤。
async function deleteTag({ pool, tagId, adminUserId }) {
  const { rowCount } = await pool.query('DELETE FROM feedback_tags WHERE id = $1', [tagId]);
  if (rowCount === 0) return { ok: false, status: 404, error: 'Tag not found' };
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'delete_feedback_tag',
    targetType: 'feedback_tag',
    targetId: tagId,
    details: {},
  });
  return { ok: true, body: { deleted: true } };
}

module.exports = {
  VALID_STATUSES,
  VALID_SORTS,
  NO_VOTE_STATUSES,
  listPosts,
  getPost,
  createPost,
  toggleVote,
  addComment,
  toggleCommentVote,
  toggleCommentReaction,
  listVoters,
  editPost,
  editComment,
  deleteComment,
  updatePostStatus,
  markAsDuplicate,
  updatePostTag,
  deletePost,
  getStats,
  findSimilarPosts,
  listTags,
  createTag,
  deleteTag,
};
