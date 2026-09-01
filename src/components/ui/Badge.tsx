import type { ReactNode } from 'react';

// Generic status pill. The ~11 hand-rolled pill spans + the 8 disagreeing
// status->colour maps (App.tsx / TransactionLedger.tsx x2 / Scanner / Fleet /
// MyTrips / ITDashboard / LoginScreen) all bake their own rgba() tints inline.
// This consumes the --color-{tone}-bg/-border/-fg token sets from Phase 0.
// (src/components/ui/StatusBadge.tsx keeps its own FlightRadar vocabulary but
// should re-skin onto this.)

export type BadgeTone =
  | 'success' | 'error' | 'warning' | 'info' | 'amber' | 'purple' | 'neutral';

const SIZE = {
  sm: 'text-[9px] px-1.5 py-0.5 gap-1',
  md: 'text-[11px] px-2 py-0.5 gap-1.5',
} as const;

export const Badge = ({
  tone = 'neutral',
  size = 'md',
  dot = false,
  className = '',
  children,
}: {
  tone?: BadgeTone;
  size?: keyof typeof SIZE;
  /** Leading colour dot -- use when colour is the only differentiator. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <span
    className={`inline-flex items-center rounded-full font-mono font-bold uppercase tracking-[0.04em] whitespace-nowrap border ${SIZE[size]} ${className}`}
    style={{
      background: `var(--color-${tone}-bg)`,
      borderColor: `var(--color-${tone}-border)`,
      color: `var(--color-${tone}-fg)`,
    }}
  >
    {dot && (
      <span
        className="rounded-full shrink-0"
        style={{ width: 6, height: 6, background: 'currentColor' }}
      />
    )}
    {children}
  </span>
);
