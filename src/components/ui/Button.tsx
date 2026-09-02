import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ICON } from '../../lib/ui';
import { Spinner } from './Spinner';

// The one button. ~550 raw <button className="..."> across the app hand-roll
// this, with the canonical .ehi-btn-primary used exactly twice -- heights
// h-8..h-12, radius rounded..rounded-xl, weight bold/semibold/extrabold,
// mono vs sans, text-[11px]..[15px], 4 different loading patterns. This wraps
// the same tokens/recipe as .ehi-btn-primary (amber gradient, --color-on-accent
// ink, --radius-md, --shadow-amber) but is width-flexible and typed.

export type ButtonVariant = 'primary' | 'success' | 'secondary' | 'destructive' | 'ghost' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] shadow-[var(--shadow-amber)] hover:opacity-90 disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-muted)] disabled:shadow-none',
  success:
    'bg-[var(--color-success)] text-[var(--color-on-accent)] shadow-[var(--shadow-success)] hover:opacity-90 disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-muted)] disabled:shadow-none',
  secondary:
    'bg-transparent border border-[var(--color-border-strong)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] disabled:bg-[var(--color-surface-1)] disabled:text-[var(--color-muted)] disabled:border-[var(--color-border)]',
  destructive:
    'bg-transparent border border-[var(--color-error)] text-[var(--color-error)] hover:bg-[var(--glow-error)] disabled:border-[var(--color-border)] disabled:text-[var(--color-muted)]',
  ghost:
    'bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]',
  subtle:
    'bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] disabled:text-[var(--color-muted)]',
};

const SIZE: Record<ButtonSize, { cls: string; icon: number }> = {
  sm: { cls: 'h-8 px-3 text-[12px] gap-1.5', icon: ICON.sm },
  md: { cls: 'h-10 px-4 text-[13px] gap-2', icon: ICON.md },
  lg: { cls: 'h-12 px-5 text-[14px] gap-2', icon: ICON.md },
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text shown in place of children while loading (children stay if omitted). */
  loadingLabel?: string;
  fullWidth?: boolean;
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingLabel,
    fullWidth = false,
    iconLeft: IconLeft,
    iconRight: IconRight,
    disabled,
    className = '',
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const s = SIZE[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        // :active scale + focus-visible ring come from the global button rules in src/index.css
        'inline-flex items-center justify-center rounded-[var(--radius-md)] font-bold font-mono',
        'whitespace-nowrap select-none transition-all cursor-pointer',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        fullWidth ? 'w-full' : '',
        s.cls,
        VARIANT[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <Spinner size={s.icon} tone="current" />
      ) : (
        IconLeft && <IconLeft size={s.icon} strokeWidth={2.25} />
      )}
      {loading && loadingLabel ? loadingLabel : children}
      {!loading && IconRight && <IconRight size={s.icon} strokeWidth={2.25} />}
    </button>
  );
});
