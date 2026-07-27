import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type SynergyReviewStatus = 'candidate' | 'approved' | 'rejected' | 'needs_changes';

export type SynergyHumanReview = {
  status: SynergyReviewStatus;
  rationale: string;
  notes: string;
  reviewedAt: string;
};

type CandidateRelation = {
  sourceCardId: string;
  targetCardId: string;
  kind: 'enables' | 'conflicts';
  rationale: string;
  [key: string]: unknown;
};

type CandidateFile = {
  summary: Record<string, unknown>;
  groups: Array<{
    id: string;
    rationale: string;
    enablerCardIds: string[];
    payoffCardIds: string[];
    [key: string]: unknown;
  }>;
  relations: CandidateRelation[];
  profiles: Array<{ cardId: string; [key: string]: unknown }>;
};

type ReviewLedger = {
  schemaVersion: 1;
  reviews: Record<string, SynergyHumanReview>;
  groupReviews: Record<string, SynergyHumanReview>;
};

type CardNamesFile = { cards: Record<string, Record<string, string>> };
type CardEffectsFile = Record<string, Record<string, string>>;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const candidatePath = path.join(repoRoot, 'data', 'card-synergy-candidates.json');
const ledgerPath = path.join(repoRoot, 'data', 'card-synergy-human-reviews.json');
const uiPath = path.join(repoRoot, 'tools', 'card-synergy-review', 'index.html');
const host = '127.0.0.1';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(argument('--port') || process.env.CARD_SYNERGY_REVIEW_PORT || 4177);

