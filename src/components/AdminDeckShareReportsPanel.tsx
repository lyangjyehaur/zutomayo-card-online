import { RefreshCw, ShieldCheck, ShieldX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { adminGetDeckShareReports, adminModerateDeckShare, type DeckShareReport } from '../api/client';
import { Alert, Badge, Button, Card, EmptyState, LoadingState, SegmentedControl } from '../ui';
import { CardImage } from './CardImage';

type ReportStatus = DeckShareReport['status'];

export function AdminDeckShareReportsPanel({ token }: { token: string }) {
  const [status, setStatus] = useState<ReportStatus>('pending');
  const [reports, setReports] = useState<DeckShareReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await adminGetDeckShareReports(token, status);
      setReports(result.reports);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '無法載入牌組分享檢舉');
    } finally {
      setLoading(false);
    }
  }, [status, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const moderate = async (
    report: DeckShareReport,
    input: { moderationStatus: 'visible' | 'hidden'; reportStatus: 'resolved' | 'dismissed'; reason: string },
  ) => {
    setSavingId(report.id);
    setError('');
    try {
      await adminModerateDeckShare(token, report.shareId, {
        ...input,
        resolutionNote: `deck_share_report:${report.id}`,
      });
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '牌組分享審核失敗');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-title-sm font-bold">牌組分享審核</h2>
          <p className="mt-1 text-body-sm text-content-muted">處理公開牌組名稱、冒充、騷擾與垃圾內容檢舉。</p>
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          重新整理
        </Button>
      </header>

      <SegmentedControl
        behavior="tabs"
        size="sm"
        ariaLabel="牌組分享檢舉狀態"
        value={status}
        onChange={(value) => setStatus(value as ReportStatus)}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'reviewing', label: 'Reviewing' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'dismissed', label: 'Dismissed' },
        ]}
      />

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {loading ? (
        <LoadingState label="載入牌組分享檢舉…" />
      ) : reports.length === 0 ? (
        <EmptyState title="沒有牌組分享檢舉" description="目前篩選條件下沒有待處理項目。" />
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <Card key={report.id} className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_auto] lg:items-start">
              <div className="grid grid-cols-3 gap-2" aria-hidden="true">
                {report.share.cardIds.slice(0, 3).map((cardId) => (
                  <CardImage
                    key={cardId}
                    cardId={cardId}
                    context="thumbnail"
                    alt=""
                    className="aspect-[5/7] w-full rounded-sm object-cover ring-1 ring-border-soft"
                  />
                ))}
              </div>
              <div className="grid min-w-0 gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={report.share.moderationStatus === 'hidden' ? 'vermilion' : 'gold'}>
                    {report.share.moderationStatus}
                  </Badge>
                  <Badge tone="neutral">{report.status}</Badge>
                  <span className="font-mono text-xs text-content-muted">{report.id}</span>
                </div>
                <h3 className="break-words font-display text-lg font-bold">{report.share.name}</h3>
                <p className="text-body-sm text-content-muted">
                  作者：{report.share.ownerNickname || report.share.ownerUserId}
                </p>
                <div className="rounded-sm border-l-2 border-accent-primary bg-accent-primary/10 px-3 py-2">
                  <strong className="block text-body-sm">{report.reason}</strong>
                  {report.note && (
                    <p className="mt-1 whitespace-pre-wrap text-body-sm text-content-muted">{report.note}</p>
                  )}
                  <span className="mt-1 block font-mono text-xs text-content-muted">
                    檢舉者：{report.reporterNickname || report.reporterUserId || '已刪除帳號'}
                  </span>
                </div>
              </div>
              <div className="grid min-w-36 gap-2">
                {report.share.moderationStatus !== 'hidden' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={savingId === report.id}
                    onClick={() =>
                      void moderate(report, {
                        moderationStatus: 'hidden',
                        reportStatus: 'resolved',
                        reason: report.reason,
                      })
                    }
                  >
                    <ShieldX className="size-4" aria-hidden="true" />
                    隱藏分享
                  </Button>
                )}
                {report.share.moderationStatus === 'hidden' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={savingId === report.id}
                    onClick={() =>
                      void moderate(report, {
                        moderationStatus: 'visible',
                        reportStatus: 'resolved',
                        reason: 'manual_restored',
                      })
                    }
                  >
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    恢復分享
                  </Button>
                )}
                {report.status !== 'dismissed' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={savingId === report.id}
                    onClick={() =>
                      void moderate(report, {
                        moderationStatus: 'visible',
                        reportStatus: 'dismissed',
                        reason: 'report_dismissed',
                      })
                    }
                  >
                    駁回檢舉
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
