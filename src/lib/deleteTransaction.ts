import { supabase } from './supabase';
import { DebtEntryType } from './debt';

export interface DeleteTransactionResult {
  ok: boolean;
  error?: string;
}

// Single entry point for permanently deleting a transaction, across all
// four department tables. Routes through delete_transaction (see
// supabase/migrations/20260937_delete_transaction_rpc.sql), which is the
// only way to actually remove a row -- none of these tables have an RLS
// DELETE policy, and the RPC does its own super_admin-only role check
// since there's no RLS to bypass. Deliberately refuses (rather than
// auto-reversing) when the entry was wallet-paid, already retrieved, or is
// a debt-collection shadow row -- the RPC's error message names the
// specific reason, returned here verbatim so the caller can surface it.
export async function deleteTransaction(params: {
  type: DebtEntryType;
  id: string;
  loggedBy: string;
}): Promise<DeleteTransactionResult> {
  const { error } = await supabase.rpc('delete_transaction', {
    p_type: params.type,
    p_entry_id: params.id,
    p_logged_by: params.loggedBy,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