export function relationKey(relation: Pick<CandidateRelation, 'kind' | 'sourceCardId' | 'targetCardId'>): string {
  return `${relation.kind}:${relation.sourceCardId}:${relation.targetCardId}`;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function optionalJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? readJson<T>(file) : fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function reviewDisplayProfile(
  profile: Record<string, unknown>,
  localizedName = '',
  localizedEffect = '',
): Record<string, unknown> {
  const cardId = text(profile.cardId);
  const cardNameJa = text(profile.cardName);
  const cardEffectJa = text(profile.cardEffect);
  return {
    ...profile,
    cardName: localizedName || `${cardId}（尚無校對中文名）`,
    cardNameJa,
    cardNameLocale: localizedName ? 'zh-TW' : 'missing',
    cardEffect: localizedEffect,
    cardEffectJa,
    cardEffectLocale: localizedEffect ? 'zh-TW' : 'missing',
  };
}

function reviewDisplayMaps(): { names: Record<string, string>; effects: Record<string, string> } {
  const namesFile = optionalJson<CardNamesFile>(path.join(repoRoot, 'data', 'card-names-i18n.json'), { cards: {} });
  const effectsFile = optionalJson<CardEffectsFile>(path.join(repoRoot, 'data', 'card-effects-i18n.json'), {});
  return {
    names: Object.fromEntries(
      Object.entries(namesFile.cards).flatMap(([cardId, values]) =>
        text(values['zh-TW']) ? [[cardId, text(values['zh-TW'])]] : [],
      ),
    ),
    effects: Object.fromEntries(
      Object.entries(effectsFile).flatMap(([cardId, values]) =>
        text(values['zh-TW']) ? [[cardId, text(values['zh-TW'])]] : [],
      ),
    ),
  };
}

function replaceJapaneseCardNames(
  value: string,
  profiles: Record<string, Record<string, unknown>>,
  cardIds: string[],
): string {
  return cardIds
    .map((cardId) => profiles[cardId])
    .filter((profile): profile is Record<string, unknown> => Boolean(profile))
    .filter((profile) => text(profile.cardNameJa) && text(profile.cardNameJa) !== text(profile.cardName))
    .sort((left, right) => text(right.cardNameJa).length - text(left.cardNameJa).length)
    .reduce((result, profile) => result.replaceAll(text(profile.cardNameJa), text(profile.cardName)), value);
}

function writeJsonAtomic(file: string, value: unknown): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function loadCandidates(): CandidateFile {
  if (!fs.existsSync(candidatePath)) {
    throw new Error('Missing candidate graph. Run npm run analyze:card-synergies first.');
  }
  const candidates = readJson<CandidateFile>(candidatePath);
  if (!Array.isArray(candidates.relations) || !Array.isArray(candidates.profiles)) {
    throw new Error('Invalid card synergy candidate graph.');
  }
  return candidates;
}

function loadLedger(): ReviewLedger {
  if (!fs.existsSync(ledgerPath)) return { schemaVersion: 1, reviews: {}, groupReviews: {} };
  const ledger = readJson<ReviewLedger>(ledgerPath);
  if (ledger.schemaVersion !== 1 || !ledger.reviews || typeof ledger.reviews !== 'object') {
    throw new Error('Invalid card synergy review ledger.');
  }
  return { ...ledger, groupReviews: ledger.groupReviews ?? {} };
}

function reviewText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${label} is too long`);
  return result;
}

export function applySynergyReview(
  relation: Pick<CandidateRelation, 'rationale'>,
  request: Partial<Omit<SynergyHumanReview, 'reviewedAt'>>,
  reviewedAt = new Date().toISOString(),
): SynergyHumanReview {
  const status = request.status ?? 'candidate';
  if (!['candidate', 'approved', 'rejected', 'needs_changes'].includes(status)) {
    throw new Error('Invalid review status');
  }
  const rationale = reviewText(request.rationale ?? relation.rationale, 'rationale', 3000);
  const notes = reviewText(request.notes ?? '', 'notes', 3000);
  if (status === 'approved' && !rationale) throw new Error('Approved relations require a rationale');
  if ((status === 'rejected' || status === 'needs_changes') && !notes) {
    throw new Error('Rejected or change-requested relations require review notes');
  }
  return { status, rationale, notes, reviewedAt };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`${JSON.stringify(value)}\n`);
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function state(): Record<string, unknown> {
  const candidates = loadCandidates();
  const ledger = loadLedger();
  const display = reviewDisplayMaps();
  const profiles = Object.fromEntries(
    candidates.profiles.map((profile) => {
      const cardId = text(profile.cardId);
      return [cardId, reviewDisplayProfile(profile, display.names[cardId], display.effects[cardId])];
    }),
  );
  const relations = candidates.relations.map((relation) => {
    const key = relationKey(relation);
    const rationale = replaceJapaneseCardNames(relation.rationale, profiles, [
      relation.sourceCardId,
      relation.targetCardId,
    ]);
    return {
      ...relation,
      rationale,
      key,
      review: ledger.reviews[key] ?? {
        status: 'candidate',
        rationale,
        notes: '',
        reviewedAt: '',
      },
    };
  });
  const reviewValues = relations.map((relation) => relation.review as SynergyHumanReview);
  const groups = candidates.groups.map((group) => ({
    ...group,
    rationale: replaceJapaneseCardNames(group.rationale, profiles, [...group.enablerCardIds, ...group.payoffCardIds]),
    review: ledger.groupReviews[group.id] ?? {
      status: 'candidate',
      rationale: replaceJapaneseCardNames(group.rationale, profiles, [...group.enablerCardIds, ...group.payoffCardIds]),
      notes: '',
      reviewedAt: '',
    },
  }));
  return {
    generatedSummary: candidates.summary,
    reviewSummary: {
      total: relations.length,
      approved: reviewValues.filter((review) => review.status === 'approved').length,
      rejected: reviewValues.filter((review) => review.status === 'rejected').length,
      needsChanges: reviewValues.filter((review) => review.status === 'needs_changes').length,
      pending: reviewValues.filter((review) => review.status === 'candidate').length,
    },
    groupReviewSummary: currentStatusSummary(groups.map((group) => group.review.status)),
    groups,
    profiles,
    relations,
  };
}

function currentStatusSummary(statuses: SynergyReviewStatus[]): Record<string, number> {
  return {
    total: statuses.length,
    approved: statuses.filter((status) => status === 'approved').length,
    rejected: statuses.filter((status) => status === 'rejected').length,
    needsChanges: statuses.filter((status) => status === 'needs_changes').length,
    pending: statuses.filter((status) => status === 'candidate').length,
  };
}

function currentReviewSummary(candidates: CandidateFile, ledger: ReviewLedger): Record<string, number> {
  const statuses = candidates.relations.map(
    (relation) => ledger.reviews[relationKey(relation)]?.status ?? ('candidate' as const),
  );
  return currentStatusSummary(statuses);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(fs.readFileSync(uiPath));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, state());
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/review/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/review/'.length));
      const candidates = loadCandidates();
      const relation = candidates.relations.find((candidate) => relationKey(candidate) === key);
      if (!relation) {
        sendJson(response, 404, { error: 'Relation not found in the current candidate graph' });
        return;
      }
      const body = await requestBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid review payload');
      const ledger = loadLedger();
      const review = applySynergyReview(relation, body as Partial<SynergyHumanReview>);
      ledger.reviews[key] = review;
      writeJsonAtomic(ledgerPath, ledger);
      sendJson(response, 200, { review, reviewSummary: currentReviewSummary(candidates, ledger) });
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/group-review/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/group-review/'.length));
      const candidates = loadCandidates();
      const group = candidates.groups.find((candidate) => candidate.id === id);
      if (!group) {
        sendJson(response, 404, { error: 'Group not found in the current candidate graph' });
        return;
      }
      const body = await requestBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid review payload');
      const ledger = loadLedger();
      const review = applySynergyReview(group, body as Partial<SynergyHumanReview>);
      ledger.groupReviews[id] = review;
      writeJsonAtomic(ledgerPath, ledger);
      sendJson(response, 200, {
        review,
        groupReviewSummary: currentStatusSummary(
          candidates.groups.map((candidate) => ledger.groupReviews[candidate.id]?.status ?? 'candidate'),
        ),
      });
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, host, () => {
    console.log(`Card synergy review tool: http://${host}:${port}/`);
    console.log('Reviews stay local; this tool does not write PostgreSQL or upload assets.');
  });
}
