import type { ReactNode } from 'react';
import { BackButton } from '../BackButton';

// One screen header. ~32 screens hand-roll this: 18 sticky via the
// .ehi-view-header class, ~14 non-sticky that scroll away (one -- Accounting
// Console -- with no title at all). Titles span 10px..18px across
// h1/h2/h3/span/div, font-bold vs font-black, with/without a colour class.
// Standardises on --text-17 / font-bold / --color-foreground.

export const PageHeader = ({
  title,
  subtitle,
  onBack,
  actions,
  sticky = true,
  className = '',
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
  sticky?: boolean;
  className?: string;
}) => (
  <div
    className={
      sticky
        ? `ehi-view-header ${className}`
        : `flex items-center justify-between gap-3 pb-2 mb-4 border-b border-[var(--color-border)] ${className}`
    }
  >
    <div className="flex items-center gap-3 min-w-0">
      {onBack && <BackButton onClick={onBack} />}
      <div className="min-w-0">
        <h1 className="text-[17px] font-bold text-[var(--color-foreground)] tracking-tight truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider truncate">
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);
