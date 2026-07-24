import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Play, Plus, RefreshCw, Scale, Square } from 'lucide-react';
import {
  adminActivateSeason,
  adminCloseSeason,
  adminCreateLegalHold,
  adminCreateSeason,
  adminGetLegalHolds,
  adminGetSeasons,
  adminReleaseLegalHold,
  type AdminSeason,
  type LegalHold,
  type LegalHoldSubjectType,
} from '../api/client';
import { t } from '../i18n';
import {
  Alert,
  Badge,
  Button,
  DataListCell,
  DataListTable,
  Dialog,
  EmptyState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  Panel,
  Select,
  SegmentedControl,
  Textarea,
} from '../ui';

const SUBJECT_TYPES: LegalHoldSubjectType[] = ['account', 'match', 'conversation', 'message', 'report', 'feedback'];

type HoldStatus = 'active' | 'released' | 'expired' | 'all';
const SEASONS_UI_ENABLED = false;

function adminRoleFromToken(token: string): string {
  try {
    const encoded = token.split('.')[1] || '';
    const base64 = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(base64)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : '';
  } catch {
    return '';
  }
}

function subjectTypeLabel(subjectType: LegalHoldSubjectType): string {
  return t(`operations.subject.${subjectType}` as Parameters<typeof t>[0]);
}

function seasonStatusTone(status: string): 'jade' | 'gold' | 'neutral' {
  if (status === 'active') return 'jade';
  if (status === 'scheduled') return 'gold';
  return 'neutral';
}

