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
}): Promise<WalletTxnResult> {
  const { data, error } = await supabase.rpc('apply_wallet_transaction', {
    p_wallet_id: params.walletId,
    p_type: params.type,
    p_amount: params.amount,
    p_cargo_ref: params.cargoRef ?? null,
    p_cargo_entry_id: params.cargoEntryId ?? null,
    p_description: params.description ?? null,
    p_logged_by: params.loggedBy,
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
  error?: string;
}

// Full or partial cargo retrieval refund. Routes through
// process_cargo_retrieval(), which locks the cargo entry row and
// rejects a refund that would push cumulative retrieved_amount past
// the entry's original amount -- so a double-click, a retry, or a
// later "full" retrieval on an already-partially-retrieved entry
// can't each credit the wallet again for the same goods.
export async function processCargoRetrieval(params: {
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
  const { data, error } = await supabase.rpc('process_cargo_retrieval', {
    p_entry_ref: params.entryRef,
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
  };
}
