// Flight Radar's own status vocabulary (src/components/views/FlightRadar.tsx)
// -- deliberately separate from the cargo/baggage/marketing/package
// Transaction.status strings (Intake/Dispatched/Arrived/Delivered/...)
// used elsewhere, which have their own color mapping duplicated across
// Dashboard.tsx/TransactionLedger.tsx/App.tsx. Not unifying those here --
// different vocabulary, different domain, and touching those existing,
// already-working call sites is out of scope for this feature.
export type FlightStatus =
  | 'scheduled' | 'boarding' | 'departed' | 'delayed'
  | 'diverted' | 'returned' | 'cancelled' | 'landed' | 'unknown';

const FLIGHT_STATUS_META: Record<FlightStatus, { label: string; color: string; bg: string }> = {
  scheduled: { label: 'Scheduled', color: 'var(--color-muted)', bg: 'rgba(255,255,255,0.06)' },
  boarding: { label: 'Boarding', color: 'var(--color-accent-cobalt)', bg: 'rgba(59,130,246,0.12)' },
  departed: { label: 'En Route', color: 'var(--color-accent-cobalt)', bg: 'rgba(59,130,246,0.12)' },
  delayed: { label: 'Delayed', color: 'var(--color-accent-amber)', bg: 'rgba(245,158,11,0.12)' },
  diverted: { label: 'Diverted', color: 'var(--color-error)', bg: 'rgba(239,68,68,0.12)' },
  // Special case: a diversion whose landing airport is the same one the
  // flight departed from -- flagged separately by the caller (see
  // FlightRadar.tsx's normalizeCachedStatus) rather than inferred here,
  // since this component has no airport data to compare.
  returned: { label: 'Returned to Origin', color: 'var(--color-error)', bg: 'rgba(239,68,68,0.12)' },
  cancelled: { label: 'Cancelled', color: 'var(--color-error)', bg: 'rgba(239,68,68,0.12)' },
  landed: { label: 'Landed', color: 'var(--color-success)', bg: 'rgba(16,185,129,0.12)' },
  unknown: { label: 'Not Tracked', color: 'var(--color-muted)', bg: 'rgba(255,255,255,0.06)' },
};

export function flightStatusMeta(status: string): { label: string; color: string; bg: string } {
  return FLIGHT_STATUS_META[status as FlightStatus] || FLIGHT_STATUS_META.unknown;
}

export function StatusBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const meta = flightStatusMeta(status);
  const padding = size === 'sm' ? '2px 8px' : '4px 10px';
  const fontSize = size === 'sm' ? 9 : 11;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding, borderRadius: 999,
        background: meta.bg, color: meta.color,
        fontSize, fontWeight: 600, fontFamily: 'monospace',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}
