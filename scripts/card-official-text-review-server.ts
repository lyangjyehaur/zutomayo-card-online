import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type VerificationStatus = 'machine_verified' | 'human_verified' | 'not_applicable' | 'needs_review' | 'missing';
export type ReviewField = 'name' | 'effect';

type HumanReview = {
  value: string;
  source: 'local-web-review';
  reviewedAt: string;
};

export type ReviewLedger = {
  schemaVersion: 1;
  reviews: Record<string, Partial<Record<ReviewField, HumanReview>>>;
};

export type ExtractionCard = {
  id: string;
  imageUrl?: string;
  japaneseName: string;
  enNameOfficial: string;
  nameStatus: VerificationStatus;
  nameVerificationSource: string;
  japaneseEffect: string;
  enEffectOfficial: string;
  effectStatus: VerificationStatus;
  effectVerificationSource: string;
  reviewReasons: string[];
  evidence: Record<string, unknown>;
};

export type Extraction = {
  schemaVersion: number;
  summary: Record<string, number>;
  cards: ExtractionCard[];
};

export type ReviewRequest = {
  confirmName?: unknown;
  confirmEffect?: unknown;
  nameText?: unknown;
  effectText?: unknown;
};

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const extractionPath = path.join(repoRoot, 'data', 'card-english-extraction.json');
const ledgerPath = path.join(repoRoot, 'data', 'card-english-human-reviews.json');
const uiPath = path.join(repoRoot, 'tools', 'card-official-text-review', 'index.html');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const host = '127.0.0.1';
const port = Number(argument('--port') || process.env.CARD_REVIEW_PORT || 4175);
const defaultImagesDir = process.platform === 'win32' ? 'C:\\tmp\\zutomayo-card-images' : '/tmp/zutomayo-card-images';
const imagesDir = path.resolve(argument('--images-dir') || process.env.CARD_REVIEW_IMAGES_DIR || defaultImagesDir);

