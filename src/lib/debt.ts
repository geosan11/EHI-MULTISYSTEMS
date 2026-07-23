import { supabase } from './supabase';

export type DebtEntryType = 'cargo' | 'baggage' | 'marketing' | 'package';

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
