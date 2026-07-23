import { supabase } from './supabase';

export type PaymentEntryType = 'cargo' | 'baggage' | 'marketing' | 'package';

export interface ConfirmPaymentResult {
  ok: boolean;
  error?: string;
}

const RPC_BY_TYPE: Record<PaymentEntryType, { name: string; idParam: string }> = {
  cargo: { name: 'confirm_payment_cargo', idParam: 'p_entry_ref' },
  baggage: { name: 'confirm_payment_baggage', idParam: 'p_transaction_id' },
  marketing: { name: 'confirm_payment_marketing', idParam: 'p_entry_ref' },
  package: { name: 'confirm_payment_package', idParam: 'p_entry_ref' },
};

// Toggles payment_confirmed (and, for a POS approval code, sets it too) via
// a state-wide-authorized RPC -- the generic client .update() path
// (TransactionLedger.tsx's onUpdateTx) is hub-locked to an exact match
// (see 20260902_multi_department_retrieval_and_wallet_cashout.sql's own
// comment on why), so any non-hub-unrestricted staff member confirming
// payment on a sibling hub's visible-but-not-their-own entry would
// otherwise hit a silent 0-rows-affected UPDATE. Mirrors debt.ts's
// clearDebt() pattern exactly -- one client entry point routed to the
// matching per-table RPC.
export async function confirmPayment(type: PaymentEntryType, params: {
  id: string;
  confirmed: boolean;
  posApprovalCode?: string;
  loggedBy: string;
  // Only meaningful for cargo/baggage/marketing -- package_entries has no
  // bank_reference/bank_sender/bank_alert_text columns (its debt is
  // Cash/POS-collected, not Transfer), so these are simply ignored by
  // confirm_payment_package's narrower signature.
  bankReference?: string;
  bankSender?: string;
  bankAlertText?: string;
}): Promise<ConfirmPaymentResult> {
  const rpc = RPC_BY_TYPE[type];
  if (!rpc) {
    return { ok: false, error: `Payment confirmation isn't supported for transaction type "${type}"` };
  }

  const rpcParams: Record<string, unknown> = {
    [rpc.idParam]: params.id,
    p_confirmed: params.confirmed,
    p_pos_approval_code: params.posApprovalCode ?? null,
    p_logged_by: params.loggedBy,
  };
  if (type !== 'package') {
    rpcParams.p_bank_reference = params.bankReference ?? null;
    rpcParams.p_bank_sender = params.bankSender ?? null;
    rpcParams.p_bank_alert_text = params.bankAlertText ?? null;
  }

  const { error } = await supabase.rpc(rpc.name, rpcParams);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
