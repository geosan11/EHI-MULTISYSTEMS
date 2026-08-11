// Typed client for the ledger_search_page / ledger_search_totals RPCs
// (supabase/migrations/20260938_ledger_search_and_totals_rpc.sql).
// Single source of truth for turning a raw DB row into a Transaction/
// Expense -- previously duplicated between EHIApp.tsx's fetchInitial and
// TransactionLedger.tsx's now-removed fetchAllTimeTransactions. Both RPCs
// run SECURITY INVOKER (the default), so the caller's existing RLS
// policies apply exactly as they would to a direct .select() -- nothing
// here needs to re-implement hub scoping.
import { supabase, fetchAllRows } from './supabase';
import { Transaction, Expense } from './types';

export type LedgerEntryType = 'cargo' | 'baggage' | 'marketing' | 'package';

export interface LedgerSearchParams {
  query?: string;
  types?: LedgerEntryType[] | null;   // null/undefined = all 4 types
  terminal?: 'MMA2' | 'GAT' | null;
  mode?: string | null;
  officeWorkOnly?: boolean;
  debtClass?: 'Office' | 'Individual' | null;
  includeExpenses?: boolean;
}

export interface LedgerCursor {
  createdAt: string;
  entryId: string;
}

export interface LedgerPageRow {
  entryType: LedgerEntryType | 'expense';
  entryId: string;
  createdAt: string;
  transaction?: Transaction;
  expense?: Expense;
}

export interface LedgerPageResult {
  rows: LedgerPageRow[];
  nextCursor: LedgerCursor | null;
  hasMore: boolean;
}

export interface LedgerTotals {
  totalAmount: number;
  cashAmount: number;
  transferAmount: number;
  posAmount: number;
  debtAmount: number;
  walletAmount: number;
  unpaidDebtCount: number;
  officeDebtAmount: number;
  individualDebtAmount: number;
  rowCount: number;
}

export const LEDGER_PAGE_SIZE = 500;

function toRpcParams(p: LedgerSearchParams) {
  return {
    p_query: p.query && p.query.trim() ? p.query.trim() : null,
    p_types: p.types && p.types.length > 0 ? p.types : null,
    p_terminal: p.terminal || null,
    p_mode: p.mode || null,
    p_office_work_only: !!p.officeWorkOnly,
    p_debt_class: p.debtClass || null,
    p_include_expenses: p.includeExpenses !== false,
  };
}

// Fetches an id->name lookup for the "entered by" display fields, mirroring
// the same fetchAllRows('user_profiles') call TransactionLedger.tsx used to
// make inline. Cheap to call once per All-Time session; not cached across
// calls since staff rosters can change between sessions.
export async function fetchProfileLookup(): Promise<Record<string, string>> {
  const profiles = await fetchAllRows<any>((from, to) =>
    supabase.from('user_profiles').select('id,name').order('id').range(from, to)
  ).catch(() => []);
  const lookup: Record<string, string> = {};
  profiles.forEach((p: any) => { if (p.id) lookup[p.id] = p.name || ''; });
  return lookup;
}

// ── Per-type row mappers (raw is the whole-row to_jsonb payload from the
// RPC -- same column names as a direct table .select('*')) ──────────────

function mapCargoRow(r: any, profileLookup: Record<string, string>): Transaction {
  const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
  return {
    id: r.entry_ref || r.id, name: r.consignee_name || 'Cargo',
    detail: `${r.airline || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}${r.size_inches ? ` · ${r.size_inches}in` : ''}`,
    amount: r.amount || 0,
    mode: r.receipt_mode === 'Debt' && Number(r.amount_paid || 0) >= Number(r.amount || 0) ? 'Debt Paid' : (r.receipt_mode || 'Cash'),
    time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
    type: 'cargo', status: r.status || 'Intake', awb_tag_number: r.awb_tag_number, kg: r.total_kg,
    sizeInches: r.size_inches ?? undefined, pieces: r.total_pcs, pickupPin: r.pickup_pin || undefined,
    created_at: r.created_at, airline: r.airline, commissionRate: r.commission_rate ?? undefined,
    bank: r.bank, route: r.route, hub_id: r.hub_id, terminal: r.terminal, contentType: r.content_type,
    remarks: r.remark || undefined, enteredByName: enteredByName || undefined, editedBy: r.last_edited_by || undefined,
    editedAt: r.last_edited_at || undefined, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [],
    paymentConfirmed: r.payment_confirmed, posApprovalCode: r.pos_approval_code || undefined, confirmedBy: r.confirmed_by || undefined,
    confirmedAt: r.confirmed_at || undefined, consigneePhone: r.consignee_phone || undefined, clientType: r.client_type || undefined,
    corporate_client_id: r.corporate_client_id || undefined, bankReference: r.bank_reference || undefined, bankSender: r.bank_sender || undefined,
    bankAlertText: r.bank_alert_text || undefined, wallet_id: r.wallet_id || undefined, wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
    retrieved: r.retrieved ?? undefined, retrievalNote: r.retrieval_note ?? undefined, retrievedAt: r.retrieved_at ?? undefined,
    retrievedBy: r.retrieved_by ?? undefined, retrievalApproved: r.retrieval_approved ?? undefined, retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
    retrievalApprovedAt: r.retrieval_approved_at ?? undefined, is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined,
    raw: r,
  } as Transaction;
}

