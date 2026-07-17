/* global module, require */
// Zod schemas for API request body validation.
// Service layers retain their own sanitization for defense-in-depth; these schemas
// provide early rejection at the HTTP boundary with consistent 400 error format.
const { z } = require('zod');

const email = z.string().email().max(120).toLowerCase();
const password = z.string().min(12).max(200);
const anonymousId = z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/);

// ===== Auth =====
const registerSchema = z.object({
  email,
  password,
  nickname: z.string().max(30).optional(),
});

const loginSchema = z.object({
  email: z.string().max(120),
  password: z.string().max(200),
});

const profileUpdateSchema = z.object({
  nickname: z.string().min(1).max(30),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

const accountTokenSchema = z.object({
  token: z.string().min(32).max(512),
});

const passwordResetRequestSchema = z.object({ email });

const passwordResetConfirmSchema = z.object({
  token: z.string().min(32).max(512),
  newPassword: password,
});

const accountDeleteSchema = z.object({
  confirmation: z.literal('DELETE'),
  // Destructive account actions require a fresh local-password proof or a
  // server-issued, one-time Logto step-up token. Provider verification record
  // IDs must never cross the browser boundary.
  currentPassword: z.string().min(1).max(200).optional(),
  stepUpToken: z.string().min(32).max(512).optional(),
});

const accountCenterVerificationSchema = z.object({
  currentPassword: z.string().min(1).max(200),
});

const accountCenterPasswordSchema = z.object({
  stepUpToken: z.string().min(32).max(512),
  newPassword: password,
});

// ===== Deck =====
const deckCreateSchema = z.object({
  name: z.string().min(1).max(60),
  cardIds: z.array(z.string().min(1).max(40)).length(20),
});

const deckReservationSchema = z.object({
  deckId: z.string().regex(/^d_[A-Za-z0-9_-]{4,128}$/),
  rulesVersion: z.string().min(1).max(120).optional(),
});

// ===== Match submission =====
// Loose: service layer (matchSubmission.cjs) performs deeper auth + business checks.
const matchSubmitSchema = z
  .object({
    winnerId: z.string().min(1).max(60),
    loserId: z.string().min(1).max(60),
    turns: z.number().int().nonnegative().max(9999).optional(),
    duration: z.number().int().nonnegative().max(86400).optional(),
    sourceMatchId: z.string().max(120).optional(),
    winnerPlayer: z.union([z.literal(0), z.literal(1)]).optional(),
    actionLog: z.array(z.record(z.unknown())).optional(),
    action_log: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

// ===== Presence =====
const heartbeatSchema = z.object({
  visitorId: z.string().min(1).max(96),
});

// ===== Friends =====
const friendCreateSchema = z.object({
  friendUserId: z.string().min(3).max(128),
});

const friendRequestResponseSchema = z.object({ accept: z.boolean() });

const userBlockSchema = z.object({ targetUserId: z.string().min(3).max(128) });

// ===== Chat =====
const chatConversationType = z.enum(['match', 'room', 'direct', 'global']);

const chatMessageCreateSchema = z
  .object({
    conversationType: chatConversationType,
    subjectId: z.string().min(1).max(300),
    content: z.string().min(1).max(1000),
    title: z.string().max(120).optional(),
    authorDisplayName: z.string().max(60).optional(),
    authorRole: z.enum(['player', 'spectator', 'moderator']).optional(),
    clientMessageId: z.string().max(120).optional(),
    sourceLanguage: z.string().max(16).optional(),
  })
  .passthrough();

const chatReadSchema = z.object({
  conversationType: chatConversationType,
  subjectId: z.string().min(1).max(300),
  lastReadMessageId: z.string().max(80).optional(),
});

const chatReportCreateSchema = z
  .object({
    reason: z.string().min(1).max(60),
    note: z.string().max(1000).optional(),
  })
  .passthrough();

const chatReportReviewSchema = z.object({
  status: z.enum(['reviewing', 'resolved', 'dismissed']),
  resolutionNote: z.string().max(1000).optional(),
});

const chatMessageModerationReviewSchema = z
  .object({
    status: z.enum(['visible', 'blocked', 'deleted']),
    reason: z.string().max(240).optional(),
  })
  .passthrough();

const chatUserSanctionCreateSchema = z
  .object({
    targetUserId: z.string().min(3).max(128),
    type: z.enum(['chat_mute']).optional(),
    durationMinutes: z.number().int().min(1).max(43200).optional(),
    reason: z.string().max(1000).optional(),
    sourceReportId: z.string().max(80).optional(),
    sourceMessageId: z.string().max(80).optional(),
    conversationId: z.string().max(340).optional(),
  })
  .passthrough();

const chatTranslationRequestSchema = z
  .object({
    targetLanguage: z.string().min(2).max(16),
  })
  .passthrough();

const announcementWriteSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(10000),
  sourceLanguage: z.enum(['ja', 'zh-tw', 'zh-cn', 'zh-hk', 'en', 'ko']),
  status: z.enum(['draft', 'published', 'archived']),
  publishedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

// ===== Admin =====
const adminLoginSchema = z.object({
  username: z.string().min(3).max(80),
  password: z.string().min(1).max(200),
  totpCode: z.string().regex(/^\d{6}$/),
});

const adminEloSchema = z.object({
  elo: z.number().int().min(0).max(9999),
});

const adminUserListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

const adminRoleUpdateSchema = z
  .object({
    role: z.enum(['viewer', 'moderator', 'operator', 'admin']).nullable(),
  })
  .strict();

const seasonIdSchema = z.string().regex(/^[a-zA-Z0-9._:-]{3,80}$/);
const seasonRewardTierSchema = z
  .object({
    id: z.string().min(1).max(64),
    maxRank: z.number().int().min(1).max(1_000_000),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();
const adminSeasonCreateSchema = z
  .object({
    id: seasonIdSchema,
    name: z.string().trim().min(1).max(120),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    startingRating: z.number().int().min(500).max(3000),
    placementMatches: z.number().int().min(0).max(20),
    ratingDecayPercent: z.number().int().min(0).max(100),
    rulesVersion: z.string().trim().min(1).max(64),
    rewardConfig: z.object({ tiers: z.array(seasonRewardTierSchema).max(50) }).strict(),
  })
  .strict();
const adminSeasonListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).strict();

const legalHoldSubjectTypeSchema = z.enum(['account', 'match', 'conversation', 'message', 'report', 'feedback']);
const legalHoldCreateSchema = z
  .object({
    subjectType: legalHoldSubjectTypeSchema,
    subjectId: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(10).max(1000),
    owner: z.string().trim().min(2).max(120),
    expiresAt: z.iso.datetime({ offset: true }),
    caseReference: z.string().trim().max(120).optional(),
  })
  .strict();
const legalHoldReleaseSchema = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
const legalHoldListQuerySchema = z
  .object({
    status: z.enum(['active', 'released', 'expired', 'all']).optional(),
    subjectType: legalHoldSubjectTypeSchema.optional(),
    subjectId: z.string().trim().min(1).max(300).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

// ===== Matchmaking =====
const mmQueueSchema = z
  .object({
    deckName: z.string().max(60).optional(),
    deckIds: z.array(z.string().max(40)).min(1).max(40).optional(),
  })
  .passthrough();

const mmMatchSchema = z.object({
  matchId: z.string().min(1).max(60),
});

// ===== Feedback =====
const feedbackPostCreateSchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(4000).optional().default(''),
    anonymousId: anonymousId.optional(),
  })
  .passthrough();

const feedbackCommentCreateSchema = z
  .object({
    content: z.string().min(1).max(4000),
    anonymousId: anonymousId.optional(),
    isOfficial: z.boolean().optional(),
  })
  .passthrough();

const feedbackStatusSchema = z.object({
  status: z.string().min(1).max(30),
});

const feedbackTagSchema = z.object({
  tag: z.string().max(30),
});

const feedbackPostEditSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(4000).optional(),
  })
  .passthrough();

const feedbackCommentEditSchema = z.object({
  content: z.string().min(1).max(4000),
});

module.exports = {
  z,
  registerSchema,
  loginSchema,
  profileUpdateSchema,
  passwordChangeSchema,
  accountTokenSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  accountDeleteSchema,
  accountCenterVerificationSchema,
  accountCenterPasswordSchema,
  deckCreateSchema,
  deckReservationSchema,
  matchSubmitSchema,
  heartbeatSchema,
  friendCreateSchema,
  friendRequestResponseSchema,
  userBlockSchema,
  chatMessageCreateSchema,
  chatReadSchema,
  chatReportCreateSchema,
  chatReportReviewSchema,
  chatMessageModerationReviewSchema,
  chatUserSanctionCreateSchema,
  chatTranslationRequestSchema,
  announcementWriteSchema,
  adminLoginSchema,
  adminEloSchema,
  adminUserListQuerySchema,
  adminRoleUpdateSchema,
  seasonIdSchema,
  adminSeasonCreateSchema,
  adminSeasonListQuerySchema,
  legalHoldCreateSchema,
  legalHoldReleaseSchema,
  legalHoldListQuerySchema,
  mmQueueSchema,
  mmMatchSchema,
  feedbackPostCreateSchema,
  feedbackCommentCreateSchema,
  feedbackStatusSchema,
  feedbackTagSchema,
  feedbackPostEditSchema,
  feedbackCommentEditSchema,
};
