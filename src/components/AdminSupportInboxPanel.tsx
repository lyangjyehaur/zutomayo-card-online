import { useCallback, useEffect, useState } from 'react';
import { Archive, Paperclip, RefreshCw, RotateCcw, Send } from 'lucide-react';
import {
  adminGetSupportEmail,
  adminGetSupportEmails,
  adminReplySupportEmail,
  adminUpdateSupportEmailStatus,
  type SupportEmailDetail,
  type SupportEmailStatus,
  type SupportEmailSummary,
} from '../api/client';
import {
  Alert,
  Badge,
  Button,
  DataListCell,
  DataListTable,
  EmptyState,
  FormField,
  LoadingState,
  SegmentedControl,
  Textarea,
} from '../ui';

type InboxFilter = SupportEmailStatus | 'all';

const filters: ReadonlyArray<{ value: InboxFilter; label: string }> = [
  { value: 'open', label: '待處理' },
  { value: 'replied', label: '已回覆' },
  { value: 'archived', label: '已封存' },
  { value: 'all', label: '全部' },
];

function statusBadge(status: SupportEmailStatus) {
  if (status === 'replied') return <Badge tone="jade">已回覆</Badge>;
  if (status === 'archived') return <Badge>已封存</Badge>;
  return <Badge tone="gold">待處理</Badge>;
}

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function AdminSupportInboxPanel({ token }: { token: string }) {
  const [filter, setFilter] = useState<InboxFilter>('open');
  const [emails, setEmails] = useState<SupportEmailSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<SupportEmailDetail | null>(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [webhookConfigured, setWebhookConfigured] = useState(true);
  const [sender, setSender] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadDetail = useCallback(
    async (emailId: string) => {
      setSelectedId(emailId);
      setDetailLoading(true);
      setError('');
      try {
        setDetail(await adminGetSupportEmail(token, emailId));
      } catch (reason) {
        setDetail(null);
        setError(reason instanceof Error ? reason.message : '郵件內容載入失敗');
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  const refresh = useCallback(
    async (sync = true) => {
      setLoading(true);
      setError('');
      try {
        const response = await adminGetSupportEmails(token, filter, sync);
        setEmails(response.emails);
        setConfigured(response.configured);
        setWebhookConfigured(response.webhookConfigured);
        setSender(response.sender);
        if (response.syncError) setError(response.syncError);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '聯絡信箱載入失敗');
      } finally {
        setLoading(false);
      }
    },
    [filter, token],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const sendReply = async () => {
    if (!detail || !reply.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await adminReplySupportEmail(token, detail.id, reply);
      setReply('');
      setNotice('回覆已透過 Resend 寄出，並保留在同一郵件討論串。');
      await refresh(false);
      await loadDetail(detail.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '郵件寄送失敗');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: SupportEmailStatus) => {
    if (!detail) return;
    setSaving(true);
    setError('');
    try {
      await adminUpdateSupportEmailStatus(token, detail.id, status);
      setNotice(status === 'archived' ? '郵件已封存。' : '郵件已重新開啟。');
      await refresh(false);
      if (filter === 'all' || filter === status) await loadDetail(detail.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '狀態更新失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      {!configured && (
        <Alert tone="danger">
          尚未設定 RESEND_API_KEY；管理頁無法同步既有郵件或寄出回覆。設定後重新整理即可匯入目前收件。
        </Alert>
      )}
      {configured && !webhookConfigured && (
        <Alert tone="warning">
          尚未設定 RESEND_WEBHOOK_SECRET。目前仍可手動同步與回覆，但新郵件不會即時進入管理頁。
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={filters}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setSelectedId('');
            setDetail(null);
            setNotice('');
          }}
          ariaLabel="聯絡信箱狀態"
          behavior="tabs"
          size="sm"
        />
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => void refresh(true)}>
          <RefreshCw className={`size-4${loading ? ' animate-spin' : ''}`} aria-hidden="true" />
          同步 Resend
        </Button>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(24rem,0.9fr)_minmax(0,1.3fr)]">
        <section className="min-w-0 overflow-hidden rounded-sm border border-border-soft bg-surface-panel">
          {loading ? (
            <LoadingState label="同步聯絡信箱…" />
          ) : emails.length === 0 ? (
            <EmptyState title="目前沒有郵件" description="切換狀態或同步 Resend 再查看。" />
          ) : (
            <DataListTable className="admin-responsive-table">
              <thead>
                <tr>
                  <th>寄件者／主旨</th>
                  <th>狀態</th>
                  <th>收到時間</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <tr key={email.id} className={selectedId === email.id ? 'bg-accent-primary/5' : undefined}>
                    <DataListCell label="寄件者／主旨">
                      <div className="grid min-w-0 gap-1">
                        <strong className="truncate text-content-primary">{email.sender}</strong>
                        <span className="truncate text-body-sm text-content-muted">{email.subject || '(無主旨)'}</span>
                        {email.attachmentCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-caption text-content-dim">
                            <Paperclip className="size-3" /> {email.attachmentCount} 個附件
                          </span>
                        )}
                      </div>
                    </DataListCell>
                    <DataListCell label="狀態">{statusBadge(email.status)}</DataListCell>
                    <DataListCell label="收到時間" className="text-body-sm">
                      {displayDate(email.receivedAt)}
                    </DataListCell>
                    <DataListCell label="操作">
                      <Button size="sm" variant="ghost" onClick={() => void loadDetail(email.id)}>
                        查看
                      </Button>
                    </DataListCell>
                  </tr>
                ))}
              </tbody>
            </DataListTable>
          )}
        </section>

        <section className="min-w-0 rounded-sm border border-border-soft bg-surface-panel p-4">
          {detailLoading ? (
            <LoadingState label="載入郵件內容…" />
          ) : !detail ? (
            <EmptyState title="選擇一封郵件" description="查看正文並直接從 contact 信箱回覆。" />
          ) : (
            <div className="grid gap-5">
              <header className="grid gap-2 border-b border-border-soft pb-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-title-md text-content-primary">{detail.subject || '(無主旨)'}</h2>
                  {statusBadge(detail.status)}
                </div>
                <dl className="grid gap-1 text-body-sm text-content-muted">
                  <div>
                    <dt className="inline text-content-dim">寄件者：</dt>{' '}
                    <dd className="inline break-all">{detail.sender}</dd>
                  </div>
                  <div>
                    <dt className="inline text-content-dim">回覆至：</dt>{' '}
                    <dd className="inline break-all">
                      {(detail.replyTo.length ? detail.replyTo : [detail.sender]).join(', ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-content-dim">收件時間：</dt>{' '}
                    <dd className="inline">{displayDate(detail.receivedAt)}</dd>
                  </div>
                </dl>
              </header>

              <article>
                <h3 className="mb-2 font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim">
                  來信內容
                </h3>
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border-soft bg-surface-canvas p-4 font-sans text-body text-content-primary">
                  {detail.body || '這封郵件沒有可顯示的純文字內容。'}
                </pre>
              </article>

              {detail.attachments.length > 0 && (
                <section>
                  <h3 className="mb-2 font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim">
                    附件
                  </h3>
                  <ul className="grid gap-2 text-body-sm text-content-muted">
                    {detail.attachments.map((attachment, index) => (
                      <li key={attachment.id || `${attachment.filename}-${index}`} className="flex items-center gap-2">
                        <Paperclip className="size-4" />
                        <span>{attachment.filename || `附件 ${index + 1}`}</span>
                        {attachment.size ? (
                          <span className="text-content-dim">({Math.ceil(attachment.size / 1024)} KB)</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {detail.replies.length > 0 && (
                <section className="grid gap-3">
                  <h3 className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim">
                    已寄出的回覆
                  </h3>
                  {detail.replies.map((sentReply) => (
                    <article
                      key={sentReply.id}
                      className="rounded-sm border border-accent-success/30 bg-accent-success/5 p-3"
                    >
                      <div className="mb-2 flex flex-wrap justify-between gap-2 text-caption text-content-dim">
                        <span>寄至 {sentReply.recipients.join(', ')}</span>
                        <time>{displayDate(sentReply.sentAt)}</time>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-body text-content-primary">
                        {sentReply.textBody}
                      </p>
                    </article>
                  ))}
                </section>
              )}

              <form
                className="grid gap-3 border-t border-border-soft pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply();
                }}
              >
                <FormField
                  label="回覆內容"
                  hint={`將由 ${sender || 'contact 信箱'} 寄出；收件者固定取原信 Reply-To／From。`}
                >
                  <Textarea
                    className="min-h-40"
                    maxLength={20_000}
                    placeholder="輸入回覆內容…"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                  />
                </FormField>
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {detail.status === 'archived' ? (
                      <Button size="sm" variant="secondary" disabled={saving} onClick={() => void updateStatus('open')}>
                        <RotateCcw className="size-4" /> 重新開啟
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => void updateStatus('archived')}>
                        <Archive className="size-4" /> 封存
                      </Button>
                    )}
                  </div>
                  <Button type="submit" size="sm" disabled={saving || !configured || !reply.trim()}>
                    <Send className="size-4" /> {saving ? '寄送中…' : '寄出回覆'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
