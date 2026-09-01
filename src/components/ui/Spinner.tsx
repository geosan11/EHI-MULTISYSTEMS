import { Loader2 } from 'lucide-react';
import { ICON } from '../../lib/ui';

const TONE = {
  amber: 'text-[var(--color-accent-amber)]',
  current: 'text-current',
  muted: 'text-[var(--color-muted)]',
} as const;

// The single spinning-loader primitive. Replaces ~114 scattered raw
// <Loader2 className="animate-spin" .../> at 9+ different sizes.
export const Spinner = ({
  size = 'md',
  tone = 'amber',
  className = '',
  label,
}: {
  size?: keyof typeof ICON | number;
  tone?: keyof typeof TONE;
  className?: string;
  /** Visually-hidden text for screen readers (defaults to "Loading"). */
  label?: string;
}) => {
  const px = typeof size === 'number' ? size : ICON[size];
  return (
    <Loader2
      size={px}
      strokeWidth={2.25}
      className={`animate-spin ${TONE[tone]} ${className}`}
      role="status"
      aria-label={label ?? 'Loading'}
    />
  );
};
