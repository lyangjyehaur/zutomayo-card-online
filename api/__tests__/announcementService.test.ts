import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { translateAnnouncement, updateAnnouncement } = require('../announcementService.cjs') as {
  translateAnnouncement: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  updateAnnouncement: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const announcement = {
  id: 'announcement_1',
  title: '維護公告',
  content: '今晚進行維護。',
  source_language: 'zh-tw',
  content_version: 3,
};

describe('announcement translation cache', () => {
  it('calls the translator once for a version and reuses the stored translation', async () => {
    let storedTranslation: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM announcement_translations')) {
        return { rows: storedTranslation ? [storedTranslation] : [] };
      }
      if (sql.includes('INSERT INTO announcement_translations')) {
        storedTranslation = {
          announcement_id: announcement.id,
          content_version: announcement.content_version,
          target_language: 'en',
          translated_title: 'Maintenance notice',
          translated_content: 'Maintenance is scheduled tonight.',
          status: 'ready',
        };
        return { rows: [storedTranslation] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const translateText = vi.fn(async () => ({
      translatedContent: JSON.stringify({
        title: 'Maintenance notice',
        content: 'Maintenance is scheduled tonight.',
      }),
      provider: 'test',
      model: 'translate-v1',
    }));

    const input = { pool: { query }, announcement, targetLanguage: 'en', translateText };
    await expect(translateAnnouncement(input)).resolves.toMatchObject({ status: 'ready' });
    await expect(translateAnnouncement(input)).resolves.toMatchObject({ status: 'ready' });

    expect(translateText).toHaveBeenCalledTimes(1);
    expect(translateText).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'announcement', resourceId: announcement.id, targetLanguage: 'en' }),
    );
  });

  it('increments the content version and purges stale cache rows when source content changes', async () => {
    const updated = {
      ...announcement,
      content: '維護時間已更新。',
      content_version: 4,
      source_language: 'zh-tw',
      status: 'published',
      published_at: '2026-07-18T00:00:00.000Z',
      expires_at: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T01:00:00.000Z',
    };
    const query = vi.fn(async () => ({ rows: [updated] }));

    await expect(
      updateAnnouncement({
        pool: { query },
        id: announcement.id,
        adminUserId: 'admin_1',
        body: {
          title: announcement.title,
          content: updated.content,
          sourceLanguage: 'zh-tw',
          status: 'published',
          publishedAt: updated.published_at,
        },
        sanitizeText: (value: string, length: number) => value.slice(0, length),
      }),
    ).resolves.toMatchObject({ ok: true, body: { announcement: { contentVersion: 4 } } });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('content_version = content_version + CASE'),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM announcement_translations'),
      expect.any(Array),
    );
  });
});
