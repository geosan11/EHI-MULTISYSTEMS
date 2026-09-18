// Single source of truth for "is this Debt-mode row actually settled".
// There is no debt_cleared/debt_status column anywhere in the schema --
// receipt_mode/payment_mode stays the literal string 'Debt' forever (with
// one narrow same-shift-reclassification exception, see
// supabase/migrations/20260947_same_shift_debt_reclassification.sql).
// "Debt Paid" has always been a client-derived display label. Before this
// file existed, that derivation was hand-duplicated across ledgerSearch.ts's
// 4 row mappers and EHIApp.tsx's initial fetch + realtime INSERT/UPDATE
// handlers (12 more copies) -- those copies had already drifted from each
// other at least once in this app's history (see commit e9dc3f0) and the
// server-side ledger_search_totals RPC had its own, third, independently
// drifted copy. Every call site now goes through here instead.
export type DebtEntryType = 'cargo' | 'baggage' | 'marketing' | 'package';

interface DebtDeptConfig {
  modeCol: 'receipt_mode' | 'payment_mode';
  amountField: string; // raw-row field holding the sale total
  paidField: string;   // raw-row field holding amount actually paid down
  hasLegacyPaidFlag?: boolean; // package_entries.debt_paid -- no equivalent on the other 3 tables
  fallbackMode: string; // department default when mode is falsy
}

const DEPT_CONFIG: Record<DebtEntryType, DebtDeptConfig> = {
  cargo: { modeCol: 'receipt_mode', amountField: 'amount', paidField: 'amount_paid', fallbackMode: 'Cash' },
  baggage: { modeCol: 'payment_mode', amountField: 'amount', paidField: 'amount_paid', fallbackMode: 'POS' },
  // marketing inverts the usual naming: amount_paid holds the sale total,
  // debt_amount_paid holds the running debt repayment.
  marketing: { modeCol: 'payment_mode', amountField: 'amount_paid', paidField: 'debt_amount_paid', fallbackMode: 'Cash' },
  package: { modeCol: 'payment_mode', amountField: 'amount', paidField: 'amount_paid', hasLegacyPaidFlag: true, fallbackMode: 'Cash' },
};

// A debt can be fully settled by a mix of an explicit payment and a partial
// retrieval (see clear_*_debt's own balance formula, which subtracts
// retrieved_amount), or -- package only -- by the legacy debt_paid boolean
// predating amount_paid tracking on that table.
export function isDebtSettled(paid: number, retrieved: number, total: number, legacyFlag?: boolean): boolean {
  return !!legacyFlag || paid + retrieved >= total;
}

// For a fresh whole-row fetch (initial load, ledgerSearch.ts's mappers,
// realtime INSERT payloads) where every field needed is present on `raw`.
export function computeDebtDisplayModeFromRow(raw: any, dept: DebtEntryType): string {
  const c = DEPT_CONFIG[dept];
  const mode = raw[c.modeCol];
  if (mode !== 'Debt') return mode || c.fallbackMode;
  const settled = isDebtSettled(
    Number(raw[c.paidField] || 0),
    Number(raw.retrieved_amount || 0),
    Number(raw[c.amountField] || 0),
    c.hasLegacyPaidFlag && raw.debt_paid === true
  );
  return settled ? 'Debt Paid' : 'Debt';
}

// For a realtime UPDATE handler merging a partial payload `r` (payload.new,
// which Postgres realtime does not guarantee contains every column) onto an
// already-mapped Transaction `t`.
export function computeDebtDisplayModeFromRealtimeMerge(
  r: any,
  t: { mode: string; amount?: number; amountPaid?: number; debtPaid?: boolean; raw?: any },
  dept: DebtEntryType
): string {
  const c = DEPT_CONFIG[dept];
  const mode = r[c.modeCol] || t.mode;
  if (mode !== 'Debt') return mode;
  const paid = Number(r[c.paidField] ?? t.amountPaid ?? 0);
  const retrieved = Number(r.retrieved_amount ?? (t.raw as any)?.retrieved_amount ?? 0);
  const total = Number(r[c.amountField] ?? t.amount ?? 0);
  const legacy = c.hasLegacyPaidFlag && (r.debt_paid === true || t.debtPaid === true);
  return isDebtSettled(paid, retrieved, total, legacy) ? 'Debt Paid' : 'Debt';
}