export function summarize(cards: ExtractionCard[]): Record<string, number> {
  const effectCards = cards.filter((card) => card.japaneseEffect.trim());
  return {
    cardCount: cards.length,
    machineVerifiedNames: cards.filter((card) => card.nameStatus === 'machine_verified').length,
    humanVerifiedNames: cards.filter((card) => card.nameStatus === 'human_verified').length,
    reviewNames: cards.filter((card) => card.nameStatus === 'needs_review').length,
    missingNames: cards.filter((card) => card.nameStatus === 'missing').length,
    effectCardCount: effectCards.length,
    noEffectCardCount: cards.length - effectCards.length,
    machineVerifiedEffectCards: effectCards.filter((card) => card.effectStatus === 'machine_verified').length,
    humanVerifiedEffectCards: effectCards.filter((card) => card.effectStatus === 'human_verified').length,
    reviewEffectCards: effectCards.filter((card) => card.effectStatus === 'needs_review').length,
    missingEffectCards: effectCards.filter((card) => card.effectStatus === 'missing').length,
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadExtraction(): Extraction {
  const extraction = readJson<Extraction>(extractionPath);
  extraction.summary = summarize(extraction.cards);
  return extraction;
}

function loadLedger(): ReviewLedger {
  if (!fs.existsSync(ledgerPath)) return { schemaVersion: 1, reviews: {} };
  const ledger = readJson<ReviewLedger>(ledgerPath);
  return ledger?.reviews && typeof ledger.reviews === 'object' ? ledger : { schemaVersion: 1, reviews: {} };
}

function derivedImageUrl(cardId: string): string {
  const packByPrefix: Record<string, string> = {
    '1st': 'the-world-is-changing',
    '2nd': 'all-along-the-watchtower',
    '3rd': 'off-minor',
    '4th': 'fantasy-is-reality',
  };
  const pack = packByPrefix[cardId.split('_')[0]];
  return pack ? `https://r2.dan.tw/cards/${pack}/zutomayocard_${cardId}.jpg` : '';
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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
    if (size > 64 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReviewRequest;
}

function validatedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${label} is too long`);
  return result;
}

export function applyHumanReview(
  extraction: Extraction,
  ledger: ReviewLedger,
  cardId: string,
  request: ReviewRequest,
  reviewedAt = new Date().toISOString(),
): ExtractionCard {
  const card = extraction.cards.find((entry) => entry.id === cardId);
  if (!card) throw new Error('Card not found');
  const confirmName = request.confirmName === true;
  const confirmEffect = request.confirmEffect === true;
  if (!confirmName && !confirmEffect) throw new Error('Select at least one field to confirm');
  if (confirmEffect && !card.japaneseEffect.trim()) throw new Error('This card has no printed effect to review');

  const cardReviews = (ledger.reviews[cardId] ||= {});
  if (confirmName) {
    const value = validatedText(request.nameText, 'English name', 500);
    card.enNameOfficial = value;
    card.nameStatus = 'human_verified';
    card.nameVerificationSource = 'human-image-review';
    cardReviews.name = { value, source: 'local-web-review', reviewedAt };
  }
  if (confirmEffect) {
    const value = validatedText(request.effectText, 'English effect', 5000);
    card.enEffectOfficial = value;
    card.effectStatus = 'human_verified';
    card.effectVerificationSource = 'human-image-review';
    cardReviews.effect = { value, source: 'local-web-review', reviewedAt };
  }
  card.evidence = {
    ...card.evidence,
    humanNameReview: cardReviews.name || null,
    humanEffectReview: cardReviews.effect || null,
  };
  extraction.summary = summarize(extraction.cards);
  return card;
}

function statePayload(extraction: Extraction, ledger: ReviewLedger): unknown {
  return {
    summary: extraction.summary,
    imagesDir,
    cards: extraction.cards.map((card) => ({
      ...card,
      imageUrl: card.imageUrl || derivedImageUrl(card.id),
      humanReview: ledger.reviews[card.id] || {},
    })),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/') {
    text(res, 200, fs.readFileSync(uiPath, 'utf8'), 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const extraction = loadExtraction();
    json(res, 200, statePayload(extraction, loadLedger()));
    return;
  }
  const reviewMatch = url.pathname.match(/^\/api\/review\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'POST' && reviewMatch) {
    const extraction = loadExtraction();
    const ledger = loadLedger();
    const card = applyHumanReview(extraction, ledger, reviewMatch[1], await readBody(req));
    writeJson(ledgerPath, ledger);
    writeJson(extractionPath, extraction);
    json(res, 200, { card, summary: extraction.summary, humanReview: ledger.reviews[card.id] });
    return;
  }
  const imageMatch = url.pathname.match(/^\/images\/([A-Za-z0-9_-]+)\.jpg$/);
  if (req.method === 'GET' && imageMatch) {
    const imagePath = path.join(imagesDir, `${imageMatch[1]}.jpg`);
    if (fs.existsSync(imagePath) && path.resolve(imagePath).startsWith(`${imagesDir}${path.sep}`)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
      fs.createReadStream(imagePath).pipe(res);
      return;
    }
    const extraction = loadExtraction();
    const card = extraction.cards.find((entry) => entry.id === imageMatch[1]);
    const fallback = card?.imageUrl || derivedImageUrl(imageMatch[1]);
    if (fallback) {
      // CARD_IMAGE_POLICY_EXCEPTION: standalone localhost-only review tool; it has no app/imgproxy runtime and must inspect the canonical source image.
      res.writeHead(302, { Location: fallback });
      res.end();
      return;
    }
  }
  text(res, 404, 'Not found');
}

export function createReviewServer(): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      json(res, message === 'Card not found' ? 404 : 400, { error: message });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createReviewServer().listen(port, host, () => {
    console.log(`Card official-text review service: http://${host}:${port}`);
    console.log(`Card images: ${imagesDir}`);
  });
}
