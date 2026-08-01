import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  adminKnowledgeSearchZeroResultsQuerySchema,
  knowledgeSearchIdsQuerySchema,
  knowledgeSearchQuerySchema,
  knowledgeSearchSuggestQuerySchema,
} = require('../schemas.cjs') as {
  adminKnowledgeSearchZeroResultsQuerySchema: { safeParse: (value: unknown) => { success: boolean } };
  knowledgeSearchQuerySchema: { safeParse: (value: unknown) => { success: boolean } };
  knowledgeSearchIdsQuerySchema: { safeParse: (value: unknown) => { success: boolean } };
  knowledgeSearchSuggestQuerySchema: { safeParse: (value: unknown) => { success: boolean } };
};

describe('knowledge search request schemas', () => {
  it('caps full result payloads at 100 hits', () => {
    expect(knowledgeSearchQuerySchema.safeParse({ q: 'Chronos', limit: '100' }).success).toBe(true);
    expect(knowledgeSearchQuerySchema.safeParse({ q: 'Chronos', limit: '101' }).success).toBe(false);
  });

  it('allows a larger IDs-only page filter but excludes deck documents', () => {
    expect(
      knowledgeSearchIdsQuerySchema.safeParse({ q: 'Chronos', scope: 'card', lang: 'zh-TW', limit: '500' }).success,
    ).toBe(true);
    expect(knowledgeSearchIdsQuerySchema.safeParse({ q: 'Chronos', scope: 'deck', limit: '500' }).success).toBe(false);
    expect(knowledgeSearchIdsQuerySchema.safeParse({ q: 'Chronos', scope: 'card', analytics: '0' }).success).toBe(true);
    expect(knowledgeSearchIdsQuerySchema.safeParse({ q: 'Chronos', scope: 'card', analytics: 'false' }).success).toBe(
      false,
    );
  });

  it('caps autocomplete at eight public suggestions', () => {
    expect(knowledgeSearchSuggestQuerySchema.safeParse({ q: 'Chronos', limit: '8' }).success).toBe(true);
    expect(knowledgeSearchSuggestQuerySchema.safeParse({ q: 'Chronos', limit: '9' }).success).toBe(false);
  });

  it('bounds the administrator zero-result report window', () => {
    expect(adminKnowledgeSearchZeroResultsQuerySchema.safeParse({ limit: '200', days: '90' }).success).toBe(true);
    expect(adminKnowledgeSearchZeroResultsQuerySchema.safeParse({ limit: '201', days: '30' }).success).toBe(false);
    expect(adminKnowledgeSearchZeroResultsQuerySchema.safeParse({ limit: '50', days: '91' }).success).toBe(false);
  });
});
