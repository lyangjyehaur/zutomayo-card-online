import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus, Save, Trash2 } from 'lucide-react';
import {
  adminCreateAnnouncement,
  adminDeleteAnnouncement,
  adminGetAnnouncements,
  adminUpdateAnnouncement,
  type Announcement,
  type AnnouncementInput,
} from '../api/client';
import { Alert, Button, FormField, Input, LoadingState, Panel, Select, Textarea } from '../ui';

const EMPTY_DRAFT: AnnouncementInput = {
  title: '',
  content: '',
  sourceLanguage: 'zh-tw',
  status: 'draft',
  publishedAt: null,
  expiresAt: null,
};

function announcementToDraft(announcement: Announcement): AnnouncementInput {
  return {
    title: announcement.title,
    content: announcement.content,
    sourceLanguage: announcement.sourceLanguage as AnnouncementInput['sourceLanguage'],
    status: announcement.status as AnnouncementInput['status'],
    publishedAt: announcement.publishedAt,
    expiresAt: announcement.expiresAt,
  };
}

export function AdminAnnouncementsPanel() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnnouncementInput>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await adminGetAnnouncements();
      setItems(next);
      if (selectedId) {
        const selected = next.find((item) => item.id === selectedId);
        if (selected) setDraft(announcementToDraft(selected));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '公告載入失敗');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectAnnouncement = (announcement: Announcement) => {
    setSelectedId(announcement.id);
    setDraft(announcementToDraft(announcement));
    setError('');
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setError('');
  };

  const save = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    setSaving(true);
    setError('');
    try {
      const saved = selectedId
        ? await adminUpdateAnnouncement(selectedId, draft)
        : await adminCreateAnnouncement(draft);
      setSelectedId(saved.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '公告儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm('確定刪除這則公告？')) return;
    setSaving(true);
    try {
      await adminDeleteAnnouncement(selectedId);
      startNew();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '公告刪除失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Panel className="min-w-0" size="md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-accent-primary" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold">公告</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={startNew}>
            <Plus className="size-4" aria-hidden="true" />
            新增
          </Button>
        </div>
        {loading ? (
          <LoadingState className="mt-4" label="載入公告" />
        ) : (
          <div className="mt-4 grid max-h-[60vh] gap-1 overflow-y-auto">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-sm border px-3 py-2 text-left ${selectedId === item.id ? 'border-accent-primary bg-accent-primary/10' : 'border-border-soft bg-surface-base/40'}`}
                onClick={() => selectAnnouncement(item)}
              >
                <strong className="block truncate text-body">{item.title}</strong>
                <span className="mt-1 block text-caption text-content-dim">
                  {item.status} · v{item.contentVersion}
                </span>
              </button>
            ))}
            {items.length === 0 && <p className="text-caption text-content-dim">尚無公告</p>}
          </div>
        )}
      </Panel>

      <Panel className="min-w-0" size="lg">
        <div className="grid gap-4">
          <FormField label="標題">
            <Input
              value={draft.title}
              maxLength={300}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </FormField>
          <FormField label="內容">
            <Textarea
              value={draft.content}
              rows={10}
              maxLength={10000}
              onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="來源語言">
              <Select
                value={draft.sourceLanguage}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sourceLanguage: event.target.value as AnnouncementInput['sourceLanguage'],
                  }))
                }
              >
                <option value="zh-tw">繁體中文</option>
                <option value="zh-cn">简体中文</option>
                <option value="zh-hk">廣東話</option>
                <option value="ja">日本語</option>
                <option value="en">English</option>
                <option value="ko">한국어</option>
              </Select>
            </FormField>
            <FormField label="狀態">
              <Select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as AnnouncementInput['status'],
                  }))
                }
              >
                <option value="draft">草稿</option>
                <option value="published">發布</option>
                <option value="archived">封存</option>
              </Select>
            </FormField>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            {selectedId && (
              <Button variant="danger" onClick={() => void remove()} disabled={saving}>
                <Trash2 className="size-4" aria-hidden="true" />
                刪除
              </Button>
            )}
            <Button onClick={() => void save()} disabled={saving || !draft.title.trim() || !draft.content.trim()}>
              <Save className="size-4" aria-hidden="true" />
              {saving ? '儲存中' : '儲存'}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
