-- ============================================================
-- OFFICE-WORK RECONCILIATION: applied-rate receipt + atomic repair
-- ============================================================

ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS applied_rate_per_kg numeric(10,2);

-- Link + reprice a single still-unlinked cargo entry, atomically. For Debt
-- entries, fold the corrected outstanding into the corporate running balance.
-- Idempotent: refuses to touch an entry that is already linked.
CREATE OR REPLACE FUNCTION public.reconcile_office_entry(
  p_entry_ref  text,
  p_client_id  uuid,
  p_new_amount numeric,
  p_new_rate   numeric DEFAULT NULL,
  p_logged_by  text    DEFAULT NULL
)
RETURNS TABLE (ok boolean, added_to_debt numeric, corporate_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v      RECORD;
  v_added numeric := 0;
  v_bal   numeric;
BEGIN
  -- Reconciliation is an admin/accountant action only.
  IF NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reconcile office-work entries';
  END IF;
  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'New amount cannot be negative (got %)', p_new_amount;
  END IF;

  SELECT corporate_client_id, amount, amount_paid, retrieved_amount, receipt_mode
  INTO v
  FROM public.cargo_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
  END IF;

  -- Idempotency guard: never double-apply / never override an existing link.
  IF v.corporate_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Entry % is already linked to a corporate client', p_entry_ref;
  END IF;

  -- cargo_entries.corporate_client_id is `text` on the live database (not
  -- `uuid` as its original CREATE TABLE declares -- see the corrected note
  -- in 20260715_cargo_entries_corporate_client_id.sql, confirmed by a live
  -- "operator does not exist: text = uuid" error from the dedupe migration).
  -- p_client_id::text makes this assignment work against the real type.
  UPDATE public.cargo_entries SET
    corporate_client_id  = p_client_id::text,
    client_type          = 'Corporate',
    linked_as_office_work = true,
    amount               = p_new_amount,
    applied_rate_per_kg  = COALESCE(p_new_rate, applied_rate_per_kg),
    last_edited_by       = COALESCE(p_logged_by, last_edited_by),
    last_edited_at       = now()
  WHERE entry_ref = p_entry_ref;

  IF v.receipt_mode = 'Debt' THEN
    v_added := GREATEST(p_new_amount - COALESCE(v.amount_paid, 0) - COALESCE(v.retrieved_amount, 0), 0);
    IF v_added > 0 THEN
      UPDATE public.corporate_clients
      SET accumulated_monthly_debt = accumulated_monthly_debt + v_added
      WHERE id = p_client_id
      RETURNING accumulated_monthly_debt INTO v_bal;
    END IF;
  END IF;

  IF v_bal IS NULL THEN
    SELECT accumulated_monthly_debt INTO v_bal FROM public.corporate_clients WHERE id = p_client_id;
  END IF;

  RETURN QUERY SELECT true, v_added, COALESCE(v_bal, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_office_entry(text, uuid, numeric, numeric, text) TO authenticated;
