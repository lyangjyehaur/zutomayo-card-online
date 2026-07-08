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

export interface CardImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'sizes'> {
  cardId?: string;
  src?: string;
  context?: CardImageContext;
  sourceKind?: CardImageSourceKind;
  sizes?: string;
  fallbackToOriginal?: boolean;
}

export function CardImage({
  cardId,
  src,
  context = 'board',
  sourceKind,
  sizes,
  loading = 'lazy',
  decoding = 'async',
  alt = '',
  fallbackToOriginal = true,
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
    return <img alt={alt} loading={loading} decoding={decoding} onError={onError} {...imgProps} />;
  }

  if (useOriginalFallback) {
    return <img src={originalSource} alt={alt} loading={loading} decoding={decoding} onError={onError} {...imgProps} />;
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
        src={getCardImageUrl(input, fallbackWidth, { sourceKind: resolvedSourceKind })}
        srcSet={getCardImageSrcSet(input, { sourceKind: resolvedSourceKind, widths })}
        sizes={imageSizes}
        alt={alt}
        loading={loading}
        decoding={decoding}
        onError={handleImgproxyError}
        {...imgProps}
      />
    </picture>
  );
}