function mapBaggageRow(r: any, profileLookup: Record<string, string>): Transaction {
  const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
  return {
    id: r.transaction_id || r.id, name: r.passenger_name || 'Baggage Passenger',
    detail: `${r.flight_no || ''} · ${r.destination || ''} · ${r.total_pcs || 1}pcs · +${r.excess_kg || 0}kg excess`,
    amount: r.amount || 0,
    mode: r.payment_mode === 'Debt' && Number(r.amount_paid || 0) >= Number(r.amount || 0) ? 'Debt Paid' : (r.payment_mode || 'POS'),
    time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
    type: 'baggage', status: 'Delivered', created_at: r.created_at, bank: r.bank, hub_id: r.hub_id, airline: r.airline,
    destination: r.destination, excessKg: r.excess_kg, totalKg: r.total_kg, flight: r.flight_no, pnr: r.pnr || undefined,
    kg: r.excess_kg, pieces: r.total_pcs, enteredByName: enteredByName || undefined, editedBy: r.last_edited_by || undefined,
    editedAt: r.last_edited_at || undefined, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [],
    paymentConfirmed: r.payment_confirmed, posApprovalCode: r.pos_approval_code || undefined, confirmedBy: r.confirmed_by || undefined,
    confirmedAt: r.confirmed_at || undefined, bankReference: r.bank_reference || undefined, bankSender: r.bank_sender || undefined,
    bankAlertText: r.bank_alert_text || undefined, wallet_id: r.wallet_id || undefined, wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
    retrieved: r.retrieved ?? undefined, retrievalNote: r.retrieval_note ?? undefined, retrievedAt: r.retrieved_at ?? undefined,
    retrievedBy: r.retrieved_by ?? undefined, retrievalApproved: r.retrieval_approved ?? undefined, retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
    retrievalApprovedAt: r.retrieval_approved_at ?? undefined, is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined,
    remarks: r.remark || undefined, raw: r,
  } as Transaction;
}

function mapMarketingRow(r: any, profileLookup: Record<string, string>): Transaction {
  const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
  return {
    id: r.entry_ref || r.id, awb_tag_number: r.awb_tag_number || undefined, name: r.customer_name || 'Customer',
    detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
    amount: r.amount_paid || 0,
    mode: r.payment_mode === 'Debt' && Number(r.debt_amount_paid || 0) >= Number(r.amount_paid || 0) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
    time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
    type: 'marketing', status: 'Intake', created_at: r.created_at, bank: r.bank, hub_id: r.hub_id, route: r.route,
    airline: r.airline || undefined, enteredByName: enteredByName || undefined, editedBy: r.last_edited_by || undefined,
    editedAt: r.last_edited_at || undefined, amountPaid: r.debt_amount_paid || 0, paymentHistory: r.payment_history || [],
    paymentConfirmed: r.payment_confirmed, posApprovalCode: r.pos_approval_code || undefined, confirmedBy: r.confirmed_by || undefined,
    confirmedAt: r.confirmed_at || undefined, bankReference: r.bank_reference || undefined, bankSender: r.bank_sender || undefined,
    bankAlertText: r.bank_alert_text || undefined, wallet_id: r.wallet_id || undefined, wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
    retrieved: r.retrieved ?? undefined, retrievalNote: r.retrieval_note ?? undefined, retrievedAt: r.retrieved_at ?? undefined,
    retrievedBy: r.retrieved_by ?? undefined, retrievalApproved: r.retrieval_approved ?? undefined, retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
    retrievalApprovedAt: r.retrieval_approved_at ?? undefined, consigneePhone: r.customer_phone || undefined,
    is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined, remarks: r.remark || undefined,
    raw: r,
  } as Transaction;
}

