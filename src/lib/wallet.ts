import { supabase } from './supabase';

export type WalletTxnType = 'top_up' | 'deduction' | 'refund' | 'adjustment';

export interface WalletTxnResult {
  ok: boolean;
  newBalance?: number;
  transactionId?: string;
  error?: string;
}

// Single entry point for every wallet balance mutation in the app.
// Routes through apply_wallet_transaction() (see
// supabase/migrations/20260810_wallet_atomicity_and_isolation.sql),
// which locks the wallet row, checks hub ownership, floors deductions
// at zero, and writes the balance update + its wallet_transactions
// audit row in one atomic call -- replacing the old pattern of every
// call site computing balance +/- amount in JS and writing it back
// as two separate, unchecked, un-awaited requests.
export async function applyWalletTransaction(params: {
  walletId: string;
  type: WalletTxnType;
  amount: number;
  cargoRef?: string;
  cargoEntryId?: string;
  description?: string;
  loggedBy: string;
  // How a 'top_up' was physically collected -- meaningful for top_up only,
  // ignored server-side for every other type. Lets EODReconciliation.tsx
  // fold real cash/transfer/POS top-ups into its expected-cash math instead
  // of that cash being invisible to the day's reconciliation.
  paymentMode?: 'Cash' | 'Transfer' | 'POS';
}): Promise<WalletTxnResult> {
  const { data, error } = await supabase.rpc('apply_wallet_transaction', {
    p_wallet_id: params.walletId,
    p_type: params.type,
    p_amount: params.amount,
    p_cargo_ref: params.cargoRef ?? null,
    p_cargo_entry_id: params.cargoEntryId ?? null,
    p_description: params.description ?? null,
    p_logged_by: params.loggedBy,
    p_payment_mode: params.paymentMode ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, newBalance: Number(row?.new_balance), transactionId: row?.transaction_id };
}

export interface RetrievalResult {
  ok: boolean;
  walletId?: string;
  newBalance?: number;
  walletRefund?: number;
  debtReduction?: number;
  // 'pending' when walletRefund > 0 -- the refund now always needs a
  // second person's approval (approveRetrievalRefund) before newBalance
  // actually reflects it; 'none' when there was nothing to refund at all.
  refundStatus?: 'pending' | 'none';
  refundTransactionId?: string;
  error?: string;
}

export type RetrievalEntryType = 'cargo' | 'baggage' | 'marketing' | 'package';

// One client entry point, routed to the right per-department RPC --
// mirrors debt.ts's RPC_BY_TYPE pattern, which already established this
// same "one action, four department-specific SQL functions" split for
// clearing debt (each table's id column differs; see
// 20260902_multi_department_retrieval_and_wallet_cashout.sql for why a
// single dynamic-table function isn't used instead).
const RETRIEVAL_RPC_BY_TYPE: Record<RetrievalEntryType, { name: string; idParam: string }> = {
  cargo: { name: 'process_cargo_retrieval', idParam: 'p_entry_ref' },
  baggage: { name: 'process_baggage_retrieval', idParam: 'p_transaction_id' },
  marketing: { name: 'process_marketing_retrieval', idParam: 'p_entry_ref' },
  package: { name: 'process_package_retrieval', idParam: 'p_entry_ref' },
};

// Full or partial retrieval refund for any of the 4 entry types. Routes
// through process_<type>_retrieval(), which locks the entry row and
// rejects a refund that would push cumulative retrieved_amount past the
// entry's original amount -- so a double-click, a retry, or a later
// "full" retrieval on an already-partially-retrieved entry can't each
// credit the wallet again for the same goods.
export async function processRetrieval(type: RetrievalEntryType, params: {
  entryRef: string;
  isPartial: boolean;
  retrievedValue: number;
  retrievedPieces: number;
  retrievedKg: number;
  customerName: string;
  hubId?: string;
  loggedBy: string;
  walletId?: string;
  customerPhone?: string;
}): Promise<RetrievalResult> {
  const rpc = RETRIEVAL_RPC_BY_TYPE[type];
  if (!rpc) {
    return { ok: false, error: `Retrieval isn't supported for transaction type "${type}"` };
  }

  const { data, error } = await supabase.rpc(rpc.name, {
    [rpc.idParam]: params.entryRef,
    p_is_partial: params.isPartial,
    p_retrieved_value: params.retrievedValue,
    p_retrieved_pieces: params.retrievedPieces,
    p_retrieved_kg: params.retrievedKg,
    p_customer_name: params.customerName,
    p_hub_id: params.hubId ?? null,
    p_logged_by: params.loggedBy,
    p_wallet_id: params.walletId ?? null,
    p_customer_phone: params.customerPhone ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    walletId: row?.wallet_id,
    newBalance: Number(row?.new_balance),
    walletRefund: Number(row?.wallet_refund ?? 0),
    debtReduction: Number(row?.debt_reduction ?? 0),
    refundStatus: row?.refund_status,
    refundTransactionId: row?.refund_transaction_id ?? undefined,
  };
}

const UNRETRIEVE_RPC_BY_TYPE: Record<RetrievalEntryType, { name: string; idParam: string }> = {
  cargo: { name: 'unretrieve_cargo_entry', idParam: 'p_entry_ref' },
  baggage: { name: 'unretrieve_baggage_entry', idParam: 'p_transaction_id' },
  marketing: { name: 'unretrieve_marketing_entry', idParam: 'p_entry_ref' },
  package: { name: 'unretrieve_package_entry', idParam: 'p_entry_ref' },
};

export interface UnretrieveResult {
  ok: boolean;
  reversedAmount?: number;
  walletReversed?: number;
  error?: string;
}

// Reverses a mistaken retrieval's bookkeeping on the entry itself
// (retrieved_pieces/kg/amount/retrieved/status back to never-retrieved) AND
// claws back, via an equal-and-opposite wallet deduction, any wallet credit
// that retrieval paid out (supabase/migrations/20260913_retrieval_reversal_
// and_wallet_matching_parity.sql) -- both happen atomically in the one RPC
// call, so the entry is never reset while an already-paid-out credit is
// left dangling. If the customer already spent that credit elsewhere, the
// RPC raises an "Insufficient wallet balance" error and leaves the entry
// untouched instead of silently reopening a double-credit hole.
export async function unretrieveEntry(type: RetrievalEntryType, params: {
  entryRef: string;
  loggedBy: string;
}): Promise<UnretrieveResult> {
  const rpc = UNRETRIEVE_RPC_BY_TYPE[type];
  if (!rpc) {
    return { ok: false, error: `Unretrieve isn't supported for transaction type "${type}"` };
  }
  const { data, error } = await supabase.rpc(rpc.name, {
    [rpc.idParam]: params.entryRef,
    p_logged_by: params.loggedBy,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, reversedAmount: Number(row?.reversed_amount ?? 0), walletReversed: Number(row?.wallet_reversed ?? 0) };
}

const APPROVE_RETRIEVAL_RPC_BY_TYPE: Record<RetrievalEntryType, { name: string; idParam: string }> = {
  cargo: { name: 'approve_cargo_retrieval', idParam: 'p_entry_ref' },
  baggage: { name: 'approve_baggage_retrieval', idParam: 'p_transaction_id' },
  marketing: { name: 'approve_marketing_retrieval', idParam: 'p_entry_ref' },
  package: { name: 'approve_package_retrieval', idParam: 'p_entry_ref' },
};

export interface ApproveRetrievalResult {
  ok: boolean;
  error?: string;
}

// Post-hoc review stamp for an already-processed retrieval -- does not
// re-trigger any wallet/debt movement. Routes through approve_<type>_
// retrieval(), which re-checks the caller's can_approve_retrievals
// permission server-side (see 20260906_retrieval_approval_and_permission.sql)
// rather than trusting the client-side gate alone.
export async function approveRetrieval(type: RetrievalEntryType, params: {
  entryRef: string;
  approvedBy: string;
}): Promise<ApproveRetrievalResult> {
  const rpc = APPROVE_RETRIEVAL_RPC_BY_TYPE[type];
  if (!rpc) {
    return { ok: false, error: `Retrieval approval isn't supported for transaction type "${type}"` };
  }
  const { error } = await supabase.rpc(rpc.name, {
    [rpc.idParam]: params.entryRef,
    p_approved_by: params.approvedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface CashPayoutResult {
  ok: boolean;
  transactionId?: string;
  newBalance?: number;
  error?: string;
}

// Requests a cash payout from a customer's existing wallet balance --
// e.g. staff hand the customer physical cash instead of holding the
// credit for a future purchase. Does NOT deduct the balance -- it only
// creates a 'pending' wallet_transactions row for a different person
// (accountant/admin/super_admin) to approve or reject via
// approveWalletCashPayout/rejectWalletCashPayout below.
export async function requestWalletCashPayout(params: {
  walletId: string;
  amount: number;
  department: RetrievalEntryType;
  requestedBy: string;
  note?: string;
}): Promise<CashPayoutResult> {
  const { data, error } = await supabase.rpc('request_wallet_cash_payout', {
    p_wallet_id: params.walletId,
    p_amount: params.amount,
    p_department: params.department,
    p_requested_by: params.requestedBy,
    p_note: params.note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, transactionId: data as string };
}

// Approves a pending cash payout and applies the real deduction. The RPC
// itself also rejects self-approval (the requester can't also be the
// approver) -- this client wrapper doesn't duplicate that check, it just
// surfaces the RPC's own error message.
export async function approveWalletCashPayout(params: {
  transactionId: string;
  approvedBy: string;
}): Promise<CashPayoutResult> {
  const { data, error } = await supabase.rpc('approve_wallet_cash_payout', {
    p_transaction_id: params.transactionId,
    p_approved_by: params.approvedBy,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, newBalance: Number(data) };
}

export async function rejectWalletCashPayout(params: {
  transactionId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<CashPayoutResult> {
  const { error } = await supabase.rpc('reject_wallet_cash_payout', {
    p_transaction_id: params.transactionId,
    p_rejected_by: params.rejectedBy,
    p_reason: params.reason ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Requests a wallet top-up without applying it -- open to ANY authenticated,
// hub-matched user (same as requestWalletCashPayout), including roles
// apply_wallet_transaction() blocks from the direct/immediate top-up path
// (cargo_agent, baggage_agent, marketing_agent, driver, office_work).
// Creates a 'pending' wallet_transactions row for accountant/admin/
// super_admin to approve or reject via approveWalletTopUp/rejectWalletTopUp.
export async function requestWalletTopUp(params: {
  walletId: string;
  amount: number;
  requestedBy: string;
  paymentMode?: 'Cash' | 'Transfer' | 'POS';
  note?: string;
}): Promise<CashPayoutResult> {
  const { data, error } = await supabase.rpc('request_wallet_top_up', {
    p_wallet_id: params.walletId,
    p_amount: params.amount,
    p_requested_by: params.requestedBy,
    p_payment_mode: params.paymentMode ?? null,
    p_note: params.note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, transactionId: data as string };
}

export async function approveWalletTopUp(params: {
  transactionId: string;
  approvedBy: string;
}): Promise<CashPayoutResult> {
  const { data, error } = await supabase.rpc('approve_wallet_top_up', {
    p_transaction_id: params.transactionId,
    p_approved_by: params.approvedBy,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, newBalance: Number(data) };
}

export async function rejectWalletTopUp(params: {
  transactionId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<CashPayoutResult> {
  const { error } = await supabase.rpc('reject_wallet_top_up', {
    p_transaction_id: params.transactionId,
    p_rejected_by: params.rejectedBy,
    p_reason: params.reason ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Approves a pending retrieval refund (processRetrieval's deferred wallet
// credit) and applies the real balance increase. Shared across all 4
// department types -- by approval time it's purely a wallet_transactions
// row, no department-specific entry table involved.
export async function approveRetrievalRefund(params: {
  transactionId: string;
  approvedBy: string;
}): Promise<CashPayoutResult> {
  const { data, error } = await supabase.rpc('approve_retrieval_refund', {
    p_transaction_id: params.transactionId,
    p_approved_by: params.approvedBy,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, newBalance: Number(data) };
}

// Rejecting a refund does NOT reverse the retrieval's goods-release/debt-
// reduction side (that already happened, unconditionally) -- only the
// wallet-credit side. If the retrieval itself was mistaken, unretrieveEntry
// above is the correct reversal path.
export async function rejectRetrievalRefund(params: {
  transactionId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<CashPayoutResult> {
  const { error } = await supabase.rpc('reject_retrieval_refund', {
    p_transaction_id: params.transactionId,
    p_rejected_by: params.rejectedBy,
    p_reason: params.reason ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
