import type { ElementType, ReactNode, HTMLAttributes } from 'react';

// Wraps the .ehi-card class (surface-card / border / --radius-lg / --shadow-card).
// 30+ containers hand-rebuild this with divergent radius (rounded-lg 378 /
// rounded-xl 267 / rounded-2xl 27 / rounded-md 35) and padding (p-3 / p-4 / p-5).

const PAD = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' } as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  header?: ReactNode;
  footer?: ReactNode;
  /** Padding applied to header / body / footer sections. Default 'md'. */
  padding?: keyof typeof PAD;
  children?: ReactNode;
}

export const Card = ({
  as: Tag = 'div',
  header,
  footer,
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardProps) => (
  <Tag className={`ehi-card overflow-hidden ${className}`} {...rest}>
    {header != null && (
      <div className={`border-b border-[var(--color-border)] ${PAD[padding]}`}>{header}</div>
    )}
    <div className={PAD[padding]}>{children}</div>
    {footer != null && (
      <div className={`border-t border-[var(--color-border)] ${PAD[padding]}`}>{footer}</div>
    )}
  </Tag>
);