export function AdminOperationsPanel({ token }: { token: string }) {
  const adminRole = adminRoleFromToken(token);
  const canManageSeasons = adminRole === 'operator' || adminRole === 'admin';
  const canReadLegalHolds = adminRole === 'operator' || adminRole === 'admin';
  const canManageLegalHolds = adminRole === 'admin';
  const [seasons, setSeasons] = useState<AdminSeason[]>([]);
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [holdStatus, setHoldStatus] = useState<HoldStatus>('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [releaseTarget, setReleaseTarget] = useState<LegalHold | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  const [seasonDraft, setSeasonDraft] = useState({
    id: '',
    name: '',
    startsAt: '',
    endsAt: '',
    startingRating: '1000',
    placementMatches: '5',
    ratingDecayPercent: '25',
    rulesVersion: 'current',
    rewardTiers: '[{"id":"champion","maxRank":1,"payload":{}}]',
  });
  const [holdDraft, setHoldDraft] = useState({
    subjectType: 'account' as LegalHoldSubjectType,
    subjectId: '',
    owner: '',
    reason: '',
    expiresAt: '',
    caseReference: '',
  });

  const refreshSeasons = useCallback(async () => {
    setSeasons(await adminGetSeasons(token));
  }, [token]);

  const refreshHolds = useCallback(async () => {
    if (!canReadLegalHolds) {
      setHolds([]);
      return;
    }
    setHolds(await adminGetLegalHolds(token, holdStatus));
  }, [canReadLegalHolds, holdStatus, token]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([...(SEASONS_UI_ENABLED ? [refreshSeasons()] : []), refreshHolds()]);
    } catch {
      setError(t('operations.loadError'));
    } finally {
      setLoading(false);
    }
  }, [refreshHolds, refreshSeasons]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleCreateSeason = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving('season:create');
    setError('');
    try {
      const tiers = JSON.parse(seasonDraft.rewardTiers) as unknown;
      if (!Array.isArray(tiers)) throw new Error('invalid reward tiers');
      await adminCreateSeason(token, {
        id: seasonDraft.id.trim(),
        name: seasonDraft.name.trim(),
        startsAt: new Date(seasonDraft.startsAt).toISOString(),
        endsAt: new Date(seasonDraft.endsAt).toISOString(),
        startingRating: Number(seasonDraft.startingRating),
        placementMatches: Number(seasonDraft.placementMatches),
        ratingDecayPercent: Number(seasonDraft.ratingDecayPercent),
        rulesVersion: seasonDraft.rulesVersion.trim(),
        rewardConfig: {
          tiers: tiers as Array<{ id: string; maxRank: number; payload: Record<string, unknown> }>,
        },
      });
      setSeasonDraft((current) => ({ ...current, id: '', name: '', startsAt: '', endsAt: '' }));
      await refreshSeasons();
    } catch (createError) {
      setError(createError instanceof SyntaxError ? t('operations.invalidRewardConfig') : t('operations.actionError'));
    } finally {
      setSaving('');
    }
  };

  const runSeasonAction = async (season: AdminSeason, action: 'activate' | 'close') => {
    const confirmation = action === 'activate' ? t('operations.confirmActivate') : t('operations.confirmClose');
    if (!window.confirm(confirmation)) return;
    setSaving(`season:${action}:${season.id}`);
    setError('');
    try {
      if (action === 'activate') await adminActivateSeason(token, season.id);
      else await adminCloseSeason(token, season.id);
      await refreshSeasons();
    } catch {
      setError(t('operations.actionError'));
    } finally {
      setSaving('');
    }
  };

  const handleCreateHold = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving('hold:create');
    setError('');
    try {
      await adminCreateLegalHold(token, {
        subjectType: holdDraft.subjectType,
        subjectId: holdDraft.subjectId.trim(),
        owner: holdDraft.owner.trim(),
        reason: holdDraft.reason.trim(),
        expiresAt: new Date(holdDraft.expiresAt).toISOString(),
        ...(holdDraft.caseReference.trim() ? { caseReference: holdDraft.caseReference.trim() } : {}),
      });
      setHoldDraft((current) => ({ ...current, subjectId: '', reason: '', caseReference: '' }));
      await refreshHolds();
    } catch {
      setError(t('operations.actionError'));
    } finally {
      setSaving('');
    }
  };

  const handleReleaseHold = async () => {
    if (!releaseTarget || releaseReason.trim().length < 10) return;
    setSaving(`hold:release:${releaseTarget.id}`);
    setError('');
    try {
      await adminReleaseLegalHold(token, releaseTarget.id, releaseReason.trim());
      setReleaseTarget(null);
      setReleaseReason('');
      await refreshHolds();
    } catch {
      setError(t('operations.actionError'));
    } finally {
      setSaving('');
    }
  };

  if (loading) return <LoadingState className="min-h-64" label={t('profile.loading')} />;

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}
          onClick={() => void refreshAll()}
        >
          {t('common.retry')}
        </Button>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <Panel size="lg" hidden={!SEASONS_UI_ENABLED}>
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="size-5 text-accent-primary" aria-hidden="true" />
          <h2 className="font-display text-title-sm font-bold">{t('operations.seasons')}</h2>
        </div>
        {canManageSeasons && (
          <form className="grid gap-3" onSubmit={handleCreateSeason}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FormField label={t('operations.seasonId')}>
                <Input
                  required
                  pattern="[a-zA-Z0-9._:-]{3,80}"
                  maxLength={80}
                  value={seasonDraft.id}
                  onChange={(event) => setSeasonDraft((current) => ({ ...current, id: event.target.value }))}
                />
              </FormField>
              <FormField label={t('operations.seasonName')}>
                <Input
                  required
                  maxLength={120}
                  value={seasonDraft.name}
                  onChange={(event) => setSeasonDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </FormField>
              <FormField label={t('operations.startsAt')}>
                <Input
                  required
                  type="datetime-local"
                  value={seasonDraft.startsAt}
                  onChange={(event) => setSeasonDraft((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </FormField>
              <FormField label={t('operations.endsAt')}>
                <Input
                  required
                  type="datetime-local"
                  value={seasonDraft.endsAt}
                  onChange={(event) => setSeasonDraft((current) => ({ ...current, endsAt: event.target.value }))}
                />
              </FormField>
              <FormField label={t('operations.startingRating')}>
                <Input
                  required
                  type="number"
                  min={500}
                  max={3000}
                  value={seasonDraft.startingRating}
                  onChange={(event) =>
                    setSeasonDraft((current) => ({ ...current, startingRating: event.target.value }))
                  }
                />
              </FormField>
              <FormField label={t('operations.placementMatches')}>
                <Input
                  required
                  type="number"
                  min={0}
                  max={20}
                  value={seasonDraft.placementMatches}
                  onChange={(event) =>
                    setSeasonDraft((current) => ({ ...current, placementMatches: event.target.value }))
                  }
                />
              </FormField>
              <FormField label={t('operations.ratingDecay')}>
                <Input
                  required
                  type="number"
                  min={0}
                  max={100}
                  value={seasonDraft.ratingDecayPercent}
                  onChange={(event) =>
                    setSeasonDraft((current) => ({ ...current, ratingDecayPercent: event.target.value }))
                  }
                />
              </FormField>
              <FormField label={t('operations.rulesVersion')}>
                <Input
                  required
                  maxLength={64}
                  value={seasonDraft.rulesVersion}
                  onChange={(event) => setSeasonDraft((current) => ({ ...current, rulesVersion: event.target.value }))}
                />
              </FormField>
            </div>
            <FormField label={t('operations.rewardTiers')}>
              <Textarea
                required
                rows={3}
                value={seasonDraft.rewardTiers}
                onChange={(event) => setSeasonDraft((current) => ({ ...current, rewardTiers: event.target.value }))}
              />
            </FormField>
            <FormActions>
              <Button
                type="submit"
                variant="primary"
                disabled={Boolean(saving)}
                leftIcon={<Plus className="size-4" aria-hidden="true" />}
              >
                {saving === 'season:create' ? t('auth.submitting') : t('operations.createSeason')}
              </Button>
            </FormActions>
          </form>
        )}

        <div className="mt-6 overflow-x-auto">
          {seasons.length === 0 ? (
            <EmptyState title={t('operations.seasons')} description={t('common.empty')} />
          ) : (
            <DataListTable className="admin-responsive-table">
              <thead>
                <tr>
                  <th className="px-3 py-2">{t('operations.seasonName')}</th>
                  <th className="px-3 py-2">{t('operations.startsAt')}</th>
                  <th className="px-3 py-2">{t('operations.rulesVersion')}</th>
                  <th className="px-3 py-2">{t('operations.rewardTiers')}</th>
                  <th className="px-3 py-2">{t('common.confirm')}</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.id} className="odd:bg-surface-base/50">
                    <DataListCell label={t('operations.seasonName')}>
                      <strong className="block">{season.name}</strong>
                      <span className="font-mono text-caption text-content-muted">{season.id}</span>
                      <Badge className="ml-2" tone={seasonStatusTone(season.status)}>
                        {season.status}
                      </Badge>
                    </DataListCell>
                    <DataListCell label={t('operations.startsAt')}>
                      <span className="block">{new Date(season.startsAt).toLocaleString()}</span>
                      <span className="text-caption text-content-muted">
                        {new Date(season.endsAt).toLocaleString()}
                      </span>
                    </DataListCell>
                    <DataListCell label={t('operations.rulesVersion')}>{season.rulesVersion}</DataListCell>
                    <DataListCell label={t('operations.rewardTiers')}>{season.rewardConfig.tiers.length}</DataListCell>
                    <DataListCell label={t('common.confirm')}>
                      {canManageSeasons && season.status === 'scheduled' && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={Boolean(saving)}
                          leftIcon={<Play className="size-4" aria-hidden="true" />}
                          onClick={() => void runSeasonAction(season, 'activate')}
                        >
                          {t('operations.activate')}
                        </Button>
                      )}
                      {canManageSeasons && season.status === 'active' && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={Boolean(saving)}
                          leftIcon={<Square className="size-4" aria-hidden="true" />}
                          onClick={() => void runSeasonAction(season, 'close')}
                        >
                          {t('operations.close')}
                        </Button>
                      )}
                    </DataListCell>
                  </tr>
                ))}
              </tbody>
            </DataListTable>
          )}
        </div>
      </Panel>

      {canReadLegalHolds && (
        <Panel size="lg">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Scale className="size-5 text-accent-action" aria-hidden="true" />
              <h2 className="font-display text-title-sm font-bold">{t('operations.legalHolds')}</h2>
            </div>
            <SegmentedControl
              behavior="tabs"
              size="sm"
              ariaLabel={t('operations.legalHolds')}
              options={(['active', 'released', 'expired', 'all'] as const).map((status) => ({
                value: status,
                label: t(`operations.${status}` as Parameters<typeof t>[0]),
              }))}
              value={holdStatus}
              onChange={setHoldStatus}
            />
          </div>
          {canManageLegalHolds && (
            <form className="grid gap-3" onSubmit={handleCreateHold}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FormField label={t('operations.subjectType')}>
                  <Select
                    value={holdDraft.subjectType}
                    onChange={(event) =>
                      setHoldDraft((current) => ({
                        ...current,
                        subjectType: event.target.value as LegalHoldSubjectType,
                      }))
                    }
                  >
                    {SUBJECT_TYPES.map((subjectType) => (
                      <option key={subjectType} value={subjectType}>
                        {subjectTypeLabel(subjectType)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={t('operations.subjectId')}>
                  <Input
                    required
                    maxLength={300}
                    value={holdDraft.subjectId}
                    onChange={(event) => setHoldDraft((current) => ({ ...current, subjectId: event.target.value }))}
                  />
                </FormField>
                <FormField label={t('operations.owner')}>
                  <Input
                    required
                    minLength={2}
                    maxLength={120}
                    value={holdDraft.owner}
                    onChange={(event) => setHoldDraft((current) => ({ ...current, owner: event.target.value }))}
                  />
                </FormField>
                <FormField label={t('operations.expiresAt')}>
                  <Input
                    required
                    type="datetime-local"
                    value={holdDraft.expiresAt}
                    onChange={(event) => setHoldDraft((current) => ({ ...current, expiresAt: event.target.value }))}
                  />
                </FormField>
                <FormField label={t('operations.caseReference')}>
                  <Input
                    maxLength={120}
                    value={holdDraft.caseReference}
                    onChange={(event) => setHoldDraft((current) => ({ ...current, caseReference: event.target.value }))}
                  />
                </FormField>
                <FormField className="md:col-span-2 xl:col-span-3" label={t('operations.reason')}>
                  <Textarea
                    required
                    minLength={10}
                    maxLength={1000}
                    rows={2}
                    value={holdDraft.reason}
                    onChange={(event) => setHoldDraft((current) => ({ ...current, reason: event.target.value }))}
                  />
                </FormField>
              </div>
              <FormActions>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={Boolean(saving)}
                  leftIcon={<Plus className="size-4" aria-hidden="true" />}
                >
                  {saving === 'hold:create' ? t('auth.submitting') : t('operations.createLegalHold')}
                </Button>
              </FormActions>
            </form>
          )}

          <div className="mt-6 overflow-x-auto">
            {holds.length === 0 ? (
              <EmptyState title={t('operations.legalHolds')} description={t('common.empty')} />
            ) : (
              <DataListTable className="admin-responsive-table">
                <thead>
                  <tr>
                    <th className="px-3 py-2">{t('operations.subjectType')}</th>
                    <th className="px-3 py-2">{t('operations.owner')}</th>
                    <th className="px-3 py-2">{t('operations.reason')}</th>
                    <th className="px-3 py-2">{t('operations.expiresAt')}</th>
                    <th className="px-3 py-2">{t('common.confirm')}</th>
                  </tr>
                </thead>
                <tbody>
                  {holds.map((hold) => (
                    <tr key={hold.id} className="odd:bg-surface-base/50">
                      <DataListCell label={t('operations.subjectType')}>
                        <strong className="block">{subjectTypeLabel(hold.subjectType)}</strong>
                        <span className="block break-all font-mono text-caption text-content-muted">
                          {hold.subjectId}
                        </span>
                        <span className="block font-mono text-minutia text-content-dim">{hold.id}</span>
                      </DataListCell>
                      <DataListCell label={t('operations.owner')}>{hold.owner}</DataListCell>
                      <DataListCell label={t('operations.reason')}>
                        <span className="whitespace-pre-wrap break-words">{hold.reason}</span>
                        {typeof hold.metadata.caseReference === 'string' && hold.metadata.caseReference && (
                          <span className="mt-1 block font-mono text-caption text-content-muted">
                            {hold.metadata.caseReference}
                          </span>
                        )}
                      </DataListCell>
                      <DataListCell label={t('operations.expiresAt')}>
                        {hold.expiresAt ? new Date(hold.expiresAt).toLocaleString() : '-'}
                      </DataListCell>
                      <DataListCell label={t('common.confirm')}>
                        {canManageLegalHolds && !hold.releasedAt && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={Boolean(saving)}
                            onClick={() => setReleaseTarget(hold)}
                          >
                            {t('operations.release')}
                          </Button>
                        )}
                        {hold.releasedAt && <Badge tone="neutral">{t('operations.released')}</Badge>}
                      </DataListCell>
                    </tr>
                  ))}
                </tbody>
              </DataListTable>
            )}
          </div>
        </Panel>
      )}

      <Dialog
        open={Boolean(releaseTarget)}
        onOpenChange={(open) => {
          if (!open && !saving.startsWith('hold:release:')) {
            setReleaseTarget(null);
            setReleaseReason('');
          }
        }}
        title={t('operations.releaseTitle')}
        description={releaseTarget ? `${subjectTypeLabel(releaseTarget.subjectType)}: ${releaseTarget.subjectId}` : ''}
        dismissible={!saving.startsWith('hold:release:')}
        footer={
          <>
            <Button variant="secondary" disabled={Boolean(saving)} onClick={() => setReleaseTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={releaseReason.trim().length < 10 || Boolean(saving)}
              onClick={() => void handleReleaseHold()}
            >
              {saving.startsWith('hold:release:') ? t('auth.submitting') : t('operations.release')}
            </Button>
          </>
        }
      >
        <FormField label={t('operations.releaseReason')}>
          <Textarea
            required
            minLength={10}
            maxLength={1000}
            value={releaseReason}
            disabled={saving.startsWith('hold:release:')}
            onChange={(event) => setReleaseReason(event.target.value)}
          />
        </FormField>
      </Dialog>
    </div>
  );
}
