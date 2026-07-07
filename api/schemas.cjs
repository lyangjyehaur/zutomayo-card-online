/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// Zod schemas for API request body validation.
// Service layers retain their own sanitization for defense-in-depth; these schemas
// provide early rejection at the HTTP boundary with consistent 400 error format.
const { z } = require('zod');

const email = z.string().email().max(120).toLowerCase();
const password = z.string().min(6).max(200);
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
  newPassword: z.string().min(6).max(200),
});

// ===== Deck =====
const deckCreateSchema = z.object({
  name: z.string().min(1).max(60),
  cardIds: z.array(z.string().min(1).max(40)).length(20),
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

// ===== Admin =====
const adminLoginSchema = z.object({
  password: z.string().min(1).max(200),
});

const adminEloSchema = z.object({
  elo: z.number().int().min(0).max(9999),
});

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
  deckCreateSchema,
  matchSubmitSchema,
  heartbeatSchema,
  adminLoginSchema,
  adminEloSchema,
  mmQueueSchema,
  mmMatchSchema,
  feedbackPostCreateSchema,
  feedbackCommentCreateSchema,
  feedbackStatusSchema,
  feedbackTagSchema,
  feedbackPostEditSchema,
  feedbackCommentEditSchema,
};
