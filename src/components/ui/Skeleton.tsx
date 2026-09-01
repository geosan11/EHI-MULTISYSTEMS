import type { CSSProperties } from 'react';

// Loading placeholder. Content-skeleton coverage in the app today: zero.
// Uses Tailwind's built-in animate-pulse over --color-surface-2.
export const Skeleton = ({
  className = '',
  rounded = 'rounded-[var(--radius-sm)]',
  style,
}: {
  className?: string;
  rounded?: string;
  style?: CSSProperties;
}) => (
  <div
    className={`animate-pulse bg-[var(--color-surface-2)] ${rounded} ${className}`}
    style={style}
    aria-hidden="true"
  />
);

/** A stack of text-line skeletons. */
export const SkeletonText = ({ lines = 3, className = '' }: { lines?: number; className?: string }) => (
  <div className={`flex flex-col gap-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        rounded="rounded"
      />
    ))}
  </div>
);
