import { useEffect, useMemo, useState } from 'react';
import { cn } from '../ui/primitives/utils';

export interface UserAvatarProps {
  nickname?: string;
  avatarUrl?: string;
  avatarFallbackUrls?: string[];
  className?: string;
  imageClassName?: string;
}

export function UserAvatar({
  nickname,
  avatarUrl,
  avatarFallbackUrls = [],
  className,
  imageClassName,
}: UserAvatarProps) {
  const urls = useMemo(
    () => [avatarUrl, ...avatarFallbackUrls].filter(Boolean) as string[],
    [avatarFallbackUrls, avatarUrl],
  );
  const avatarKey = urls.join('|');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [avatarKey]);

  const fallbackInitial = nickname?.trim()?.[0]?.toUpperCase() || 'G';
  const currentUrl = urls[index];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent-primary/20 to-accent-action/20 ring-1 ring-accent-primary/30',
        className,
      )}
      aria-hidden="true"
    >
      {currentUrl ? (
        <img
          className={cn('h-full w-full object-cover', imageClassName)}
          src={currentUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setIndex((value) => value + 1)}
        />
      ) : (
        <span className="font-display text-current text-accent-primary">{fallbackInitial}</span>
      )}
    </span>
  );
}