function mapPackageRow(r: any, profileLookup: Record<string, string>): Transaction {
  const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
  return {
    id: r.entry_ref || r.id, name: r.customer_name || 'Customer',
    detail: `${r.destination || ''} · ${r.content_type || 'Package'} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg${r.contents ? ` · ${r.contents}` : ''}`,
    amount: r.amount || 0,
    mode: r.payment_mode === 'Debt' && (r.debt_paid === true || Number(r.amount_paid || 0) >= Number(r.amount || 0)) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
    time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
    type: 'package', status: r.status || 'Intake', created_at: r.created_at, bank: r.bank, hub_id: r.hub_id, terminal: r.terminal,
    destination: r.destination, contentType: r.content_type, pieces: r.total_pcs || undefined, kg: r.total_kg || undefined,
    contents: r.contents || undefined, paymentNarration: r.payment_narration || undefined, debtPaid: r.debt_paid ?? undefined,
    debtPaidAt: r.debt_paid_at || undefined, enteredByName: enteredByName || undefined, editedBy: r.last_edited_by || undefined,
    editedAt: r.last_edited_at || undefined, amountPaid: r.amount_paid || 0, paymentHistory: r.payment_history || [],
    paymentConfirmed: r.payment_confirmed, posApprovalCode: r.pos_approval_code || undefined, confirmedBy: r.confirmed_by || undefined,
    confirmedAt: r.confirmed_at || undefined, wallet_id: r.wallet_id || undefined, wallet_deduction_amount: r.wallet_deduction_amount ?? undefined,
    retrieved: r.retrieved ?? undefined, retrievalNote: r.retrieval_note ?? undefined, retrievedAt: r.retrieved_at ?? undefined,
    retrievedBy: r.retrieved_by ?? undefined, retrievalApproved: r.retrieval_approved ?? undefined, retrievalApprovedBy: r.retrieval_approved_by ?? undefined,
    retrievalApprovedAt: r.retrieval_approved_at ?? undefined, consigneePhone: r.customer_phone || undefined,
    is_debt_clearance: r.is_debt_clearance || undefined, related_tx_id: r.related_tx_id || undefined, remarks: r.remark || undefined,
    raw: r,
  } as Transaction;
}

function mapExpenseRow(r: any): Expense {
  return {
    id: r.id,
    type: r.category || 'General',
    amount: r.amount,
    description: r.description,
    time: r.created_at,
    created_at: r.created_at,
    hub_id: r.hub_id,
    status: r.status || 'pending',
    mode: r.mode || undefined,
    bank: r.bank || undefined,
    logged_by: r.logged_by || undefined,
    approvedBy: r.approved_by || undefined,
    approvedAt: r.approved_at || undefined,
    rejectedBy: r.rejected_by || undefined,
    rejectedAt: r.rejected_at || undefined,
  };
}

function mapRow(entryType: string, raw: any, profileLookup: Record<string, string>): LedgerPageRow {
  switch (entryType) {
    case 'cargo': return { entryType, entryId: raw.entry_ref || raw.id, createdAt: raw.created_at, transaction: mapCargoRow(raw, profileLookup) };
    case 'baggage': return { entryType, entryId: raw.transaction_id || raw.id, createdAt: raw.created_at, transaction: mapBaggageRow(raw, profileLookup) };
    case 'marketing': return { entryType, entryId: raw.entry_ref || raw.id, createdAt: raw.created_at, transaction: mapMarketingRow(raw, profileLookup) };
    case 'package': return { entryType, entryId: raw.entry_ref || raw.id, createdAt: raw.created_at, transaction: mapPackageRow(raw, profileLookup) };
    case 'expense': return { entryType: 'expense', entryId: raw.id, createdAt: raw.created_at, expense: mapExpenseRow(raw) };
    default: return { entryType: entryType as any, entryId: raw.id, createdAt: raw.created_at };
  }
}

export async function fetchLedgerPage(
  params: LedgerSearchParams,
  cursor: LedgerCursor | null,
  profileLookup: Record<string, string>,
  limit: number = LEDGER_PAGE_SIZE,
): Promise<LedgerPageResult> {
  const { data, error } = await supabase.rpc('ledger_search_page', {
    ...toRpcParams(params),
    p_cursor_created_at: cursor?.createdAt || null,
    p_cursor_entry_id: cursor?.entryId || null,
    p_limit: limit,
  });
  if (error) throw error;
  const rawRows: any[] = data || [];
  const rows = rawRows.map((row) => mapRow(row.entry_type, row.raw, profileLookup));
  const last = rawRows[rawRows.length - 1];
  const hasMore = rawRows.length >= limit;
  return {
    rows,
    nextCursor: hasMore && last ? { createdAt: last.created_at, entryId: last.entry_id } : null,
    hasMore,
  };
}

export async function fetchLedgerTotals(params: LedgerSearchParams): Promise<LedgerTotals> {
  const { data, error } = await supabase.rpc('ledger_search_totals', toRpcParams(params));
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    totalAmount: Number(row?.total_amount || 0),
    cashAmount: Number(row?.cash_amount || 0),
    transferAmount: Number(row?.transfer_amount || 0),
    posAmount: Number(row?.pos_amount || 0),
    debtAmount: Number(row?.debt_amount || 0),
    walletAmount: Number(row?.wallet_amount || 0),
    unpaidDebtCount: Number(row?.unpaid_debt_count || 0),
    officeDebtAmount: Number(row?.office_debt_amount || 0),
    individualDebtAmount: Number(row?.individual_debt_amount || 0),
    rowCount: Number(row?.row_count || 0),
  };
}
