import { useEffect, useState, type ImgHTMLAttributes, type SyntheticEvent } from 'react';
import {
  getCardImageContextWidths,
  getCardImageFallbackWidth,
  getCardImageSizes,
  getCardImageSource,
  getCardImageSrcSet,
  getCardImageUrl,
  type CardImageContext,
  type CardImageSourceKind,
} from '../lib/cardImages';

type OriginalFallbackPolicy =
  | {
      fallbackToOriginal?: false;
      originalFallbackReason?: never;
    }
  | {
      fallbackToOriginal: true;
      originalFallbackReason: string;
    };

export type CardImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'sizes'> &
  OriginalFallbackPolicy & {
    cardId?: string;
    src?: string;
    context?: CardImageContext;
    sourceKind?: CardImageSourceKind;
    sizes?: string;
  };

export function CardImage({
  cardId,
  src,
  context = 'board',
  sourceKind,
  sizes,
  loading = 'lazy',
  decoding = 'async',
  alt = '',
  fallbackToOriginal = false,
  originalFallbackReason,
  onError,
  ...imgProps
}: CardImageProps) {
  const input = cardId ?? src ?? '';
  const resolvedSourceKind = sourceKind ?? (cardId ? 'cardId' : 'url');
  const widths = getCardImageContextWidths(context);
  const fallbackWidth = getCardImageFallbackWidth(context);
  const imageSizes = sizes ?? getCardImageSizes(context);
  const originalSource = getCardImageSource(input, resolvedSourceKind);
  const [useOriginalFallback, setUseOriginalFallback] = useState(false);

  useEffect(() => {
    setUseOriginalFallback(false);
  }, [input, resolvedSourceKind]);

  const handleImgproxyError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    if (fallbackToOriginal && originalSource && !useOriginalFallback) {
      setUseOriginalFallback(true);
      return;
    }
    onError?.(event);
  };

  if (!input) {
    return (
      <img
        {...imgProps}
        data-card-image-delivery="missing"
        alt={alt}
        loading={loading}
        decoding={decoding}
        onError={onError}
      />
    );
  }

  if (useOriginalFallback) {
    return (
      <img
        {...imgProps}
        src={originalSource}
        data-card-image-delivery="original-exception"
        data-card-image-fallback-reason={originalFallbackReason}
        alt={alt}
        loading={loading}
        decoding={decoding}
        onError={onError}
      />
    );
  }

  return (
    <picture>
      <source
        type="image/avif"
        srcSet={getCardImageSrcSet(input, { format: 'avif', sourceKind: resolvedSourceKind, widths })}
        sizes={imageSizes}
      />
      <source
        type="image/webp"
        srcSet={getCardImageSrcSet(input, { format: 'webp', sourceKind: resolvedSourceKind, widths })}
        sizes={imageSizes}
      />
      <img
        {...imgProps}
        src={getCardImageUrl(input, fallbackWidth, { sourceKind: resolvedSourceKind })}
        srcSet={getCardImageSrcSet(input, { sourceKind: resolvedSourceKind, widths })}
        sizes={imageSizes}
        data-card-image-delivery="imgproxy"
        alt={alt}
        loading={loading}
        decoding={decoding}
        onError={handleImgproxyError}
      />
    </picture>
  );
}
