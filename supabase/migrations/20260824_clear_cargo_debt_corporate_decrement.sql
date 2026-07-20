-- ============================================================
-- clear_cargo_debt: also decrement the corporate running balance
-- ============================================================
-- clearDebt() -> clear_cargo_debt (20260819_clear_debt_state_wide.sql)
-- updates cargo_entries.amount_paid but never touched
-- corporate_clients.accumulated_monthly_debt, so a corporate client's
-- running balance stayed inflated after payment -- the old handleUpdateTx
-- path called decrement_corporate_debt() for this, and the RPC path that
-- replaced it dropped that call. Folded in here so it's atomic regardless
-- of caller, mirroring decrement_corporate_debt's own GREATEST-clamped
-- floor at zero. Full CREATE OR REPLACE (re-declares the whole function)
-- so this also works as a re-apply if 20260819 was only partially applied.
-- Only clear_cargo_debt changes; baggage/marketing/package versions are
-- untouched (no corporate_client_id concept on those tables).
CREATE OR REPLACE FUNCTION public.clear_cargo_debt(
  p_entry_ref     text,
  p_payment_amount numeric,
  p_payment_mode  text,
  p_bank          text DEFAULT NULL,
  p_logged_by     text DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_new_amount_paid numeric;
  v_remaining numeric;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT hub_id, amount, amount_paid, retrieved_amount, receipt_mode, corporate_client_id
  INTO v_entry
  FROM public.cargo_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
  END IF;

  IF v_entry.receipt_mode <> 'Debt' THEN
    RAISE EXCEPTION 'Entry % is not a Debt-mode entry', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to clear debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.amount - COALESCE(v_entry.amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);
  IF p_payment_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment of % would exceed remaining balance of %', p_payment_amount, v_remaining;
  END IF;

  v_new_amount_paid := COALESCE(v_entry.amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  UPDATE public.cargo_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) ||
      jsonb_build_object('amount', p_payment_amount, 'mode', p_payment_mode, 'by', COALESCE(p_logged_by, 'system'), 'at', now()),
    bank = COALESCE(p_bank, bank),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  -- NEW: keep the corporate running balance in sync. Mirrors the old
  -- handleUpdateTx decrement that the clearDebt() RPC path had dropped.
  -- cargo_entries.corporate_client_id is `text` (see the corrected note in
  -- 20260715_cargo_entries_corporate_client_id.sql), while
  -- corporate_clients.id is `uuid` -- explicit cast needed to compare them.
  IF v_entry.corporate_client_id IS NOT NULL THEN
    UPDATE public.corporate_clients
    SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - p_payment_amount, 0)
    WHERE id = v_entry.corporate_client_id::uuid;
  END IF;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_cargo_debt(text, numeric, text, text, text) TO authenticated;
