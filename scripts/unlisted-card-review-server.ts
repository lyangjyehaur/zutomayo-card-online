import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { toHalfwidthAscii } from './reviewTextNormalization';

export type ImageReviewStatus = 'needs_review' | 'approved' | 'needs_better_image' | 'rejected';
export type TextReviewStatus = 'draft' | 'verified';
export type PrintedEffectStatus = 'unknown' | 'present' | 'none';
export type ReviewPlayStatus = 'playable' | 'display_only' | 'disabled';

type SourceCard = {
  candidateId: string;
  expectedCardId?: string;
  name: string;
  pack: string;
  catalogStatus: 'pending_listing' | 'unlisted';
  distributionType: string;
  sourcePageUrl: string;
  sourceImageUrl: string;
  localImagePath: string;
  sourceSha256: string;
};

type SourceManifest = {
  schemaVersion: number;
  cardCount: number;
  cards: SourceCard[];
};

type MachineSuggestion = {
  review: Partial<UnlistedCardReview>;
  evidence: {
    engine: string;
    imageWidth: number;
    imageHeight: number;
    ocrLines: Array<{ text: string; confidence: number; x: number; y: number }>;
    note: string;
  };
};

type MachineSuggestionFile = {
  schemaVersion: 1;
  cardCount: number;
  cards: Record<string, MachineSuggestion>;
};

export type UnlistedCardReview = {
  cardId: string;
  printedNumber: string;
  nameJa: string;
  nameEnOfficial: string;
  effectJa: string;
  effectEnOfficial: string;
  printedEffectStatus: PrintedEffectStatus;
  playStatus: ReviewPlayStatus;
  playStatusReason: string;
  type: string;
  rarity: string;
  element: string;
  clock: string;
  powerCost: string;
  sendToPower: string;
  attackNight: string;
  attackDay: string;
  song: string;
  illustrator: string;
  pack: string;
  notes: string;
  imageReviewStatus: ImageReviewStatus;
  textReviewStatus: TextReviewStatus;
  reviewedAt: string;
};

export type UnlistedCardReviewLedger = {
  schemaVersion: 1;
  reviews: Record<string, UnlistedCardReview>;
};

type ReviewRequest = Partial<Omit<UnlistedCardReview, 'reviewedAt'>>;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'data', 'card-unlisted-sources.json');
const ledgerPath = path.join(repoRoot, 'data', 'card-unlisted-human-reviews.json');
const suggestionPath = path.join(repoRoot, 'data', 'card-unlisted-review-suggestions.json');
const uiPath = path.join(repoRoot, 'tools', 'unlisted-card-review', 'index.html');
const allowedImageRoot = path.join(repoRoot, 'data', 'vision-ocr', 'unlisted-cards');
const imageBackupRoot = path.join(allowedImageRoot, '.review-backups');
const host = '127.0.0.1';
const maxImageBytes = 20 * 1024 * 1024;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(argument('--port') || process.env.UNLISTED_CARD_REVIEW_PORT || 4176);

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJsonAtomic(file: string, value: unknown): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function loadManifest(): SourceManifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Missing local source manifest. Run npm run sync:unlisted-card-sources first.');
  }
  const manifest = readJson<SourceManifest>(manifestPath);
  if (!Array.isArray(manifest.cards) || manifest.cards.length !== 64 || manifest.cardCount !== 64) {
    throw new Error('Local source manifest must contain exactly 64 cards.');
  }
  return manifest;
}

function loadLedger(): UnlistedCardReviewLedger {
  if (!fs.existsSync(ledgerPath)) return { schemaVersion: 1, reviews: {} };
  const ledger = readJson<UnlistedCardReviewLedger>(ledgerPath);
  if (ledger?.schemaVersion !== 1 || !ledger.reviews || typeof ledger.reviews !== 'object') {
    throw new Error('Invalid local review ledger.');
  }
  return ledger;
}

function loadSuggestions(): MachineSuggestionFile {
  if (!fs.existsSync(suggestionPath)) return { schemaVersion: 1, cardCount: 0, cards: {} };
  const suggestions = readJson<MachineSuggestionFile>(suggestionPath);
  if (suggestions?.schemaVersion !== 1 || !suggestions.cards || typeof suggestions.cards !== 'object') {
    throw new Error('Invalid local machine-suggestion file.');
  }
  return suggestions;
}

