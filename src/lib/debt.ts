import { supabase, fetchAllRows } from './supabase';
import { Transaction } from './types';

export type DebtEntryType = 'cargo' | 'baggage' | 'marketing' | 'package';

// Table each DebtEntryType is persisted in -- mirrors TransactionLedger.tsx's
// local RETRIEVAL_TABLE_NAME, shared here so audit-log writers for debt
// collection don't need their own copy.
export const DEBT_TABLE_NAME: Record<DebtEntryType, string> = {
  cargo: 'cargo_entries',
  baggage: 'manifests',
  marketing: 'marketing_entries',
  package: 'package_entries',
};

export interface ClearDebtResult {
  ok: boolean;
  newAmountPaid?: number;
  remainingBalance?: number;
  fullyPaid?: boolean;
  error?: string;
}

const RPC_BY_TYPE: Record<DebtEntryType, { name: string; idParam: string }> = {
  cargo: { name: 'clear_cargo_debt', idParam: 'p_entry_ref' },
  baggage: { name: 'clear_baggage_debt', idParam: 'p_transaction_id' },
  marketing: { name: 'clear_marketing_debt', idParam: 'p_entry_ref' },
  package: { name: 'clear_package_debt', idParam: 'p_entry_ref' },
};

// Single entry point for clearing (fully or partially paying down) a
// Debt-mode entry, across all four transaction types. Routes through
// clear_cargo_debt/clear_baggage_debt/clear_marketing_debt/clear_package_debt
// (see supabase/migrations/20260819_clear_debt_state_wide.sql), which --
// unlike the generic handleUpdateTx path this replaces -- is deliberately
// authorized state-wide (any agent who can see the debt via sibling-hub
// visibility can clear it, matching the read policy), verifies the entry
// is actually in Debt mode, and either succeeds or raises a real
// exception. handleUpdateTx's plain UPDATE silently affected 0 rows for a
// non-admin agent clearing a sibling-hub debt (RLS-filtered, not an
// error, since every other write on these tables stays hub-locked), so
// the app showed "Debt cleared successfully" while the database never
// actually changed.
export async function clearDebt(params: {
  type: DebtEntryType;
  id: string;
  paymentAmount: number;
  paymentMode: string;
  bank?: string;
  loggedBy: string;
  // The remaining balance as displayed to the user right before this call.
  // The RPC re-checks it against the real, just-locked row and rejects the
  // call if it's changed -- closes the double-partial-payment race where a
  // double-click/retry could each independently pass the "doesn't exceed
  // remaining" check and silently double-pay a debt.
  expectedRemaining?: number;
}): Promise<ClearDebtResult> {
  const rpc = RPC_BY_TYPE[params.type];
  if (!rpc) {
    return { ok: false, error: `Debt clearing isn't supported for transaction type "${params.type}"` };
  }

  const { data, error } = await supabase.rpc(rpc.name, {
    [rpc.idParam]: params.id,
    p_payment_amount: params.paymentAmount,
    p_payment_mode: params.paymentMode,
    p_bank: params.bank ?? null,
    p_logged_by: params.loggedBy,
    p_expected_remaining: params.expectedRemaining ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    // clear_marketing_debt returns new_debt_amount_paid instead of
    // new_amount_paid -- see the naming-inversion comment on that
    // function for why.
    newAmountPaid: Number(row?.new_amount_paid ?? row?.new_debt_amount_paid ?? 0),
    remainingBalance: Number(row?.remaining_balance ?? 0),
    fullyPaid: !!row?.fully_paid,
  };
}

export interface ReopenDebtResult {
  ok: boolean;
  newAmountPaid?: number;
  remainingBalance?: number;
  reversedAmount?: number;
  error?: string;
}

const REOPEN_RPC_BY_TYPE: Record<DebtEntryType, { name: string; idParam: string }> = {
  cargo: { name: 'reopen_cargo_debt', idParam: 'p_entry_ref' },
  baggage: { name: 'reopen_baggage_debt', idParam: 'p_transaction_id' },
  marketing: { name: 'reopen_marketing_debt', idParam: 'p_entry_ref' },
  package: { name: 'reopen_package_debt', idParam: 'p_entry_ref' },
};

// Reverses the most recent payment_history entry on a fully-paid Debt
// entry, undoing a clear_*_debt call -- same "any staff, audited" policy as
// clearDebt above (see reopen_*_debt in
// supabase/migrations/20260936_reopen_debt_rpcs.sql), not a role-restricted
// action. Undoes only the last collection event, not the whole payment
// history, since a debt may have had legitimate partial payments before the
// clearance being corrected.
export async function reopenDebt(params: {
  type: DebtEntryType;
  id: string;
  loggedBy: string;
  // The amount_paid as displayed to the user right before this call -- the
  // RPC re-checks it against the real, just-locked row and rejects the call
  // if it's changed, same concurrency guard as clearDebt's expectedRemaining.
  expectedAmountPaid?: number;
}): Promise<ReopenDebtResult> {
  const rpc = REOPEN_RPC_BY_TYPE[params.type];
  if (!rpc) {
    return { ok: false, error: `Reopening a debt isn't supported for transaction type "${params.type}"` };
  }

  const { data, error } = await supabase.rpc(rpc.name, {
    [rpc.idParam]: params.id,
    p_logged_by: params.loggedBy,
    p_expected_amount_paid: params.expectedAmountPaid ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    // Same new_debt_amount_paid naming inversion as clear_marketing_debt.
    newAmountPaid: Number(row?.new_amount_paid ?? row?.new_debt_amount_paid ?? 0),
    remainingBalance: Number(row?.remaining_balance ?? 0),
    reversedAmount: Number(row?.reversed_amount ?? 0),
  };
}

// ============================================================
// Shared debt-collection / retrieval event data layer
// ============================================================
// Every clear_*_debt RPC above already appends a {amount, mode, by, at}
// entry to the entry's own `payment_history` column atomically, alongside
// the amount_paid update -- that data has always been there. Until now,
// the only way EOD reconciliation/Analytics/Reports/etc. could tell "a
// debt was collected against today" was by scanning for a separate
// synthetic `is_debt_clearance` shadow row that DebtorsTab.tsx/
// TransactionLedger.tsx used to create for every clearance (one new DB row
// per payment, on top of the real entry) -- the confusing "double entry"
// staff and accountants see in the ledger. The primitives below let every
// consumer read collection/retrieval events straight out of the ORIGINAL
// entry instead, so no new row ever needs to exist for this purpose again.

const MODE_COLUMN: Record<DebtEntryType, string> = {
  cargo: 'receipt_mode',
  baggage: 'payment_mode',
  marketing: 'payment_mode',
  package: 'payment_mode',
};

// One entry per payment_history event actually collected, joined back to
// the source sale for context a bare {amount,mode,by,at} tuple doesn't
// carry on its own (type, hub, what was being paid for).
export interface PaymentHistoryEvent {
  amount: number;
  mode: string;
  by: string;
  at: string;
  sourceTxId: string;
  sourceTxType: DebtEntryType;
  sourceTxName: string;
  sourceDetail: string;
  sourceHubId?: string;
  sourceHub?: string;
  // The original entry's own created_at (when the sale/debt itself was
  // booked, not when this particular payment against it landed) -- lets a
  // consumer distinguish "collecting on an old debt" from "the customer
  // paid off a debt created and cleared within the very same window,"
  // which is a single sale, not sale + separate collection. See
  // EODReconciliation.tsx's priorDebtCollectionEvents for the consumer.
  sourceCreatedAt?: string;
}

// Every entry that could still contribute a debt-collection or retrieval
// event to a downstream financial total: currently in Debt mode (more
// payment_history may follow), already retrieved (full or partial), or
// itself a historical debt-clearance shadow row (needed both to keep
// rendering historical shadow rows correctly and to compute
// buildShadowRowExclusionCounts below). Unbounded / state-wide on purpose,
// generalizing DebtorsTab.tsx's own dedicated fetch (see its comment on
// why a debt/payment logged outside the app's default date window would
// otherwise silently vanish from these totals) -- RLS's sibling_hub_ids()
// policy scopes results correctly per caller, so no manual hub_id filter
// is applied here.
export async function fetchAllDebtAndRetrievalEntries(): Promise<Transaction[]> {
  const filterFor = (modeCol: string) =>
    `${modeCol}.eq.Debt,retrieved.eq.true,retrieved_amount.gt.0,is_debt_clearance.eq.true`;

  // Paginated, not `.limit(1000)` -- this fetch is unbounded by date on
  // purpose (see the comment above), so any one of these 4 tables can
  // realistically cross a single-page cap over a multi-year operation.
  // A flat `.limit(1000)` silently dropped the oldest matching rows
  // (order is created_at desc) past that point, from every one of this
  // function's 4+ consumers (EOD, AccountingConsole, Analytics,
  // DepartmentSalesAnalysis's modal) simultaneously, with zero warning --
  // if one of those dropped rows was a long-outstanding debt finally paid
  // off today, its collection event would vanish from today's totals.
  const [cargoData, baggageData, marketingData, packageData] = await Promise.all([
    fetchAllRows<any>((from, to) => supabase.from('cargo_entries').select('*').or(filterFor(MODE_COLUMN.cargo)).order('created_at', { ascending: false }).range(from, to)),
    fetchAllRows<any>((from, to) => supabase.from('manifests').select('*').or(filterFor(MODE_COLUMN.baggage)).order('created_at', { ascending: false }).range(from, to)),
    fetchAllRows<any>((from, to) => supabase.from('marketing_entries').select('*').or(filterFor(MODE_COLUMN.marketing)).order('created_at', { ascending: false }).range(from, to)),
    fetchAllRows<any>((from, to) => supabase.from('package_entries').select('*').or(filterFor(MODE_COLUMN.package)).order('created_at', { ascending: false }).range(from, to)),
  ]);

  const mapped: Transaction[] = [];

  cargoData.forEach((r: any) => mapped.push({
    id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo',
    detail: r.is_debt_clearance ? 'DEBT CLEARANCE' : `${r.airline || ''}`,
    amount: r.amount || 0, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [],
    mode: r.receipt_mode || 'Debt', pieces: r.total_pcs ?? undefined, kg: r.total_kg ?? undefined,
    time: r.created_at, created_at: r.created_at, type: 'cargo', awb_tag_number: r.awb_tag_number, status: r.status || 'Intake',
    airline: r.airline, hub_id: r.hub_id, hub: r.hub, clientType: r.client_type, corporate_client_id: r.corporate_client_id,
    consigneePhone: r.consignee_phone, is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined,
    retrieved: r.retrieved ?? undefined, retrievedAt: r.retrieved_at ?? undefined, retrievedBy: r.retrieved_by ?? undefined,
    raw: r,
  } as Transaction));

  baggageData.forEach((r: any) => mapped.push({
    id: r.transaction_id || r.id, name: r.passenger_name || 'Passenger',
    detail: r.is_debt_clearance ? 'DEBT CLEARANCE' : `${r.flight_no || ''}`,
    amount: r.amount || 0, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [],
    mode: r.payment_mode || 'Debt', pieces: r.total_pcs ?? undefined, kg: r.excess_kg ?? undefined, totalKg: r.total_kg ?? undefined,
    time: r.created_at, created_at: r.created_at, type: 'baggage', status: r.status || 'Intake',
    hub_id: r.hub_id, hub: r.hub, clientType: r.client_type, consigneePhone: r.passenger_phone,
    is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined,
    retrieved: r.retrieved ?? undefined, retrievedAt: r.retrieved_at ?? undefined, retrievedBy: r.retrieved_by ?? undefined,
    raw: r,
  } as Transaction));

  marketingData.forEach((r: any) => mapped.push({
    id: r.entry_ref || r.id, name: r.customer_name || 'Customer',
    detail: r.is_debt_clearance ? 'DEBT CLEARANCE' : `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
    // marketing_entries' naming inversion: `amount_paid` holds the real sale
    // total, `debt_amount_paid` tracks running debt repayment -- see
    // clear_marketing_debt's own comment. Matches DebtorsTab.tsx/
    // EHIApp.tsx's identical mapping.
    amount: r.amount_paid || 0, amountPaid: r.debt_amount_paid || 0, paymentHistory: r.payment_history || [],
    mode: r.payment_mode || 'Debt',
    time: r.created_at, created_at: r.created_at, type: 'marketing', status: r.status || 'Intake',
    hub_id: r.hub_id, hub: r.hub, clientType: r.client_type, consigneePhone: r.customer_phone,
    is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined,
    retrieved: r.retrieved ?? undefined, retrievedAt: r.retrieved_at ?? undefined, retrievedBy: r.retrieved_by ?? undefined,
    raw: r,
  } as Transaction));

  packageData.forEach((r: any) => mapped.push({
    id: r.entry_ref || r.id, name: r.customer_name || 'Customer',
    detail: r.is_debt_clearance ? 'DEBT CLEARANCE' : `${r.destination || ''}`,
    amount: r.amount || 0, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [],
    mode: r.payment_mode || 'Debt', pieces: r.total_pcs ?? undefined, kg: r.total_kg ?? undefined,
    time: r.created_at, created_at: r.created_at, type: 'package', status: r.status || 'Intake',
    hub_id: r.hub_id, hub: r.hub, consigneePhone: r.customer_phone,
    is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined,
    retrieved: r.retrieved ?? undefined, retrievedAt: r.retrieved_at ?? undefined, retrievedBy: r.retrieved_by ?? undefined,
    raw: r,
  } as Transaction));

  return mapped;
}

// Every historical debt clearance wrote BOTH a shadow row (is_debt_clearance
// = true, related_tx_id -> the original entry) AND a payment_history entry
// on the original, in the same request -- they've coexisted since the
// clearance feature was built. Naively summing "all shadow rows" plus "all
// payment_history entries" would therefore double-count every payment that
// ever happened. Since payment_history is append-only and each historical
// clearance wrote its shadow row and its payment_history entry
// synchronously in the same call, the first K entries in a given entry's
// payment_history array are exactly the ones already represented by a
// shadow row (K = however many shadow rows reference that entry) --
// skipping them in extractPaymentHistoryEvents below is sufficient to
// avoid double counting, with no coordinated deploy-timestamp cutover
// required: it's correct before, during, and permanently after
// shadow-row creation is removed.
export function buildShadowRowExclusionCounts(entries: Transaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  entries.forEach(t => {
    if (t.is_debt_clearance && t.related_tx_id) {
      counts.set(t.related_tx_id, (counts.get(t.related_tx_id) || 0) + 1);
    }
  });
  return counts;
}

// Flattens every entry's payment_history into individually dated,
// source-tagged events, dropping the leading entries already accounted for
// by a historical shadow row (see buildShadowRowExclusionCounts above).
export function extractPaymentHistoryEvents(
  entries: Transaction[],
  exclusionCounts: Map<string, number>
): PaymentHistoryEvent[] {
  const events: PaymentHistoryEvent[] = [];
  entries.forEach(t => {
    const history = t.paymentHistory || [];
    if (!history.length) return;
    const skip = exclusionCounts.get(t.id) || 0;
    history.slice(skip).forEach(p => {
      events.push({
        amount: p.amount, mode: p.mode, by: p.by, at: p.at,
        sourceTxId: t.id, sourceTxType: t.type as DebtEntryType,
        sourceTxName: t.name, sourceDetail: t.detail,
        sourceHubId: t.hub_id, sourceHub: t.hub,
        sourceCreatedAt: t.created_at,
      });
    });
  });
  return events;
}

export function sumPaymentHistoryByMode(events: PaymentHistoryEvent[]): { cash: number; transfer: number; pos: number; other: number } {
  return events.reduce((acc, e) => {
    const mode = (e.mode || '').toLowerCase();
    if (mode === 'cash') acc.cash += e.amount;
    else if (mode === 'transfer') acc.transfer += e.amount;
    else if (mode === 'pos') acc.pos += e.amount;
    else acc.other += e.amount;
    return acc;
  }, { cash: 0, transfer: 0, pos: 0, other: 0 });
}
