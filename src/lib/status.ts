// Canonical Transaction.status handling for the cargo / package / marketing /
// manifest flow. Replaces the disagreeing per-file maps:
//   - App.tsx `STATUS_GROUPS` + `statusColor` (in-transit -> warning, arrived -> cobalt)
//   - TransactionLedger.tsx two inline `statusColor` ternaries (in-transit -> cobalt,
//     arrived -> amber) -- one for the mobile card list, one for the desktop table,
//     which had already drifted apart from each other.
//
// The Ledger's mapping wins (in-transit = info/blue, arrived = amber); the public
// /track page adopts it so a shipment reads the same colour there and internally.
//
// NOT covered here (deliberately different vocabularies, each keeps its own logic):
// Fleet vehicle status, MyTrips trip status, Scanner scan-event type, AuditLog
// action, ITDashboard bug status, LoginScreen connection status, FlightRadar
// (src/components/ui/StatusBadge.tsx).

export type TxnStage =
  | 'intake' | 'in_transit' | 'arrived' | 'delivered' | 'returned' | 'cancelled' | 'on_hold';

// Every raw status string the department forms / ledger / scanner write, folded
// to a stage. Extends App.tsx's original STATUS_GROUPS (Dispatched / Departure /
// In-Transit were all the same in-transit state; matching one exact string there
// silently failed the progress bar for the other spellings).
const STAGE_BY_RAW: Record<string, TxnStage> = {
  intake: 'intake', pending: 'intake', draft: 'intake', new: 'intake', '': 'intake',
  dispatched: 'in_transit', departure: 'in_transit', departed: 'in_transit',
  'in-transit': 'in_transit', 'in transit': 'in_transit', intransit: 'in_transit', transit: 'in_transit',
  arrived: 'arrived', arrival: 'arrived',
  delivered: 'delivered', completed: 'delivered', complete: 'delivered',
  returned: 'returned', return: 'returned',
  cancelled: 'cancelled', canceled: 'cancelled', void: 'cancelled', voided: 'cancelled',
  'on hold': 'on_hold', 'on-hold': 'on_hold', hold: 'on_hold', held: 'on_hold',
};

export function normalizeStatus(raw: string | null | undefined): TxnStage {
  if (!raw) return 'intake';
  return STAGE_BY_RAW[raw.trim().toLowerCase()] ?? 'intake';
}

// Matches BadgeTone in src/components/ui/Badge.tsx.
export type StatusTone = 'success' | 'error' | 'warning' | 'info' | 'amber' | 'purple' | 'neutral';

interface StageMeta {
  label: string;
  tone: StatusTone;
  /** 0..3 position on the Intake -> In Transit -> Arrived -> Delivered rail.
   *  Terminal-but-not-delivered states (cancelled / returned) stay at 0 so the
   *  public /track progress bar doesn't render them as "complete" -- matches
   *  App.tsx's old `STATUS_GROUPS[x] ?? 0` behaviour for unlisted statuses. */
  step: 0 | 1 | 2 | 3;
}

const META: Record<TxnStage, StageMeta> = {
  intake: { label: 'Intake', tone: 'neutral', step: 0 },
  in_transit: { label: 'In Transit', tone: 'info', step: 1 },
  arrived: { label: 'Arrived', tone: 'amber', step: 2 },
  delivered: { label: 'Delivered', tone: 'success', step: 3 },
  returned: { label: 'Returned', tone: 'warning', step: 0 },
  cancelled: { label: 'Cancelled', tone: 'error', step: 0 },
  on_hold: { label: 'On Hold', tone: 'warning', step: 1 },
};

export function statusMeta(raw: string | null | undefined): StageMeta {
  return META[normalizeStatus(raw)];
}

/** A plain CSS colour value (progress bars, left-borders, dots). */
export function statusColorVar(raw: string | null | undefined): string {
  return `var(--color-${statusMeta(raw).tone}-fg)`;
}

/** Tailwind class triplet for a status chip: text + bg + border, all tokens. */
export function statusChipClass(raw: string | null | undefined): string {
  const { tone } = statusMeta(raw);
  return `text-[var(--color-${tone}-fg)] bg-[var(--color-${tone}-bg)] border-[var(--color-${tone}-border)]`;
}