function defaultReview(card: SourceCard, suggestion?: MachineSuggestion): UnlistedCardReview {
  const fourthSetNumber = card.expectedCardId?.match(/^4th_(10[5-7])$/)?.[1];
  const fourthSetType = card.candidateId === '4th_105' ? 'Character' : fourthSetNumber ? 'Enchant' : '';
  const defaults: UnlistedCardReview = {
    cardId: card.expectedCardId || '',
    printedNumber: fourthSetNumber ? `${fourthSetNumber}/104` : '',
    nameJa: card.name,
    nameEnOfficial: '',
    effectJa: '',
    effectEnOfficial: '',
    printedEffectStatus: 'unknown',
    playStatus: 'disabled',
    playStatusReason: '',
    type: fourthSetType,
    rarity: card.expectedCardId ? 'SE' : '',
    element: '',
    clock: '',
    powerCost: '',
    sendToPower: '',
    attackNight: card.candidateId === '4th_105' ? '0' : '',
    attackDay: card.candidateId === '4th_105' ? '250' : '',
    song: '',
    illustrator: '',
    pack: card.pack,
    notes: '',
    imageReviewStatus: 'needs_review',
    textReviewStatus: 'draft',
    reviewedAt: '',
  };
  return {
    ...defaults,
    ...suggestion?.review,
    imageReviewStatus: 'needs_review',
    textReviewStatus: 'draft',
    reviewedAt: '',
  };
}

function effectiveReview(
  card: SourceCard,
  ledger: UnlistedCardReviewLedger,
  suggestions: MachineSuggestionFile,
): UnlistedCardReview {
  const review = {
    ...defaultReview(card, suggestions.cards[card.candidateId]),
    ...ledger.reviews[card.candidateId],
  };
  return {
    ...review,
    cardId: withoutPromoPrefix(review.cardId),
    effectEnOfficial: toHalfwidthAscii(review.effectEnOfficial),
  };
}

function textValue(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${label} is too long`);
  return result;
}

function withoutPromoPrefix(value: string): string {
  return value.replace(/^promo_/iu, '');
}

function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Invalid ${label}`);
  return value as T;
}

