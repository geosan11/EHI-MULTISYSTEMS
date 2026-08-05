-- reconcile_package_office_entry/reconcile_baggage_office_entry/
-- reconcile_marketing_office_entry (20260926_office_work_all_departments.sql)
-- omitted the last_edited_by/last_edited_at assignments the original
-- reconcile_office_entry (cargo, 20260825_office_work_reconciliation.sql)
-- already has -- all 4 tables have had these columns since
-- 20260822_edit_attribution.sql, and OfficeWorkReconciliation.tsx already
-- passes p_logged_by through, but for package/baggage/marketing it was
-- silently dropped: a retroactive reprice+link left no record of who did it.
CREATE OR REPLACE FUNCTION public.reconcile_package_office_entry(
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
  IF NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reconcile office-work entries';
  END IF;
  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'New amount cannot be negative (got %)', p_new_amount;
  END IF;

  SELECT corporate_client_id, amount, amount_paid, retrieved_amount, payment_mode
  INTO v
  FROM public.package_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package entry % not found', p_entry_ref;
  END IF;

  IF v.corporate_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Entry % is already linked to a corporate client', p_entry_ref;
  END IF;

  UPDATE public.package_entries SET
    corporate_client_id   = p_client_id::text,
    client_type           = 'Corporate',
    linked_as_office_work  = true,
    amount                = p_new_amount,
    applied_rate_per_kg   = COALESCE(p_new_rate, applied_rate_per_kg),
    last_edited_by        = COALESCE(p_logged_by, last_edited_by),
    last_edited_at        = now()
  WHERE entry_ref = p_entry_ref;

  IF v.payment_mode = 'Debt' THEN
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

CREATE OR REPLACE FUNCTION public.reconcile_baggage_office_entry(
  p_transaction_id text,
  p_client_id      uuid,
  p_new_amount     numeric,
  p_new_rate       numeric DEFAULT NULL,
  p_logged_by      text    DEFAULT NULL
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
  IF NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reconcile office-work entries';
  END IF;
  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'New amount cannot be negative (got %)', p_new_amount;
  END IF;

  SELECT corporate_client_id, amount, amount_paid, retrieved_amount, payment_mode
  INTO v
  FROM public.manifests
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage manifest % not found', p_transaction_id;
  END IF;

  IF v.corporate_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Entry % is already linked to a corporate client', p_transaction_id;
  END IF;

  UPDATE public.manifests SET
    corporate_client_id   = p_client_id::text,
    client_type           = 'Corporate',
    linked_as_office_work  = true,
    amount                = p_new_amount,
    applied_rate_per_kg   = COALESCE(p_new_rate, applied_rate_per_kg),
    last_edited_by        = COALESCE(p_logged_by, last_edited_by),
    last_edited_at        = now()
  WHERE transaction_id = p_transaction_id;

  IF v.payment_mode = 'Debt' THEN
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

CREATE OR REPLACE FUNCTION public.reconcile_marketing_office_entry(
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
  IF NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reconcile office-work entries';
  END IF;
  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'New amount cannot be negative (got %)', p_new_amount;
  END IF;

  SELECT corporate_client_id, amount_paid, debt_amount_paid, retrieved_amount, payment_mode
  INTO v
  FROM public.marketing_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketing entry % not found', p_entry_ref;
  END IF;

  IF v.corporate_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Entry % is already linked to a corporate client', p_entry_ref;
  END IF;

  UPDATE public.marketing_entries SET
    corporate_client_id   = p_client_id::text,
    client_type           = 'Corporate',
    linked_as_office_work  = true,
    amount_paid           = p_new_amount,
    applied_rate_per_kg   = COALESCE(p_new_rate, applied_rate_per_kg),
    last_edited_by        = COALESCE(p_logged_by, last_edited_by),
    last_edited_at        = now()
  WHERE entry_ref = p_entry_ref;

  IF v.payment_mode = 'Debt' THEN
    v_added := GREATEST(p_new_amount - COALESCE(v.debt_amount_paid, 0) - COALESCE(v.retrieved_amount, 0), 0);
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
