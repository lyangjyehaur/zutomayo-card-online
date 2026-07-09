import { getCardDef } from '../game/cards/loader';

export const CARD_IMAGE_WIDTHS = [128, 192, 320, 480, 720, 960] as const;

export type CardImageWidth = (typeof CARD_IMAGE_WIDTHS)[number];
export type CardImageFormat = 'avif' | 'webp' | 'original';
export type CardImageSourceKind = 'auto' | 'cardId' | 'url';
export type CardImageContext = 'thumbnail' | 'mobile-board' | 'board' | 'hand' | 'preview' | 'detail';

export interface CardImageUrlOptions {
  format?: CardImageFormat;
  sourceKind?: CardImageSourceKind;
}

export interface CardImageSrcSetOptions extends CardImageUrlOptions {
  widths?: readonly CardImageWidth[];
}

interface CardImageContextConfig {
  fallbackWidth: CardImageWidth;
  widths: readonly CardImageWidth[];
  sizes: string;
}

export const CARD_IMAGE_CONTEXTS: Record<CardImageContext, CardImageContextConfig> = {
  thumbnail: {
    fallbackWidth: 128,
    widths: [128, 192, 320],
    sizes: '(max-width: 640px) 22vw, 128px',
  },
  'mobile-board': {
    fallbackWidth: 192,
    widths: [192, 320, 480],
    sizes: '(max-width: 640px) 24vw, (max-width: 1024px) 16vw, 192px',
  },
  hand: {
    fallbackWidth: 320,
    widths: [320, 480, 720],
    sizes: '(max-width: 640px) 34vw, (max-width: 1024px) 18vw, 320px',
  },
  board: {
    fallbackWidth: 480,
    widths: [320, 480, 720],
    sizes: '(max-width: 640px) 30vw, (max-width: 1024px) 20vw, 480px',
  },
  preview: {
    fallbackWidth: 720,
    widths: [480, 720, 960],
    sizes: '(max-width: 640px) 82vw, (max-width: 1024px) 44vw, 720px',
  },
  detail: {
    fallbackWidth: 720,
    widths: [480, 720, 960],
    sizes: '(max-width: 640px) 86vw, (max-width: 1024px) 48vw, 720px',
  },
};

const DEFAULT_IMGPROXY_BASE_URL = '/api/imgproxy';

function imgproxyBaseUrl(): string {
  const configured = import.meta.env.VITE_IMGPROXY_BASE_URL?.trim();
  if (!configured) return DEFAULT_IMGPROXY_BASE_URL;
  return configured.replace(/\/+$/, '');
}

function isLikelyUrl(value: string): boolean {
  return (
    /^(https?:)?\/\//i.test(value) || value.startsWith('/') || value.startsWith('data:') || value.startsWith('blob:')
  );
}

function resolveRelativeUrl(source: string): string {
  if (/^(https?:)?\/\//i.test(source) || source.startsWith('data:') || source.startsWith('blob:')) return source;
  if (typeof window === 'undefined') return source;
  return new URL(source, window.location.origin).toString();
}

function resolveCardImageSource(input: string, sourceKind: CardImageSourceKind = 'auto'): string {
  if (!input) return '';
  if (sourceKind === 'url') return resolveRelativeUrl(input);
  if (sourceKind === 'cardId') return resolveRelativeUrl(getCardDef(input)?.image ?? input);
  if (isLikelyUrl(input)) return resolveRelativeUrl(input);
  return resolveRelativeUrl(getCardDef(input)?.image ?? input);
}

export function getCardImageSource(input: string, sourceKind: CardImageSourceKind = 'auto'): string {
  return resolveCardImageSource(input, sourceKind);
}

function encodePlainSource(source: string): string {
  return encodeURI(source).replace(/@/g, '%40').replace(/\?/g, '%3F').replace(/#/g, '%23');
}

function appendFormat(path: string, format: CardImageFormat | undefined): string {
  if (!format || format === 'original') return path;
  return `${path}@${format}`;
}

export function getCardImageUrl(input: string, width: CardImageWidth, options: CardImageUrlOptions = {}): string {
  const source = resolveCardImageSource(input, options.sourceKind);
  if (!source || source.startsWith('data:') || source.startsWith('blob:')) return source;

  const path = `/rs:fit:${width}:0/plain/${encodePlainSource(source)}`;
  return `${imgproxyBaseUrl()}${appendFormat(path, options.format)}`;
}

export function getCardImageSrcSet(input: string, options: CardImageSrcSetOptions = {}): string {
  const widths = options.widths ?? CARD_IMAGE_WIDTHS;
  return widths.map((width) => `${getCardImageUrl(input, width, options)} ${width}w`).join(', ');
}

export function getCardImageSizes(context: CardImageContext): string {
  return CARD_IMAGE_CONTEXTS[context].sizes;
}

export function getCardImageFallbackWidth(context: CardImageContext): CardImageWidth {
  return CARD_IMAGE_CONTEXTS[context].fallbackWidth;
}

export function getCardImageContextWidths(context: CardImageContext): readonly CardImageWidth[] {
  return CARD_IMAGE_CONTEXTS[context].widths;
}