function validateInteger(value: string, label: string, required: boolean): void {
  if (!value && !required) return;
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} must be an integer`);
}

export function applyUnlistedCardReview(
  card: SourceCard,
  previous: UnlistedCardReview | undefined,
  request: ReviewRequest,
  reviewedAt = new Date().toISOString(),
): UnlistedCardReview {
  const base = previous || defaultReview(card);
  const next: UnlistedCardReview = {
    cardId: withoutPromoPrefix(textValue(request.cardId ?? base.cardId, 'card ID', 100)),
    printedNumber: textValue(request.printedNumber ?? base.printedNumber, 'printed number', 100),
    nameJa: textValue(request.nameJa ?? base.nameJa, 'Japanese name', 500),
    nameEnOfficial: textValue(request.nameEnOfficial ?? base.nameEnOfficial, 'official English name', 500),
    effectJa: textValue(request.effectJa ?? base.effectJa, 'Japanese effect', 5000),
    effectEnOfficial: toHalfwidthAscii(
      textValue(request.effectEnOfficial ?? base.effectEnOfficial, 'official English effect', 5000),
    ),
    printedEffectStatus: enumValue(
      request.printedEffectStatus ?? base.printedEffectStatus ?? 'unknown',
      'printed effect status',
      ['unknown', 'present', 'none'] as const,
    ),
    playStatus: enumValue(request.playStatus ?? base.playStatus ?? 'disabled', 'play status', [
      'playable',
      'display_only',
      'disabled',
    ] as const),
    playStatusReason: textValue(request.playStatusReason ?? base.playStatusReason ?? '', 'play status reason', 2000),
    type: textValue(request.type ?? base.type, 'card type', 100),
    rarity: textValue(request.rarity ?? base.rarity, 'rarity', 100),
    element: textValue(request.element ?? base.element, 'element', 100),
    clock: textValue(request.clock ?? base.clock, 'clock', 20),
    powerCost: textValue(request.powerCost ?? base.powerCost, 'Power Cost', 20),
    sendToPower: textValue(request.sendToPower ?? base.sendToPower, 'SEND TO POWER', 20),
    attackNight: textValue(request.attackNight ?? base.attackNight, 'night attack', 20),
    attackDay: textValue(request.attackDay ?? base.attackDay, 'day attack', 20),
    song: textValue(request.song ?? base.song, 'song', 500),
    illustrator: textValue(request.illustrator ?? base.illustrator, 'illustrator', 500),
    pack: textValue(request.pack ?? base.pack, 'pack', 500),
    notes: textValue(request.notes ?? base.notes, 'notes', 5000),
    imageReviewStatus: enumValue(request.imageReviewStatus ?? base.imageReviewStatus, 'image status', [
      'needs_review',
      'approved',
      'needs_better_image',
      'rejected',
    ] as const),
    textReviewStatus: enumValue(request.textReviewStatus ?? base.textReviewStatus, 'text status', [
      'draft',
      'verified',
    ] as const),
    reviewedAt,
  };

  const isCharacter = next.type === 'Character';
  validateInteger(next.clock, 'clock', next.textReviewStatus === 'verified');
  validateInteger(next.powerCost, 'Power Cost', next.textReviewStatus === 'verified');
  validateInteger(next.sendToPower, 'SEND TO POWER', next.textReviewStatus === 'verified');
  validateInteger(next.attackNight, 'night attack', next.textReviewStatus === 'verified' && isCharacter);
  validateInteger(next.attackDay, 'day attack', next.textReviewStatus === 'verified' && isCharacter);

  if (next.textReviewStatus === 'verified') {
    const required = [
      ['card ID', next.cardId],
      ['printed number', next.printedNumber],
      ['Japanese name', next.nameJa],
      ['official English name', next.nameEnOfficial],
      ['card type', next.type],
      ['rarity', next.rarity],
      ['element', next.element],
      ['pack', next.pack],
    ].find(([, value]) => !value);
    if (required) throw new Error(`${required[0]} is required before verifying text`);
    if (!['Character', 'Enchant', 'Area Enchant'].includes(next.type)) throw new Error('Invalid card type');
    if (next.printedEffectStatus === 'unknown') {
      throw new Error('printed effect status is required before verifying text');
    }
    if (next.printedEffectStatus === 'present' && (!next.effectJa || !next.effectEnOfficial)) {
      throw new Error('Japanese and official English effects are required when the card has a printed effect');
    }
    if (next.printedEffectStatus === 'none' && (next.effectJa || next.effectEnOfficial)) {
      throw new Error('Effect text must be empty when the card has no printed effect');
    }
    if (next.playStatus !== 'playable' && !next.playStatusReason) {
      throw new Error('play status reason is required for display-only or disabled cards');
    }
  }
  return next;
}

function summary(
  manifest: SourceManifest,
  ledger: UnlistedCardReviewLedger,
  suggestions: MachineSuggestionFile,
): Record<string, number> {
  const reviews = manifest.cards.map((card) => effectiveReview(card, ledger, suggestions));
  return {
    total: reviews.length,
    textVerified: reviews.filter((review) => review.textReviewStatus === 'verified').length,
    imageApproved: reviews.filter((review) => review.imageReviewStatus === 'approved').length,
    needsBetterImage: reviews.filter((review) => review.imageReviewStatus === 'needs_better_image').length,
    readyForFutureUpload: reviews.filter(
      (review) => review.textReviewStatus === 'verified' && review.imageReviewStatus === 'approved',
    ).length,
  };
}

function statePayload(
  manifest: SourceManifest,
  ledger: UnlistedCardReviewLedger,
  suggestions: MachineSuggestionFile,
): unknown {
  return {
    summary: summary(manifest, ledger, suggestions),
    ledgerPath,
    cards: manifest.cards.map((card) => ({
      ...card,
      review: effectiveReview(card, ledger, suggestions),
      machineSuggestion: suggestions.cards[card.candidateId] || null,
      imageUrl: `/images/${encodeURIComponent(card.candidateId)}?v=${card.sourceSha256.slice(0, 12)}`,
    })),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<ReviewRequest> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 128 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReviewRequest;
}

async function readBinaryBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxImageBytes) throw new Error('Image is too large (maximum 20 MB)');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('Image file is empty');
  return Buffer.concat(chunks);
}

export function detectReviewImageExtension(image: Buffer): '.jpg' | '.png' | '.webp' {
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return '.jpg';
  if (
    image.length >= 8 &&
    image[0] === 0x89 &&
    image[1] === 0x50 &&
    image[2] === 0x4e &&
    image[3] === 0x47 &&
    image[4] === 0x0d &&
    image[5] === 0x0a &&
    image[6] === 0x1a &&
    image[7] === 0x0a
  ) {
    return '.png';
  }
  if (
    image.length >= 12 &&
    image.subarray(0, 4).toString('ascii') === 'RIFF' &&
    image.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  throw new Error('Only JPEG, PNG, and WebP card images are supported');
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function replaceReviewImage(
  card: SourceCard,
  manifest: SourceManifest,
  image: Buffer,
): { imageUrl: string; sha256: string } {
  const extension = detectReviewImageExtension(image);
  const previousPath = path.resolve(repoRoot, card.localImagePath);
  if (!previousPath.startsWith(`${allowedImageRoot}${path.sep}`) || !fs.existsSync(previousPath)) {
    throw new Error('Local card image not found');
  }

  fs.mkdirSync(imageBackupRoot, { recursive: true });
  const backupPath = path.join(
    imageBackupRoot,
    `${card.candidateId}-${safeTimestamp()}${path.extname(previousPath).toLowerCase() || '.jpg'}`,
  );
  fs.copyFileSync(previousPath, backupPath);

  const nextPath = path.join(allowedImageRoot, `${card.candidateId}${extension}`);
  const temporaryPath = `${nextPath}.tmp`;
  fs.writeFileSync(temporaryPath, image);
  fs.renameSync(temporaryPath, nextPath);

  const sha256 = createHash('sha256').update(image).digest('hex');
  card.localImagePath = path.relative(repoRoot, nextPath).split(path.sep).join('/');
  card.sourceSha256 = sha256;
  writeJsonAtomic(manifestPath, manifest);
  return { imageUrl: `/images/${encodeURIComponent(card.candidateId)}?v=${sha256.slice(0, 12)}`, sha256 };
}

function contentType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/') {
    text(res, 200, fs.readFileSync(uiPath, 'utf8'), 'text/html; charset=utf-8');
    return;
  }

  const manifest = loadManifest();
  if (req.method === 'GET' && url.pathname === '/api/state') {
    json(res, 200, statePayload(manifest, loadLedger(), loadSuggestions()));
    return;
  }

  const imageUploadMatch = url.pathname.match(/^\/api\/image\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'POST' && imageUploadMatch) {
    const card = manifest.cards.find((entry) => entry.candidateId === imageUploadMatch[1]);
    if (!card) throw new Error('Card not found');
    const replacement = replaceReviewImage(card, manifest, await readBinaryBody(req));
    const ledger = loadLedger();
    const suggestions = loadSuggestions();
    const review = effectiveReview(card, ledger, suggestions);
    const nextReview = { ...review, imageReviewStatus: 'needs_review' as const, reviewedAt: new Date().toISOString() };
    ledger.reviews[card.candidateId] = nextReview;
    writeJsonAtomic(ledgerPath, ledger);
    json(res, 200, {
      imageUrl: replacement.imageUrl,
      sha256: replacement.sha256,
      localImagePath: card.localImagePath,
      review: nextReview,
      summary: summary(manifest, ledger, suggestions),
    });
    return;
  }

  const reviewMatch = url.pathname.match(/^\/api\/review\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'POST' && reviewMatch) {
    const card = manifest.cards.find((entry) => entry.candidateId === reviewMatch[1]);
    if (!card) throw new Error('Card not found');
    const ledger = loadLedger();
    const suggestions = loadSuggestions();
    const review = applyUnlistedCardReview(card, effectiveReview(card, ledger, suggestions), await readBody(req));
    ledger.reviews[card.candidateId] = review;
    writeJsonAtomic(ledgerPath, ledger);
    json(res, 200, { review, summary: summary(manifest, ledger, suggestions) });
    return;
  }

  const imageMatch = url.pathname.match(/^\/images\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && imageMatch) {
    const card = manifest.cards.find((entry) => entry.candidateId === imageMatch[1]);
    if (!card) throw new Error('Card not found');
    const imagePath = path.resolve(repoRoot, card.localImagePath);
    if (!imagePath.startsWith(`${allowedImageRoot}${path.sep}`) || !fs.existsSync(imagePath)) {
      throw new Error('Local card image not found');
    }
    res.writeHead(200, { 'Content-Type': contentType(imagePath), 'Cache-Control': 'no-store' });
    fs.createReadStream(imagePath).pipe(res);
    return;
  }
  text(res, 404, 'Not found');
}

export function createUnlistedCardReviewServer(): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      json(res, message === 'Card not found' ? 404 : 400, { error: message });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createUnlistedCardReviewServer().listen(port, host, () => {
    console.log(`Unlisted-card review service: http://${host}:${port}`);
    console.log('Local-only review: this tool never uploads images or writes to PostgreSQL.');
    console.log(`Review ledger: ${ledgerPath}`);
  });
}
