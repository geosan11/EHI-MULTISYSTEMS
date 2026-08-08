-- Super-admin transaction delete. None of the 4 department tables have an
-- RLS DELETE policy today, so a raw client-side delete is silently
-- rejected -- this SECURITY DEFINER function is the only way to actually
-- remove a row, and does its own role check since RLS has nothing to
-- bypass (same shape as force_delete_wallet in
-- 20260905_force_delete_wallet.sql / 20260907_wallet_rpc_security_hardening.sql).
--
-- Deliberately scoped to the simple, safe case -- an entry with no money
-- already moved through it elsewhere -- rather than trying to auto-reverse
-- a wallet debit or a retrieval refund here too. Those reversals already
-- exist and are well-exercised (Unretrieve, reopen_*_debt); duplicating
-- that logic inside a delete path risks the two drifting apart. If any of
-- those apply, this raises a specific error telling the caller what to
-- undo first instead of silently doing it for them.
--
-- One function branching per table (IF/ELSIF, not dynamic SQL) rather than
-- 4 near-duplicate functions -- matches scan_update_entry_status's style
-- in 20260935_scan_status_update_rpc.sql. Unlike clear_*_debt/reopen_*_debt,
-- there's no per-table column-naming inversion here that would justify
-- splitting these into 4 separate functions.

CREATE OR REPLACE FUNCTION public.delete_transaction(
  p_type      text,
  p_entry_id  text,
  p_logged_by text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_outstanding numeric;
BEGIN
  IF public.current_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can delete a transaction';
  END IF;

  IF p_type = 'cargo' THEN
    SELECT amount, amount_paid, retrieved_amount, wallet_id, wallet_deduction_amount,
           corporate_client_id, receipt_mode, is_debt_clearance
    INTO v_entry
    FROM public.cargo_entries
    WHERE entry_ref = p_entry_id;
  ELSIF p_type = 'baggage' THEN
    SELECT amount, amount_paid, retrieved_amount, wallet_id, wallet_deduction_amount,
           corporate_client_id, payment_mode AS receipt_mode, is_debt_clearance
    INTO v_entry
    FROM public.manifests
    WHERE transaction_id = p_entry_id;
  ELSIF p_type = 'marketing' THEN
    -- Naming inversion (same as clear_marketing_debt): amount_paid holds
    -- the real sale total, debt_amount_paid tracks running debt repayment.
    SELECT amount_paid AS amount, debt_amount_paid AS amount_paid, retrieved_amount,
           wallet_id, wallet_deduction_amount, corporate_client_id, payment_mode AS receipt_mode,
           is_debt_clearance
    INTO v_entry
    FROM public.marketing_entries
    WHERE entry_ref = p_entry_id;
  ELSIF p_type = 'package' THEN
    SELECT amount, amount_paid, retrieved_amount, wallet_id, wallet_deduction_amount,
           corporate_client_id, payment_mode AS receipt_mode, is_debt_clearance
    INTO v_entry
    FROM public.package_entries
    WHERE entry_ref = p_entry_id;
  ELSE
    RAISE EXCEPTION 'Unknown transaction type "%"', p_type;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '% entry % not found', p_type, p_entry_id;
  END IF;

  IF v_entry.wallet_id IS NOT NULL AND COALESCE(v_entry.wallet_deduction_amount, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot delete -- this entry was paid (in full or part) via customer wallet; reverse that separately first';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot delete -- this entry has a retrieval/refund on record; use Unretrieve first';
  END IF;

  IF v_entry.is_debt_clearance THEN
    RAISE EXCEPTION 'Cannot delete -- this is a debt-collection record; deleting it would corrupt historical collection totals';
  END IF;

  IF v_entry.corporate_client_id IS NOT NULL AND v_entry.receipt_mode = 'Debt' THEN
    v_outstanding := GREATEST(COALESCE(v_entry.amount, 0) - COALESCE(v_entry.amount_paid, 0), 0);
    IF v_outstanding > 0 THEN
      UPDATE public.corporate_clients
      SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - v_outstanding, 0)
      WHERE id = v_entry.corporate_client_id::uuid;
    END IF;
  END IF;

  IF p_type = 'cargo' THEN
    DELETE FROM public.cargo_entries WHERE entry_ref = p_entry_id;
  ELSIF p_type = 'baggage' THEN
    DELETE FROM public.manifests WHERE transaction_id = p_entry_id;
  ELSIF p_type = 'marketing' THEN
    DELETE FROM public.marketing_entries WHERE entry_ref = p_entry_id;
  ELSIF p_type = 'package' THEN
    DELETE FROM public.package_entries WHERE entry_ref = p_entry_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_transaction(text, text, text) TO authenticated;
