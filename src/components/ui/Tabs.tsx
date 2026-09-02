import type { LucideIcon } from 'lucide-react';
import { ICON } from '../../lib/ui';

// Replaces >=6 bespoke tab bars (TransactionLedger, Analytics, Reports,
// AccountingConsole, MarketingWorkspace, Settings), each with its own active
// treatment (amber pill vs underline vs surface-2 fill).

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export const Tabs = ({
  items,
  value,
  onChange,
  variant = 'pill',
  className = '',
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: 'pill' | 'underline';
  className?: string;
}) => (
  <div
    role="tablist"
    className={`flex items-center ${variant === 'underline' ? 'border-b border-[var(--color-border)]' : ''} ${
      className || 'gap-1 overflow-x-auto no-scrollbar'
    }`}
  >
    {items.map((t) => {
      const active = t.id === value;
      const Icon = t.icon;
      const base =
        'inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-bold text-[12px] transition-colors cursor-pointer';
      const style =
        variant === 'pill'
          ? `px-3 py-1.5 rounded-full ${
              active
                ? 'bg-[var(--color-accent-amber)] text-[var(--color-on-accent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`
          : `pb-2.5 px-3 border-b-2 -mb-px ${
              active
                ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`;
      return (
        <button
          key={t.id}
          role="tab"
          aria-selected={active}
          onClick={() => onChange(t.id)}
          className={`${base} ${style}`}
        >
          {Icon && <Icon size={ICON.sm} strokeWidth={2.25} />}
          {t.label}
          {t.count != null && (
            <span
              className="ml-0.5 rounded-full px-1.5 text-[9px] leading-[1.4]"
              style={{
                background: active ? 'rgba(0,0,0,0.15)' : 'var(--color-neutral-bg)',
                color: active ? 'var(--color-on-accent)' : 'var(--color-neutral-fg)',
              }}
            >
              {t.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);
