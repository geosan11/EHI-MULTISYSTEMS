-- =============================================================
-- Office-work (B2B corporate) auto-detection + reconciliation: extend
-- from cargo-only to all 4 departments (package/baggage/marketing)
-- =============================================================
-- corporate_client_id/linked_as_office_work/applied_rate_per_kg
-- (20260715_cargo_entries_corporate_client_id.sql,
-- 20260825_office_work_reconciliation.sql) and reconcile_office_entry()
-- only ever existed on cargo_entries -- package_entries/manifests/
-- marketing_entries had no way to be linked to a corporate client at
-- intake, and OfficeWorkReconciliation.tsx only ever scanned
-- cargo_entries for missed links. client_type already exists on
-- cargo_entries/manifests/marketing_entries (20260710_client_type_column.
-- sql) but was never added to package_entries at all.
-- =============================================================

-- ─── 1. Columns on the 3 remaining tables ──────────────────────────────
ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS client_type           text CHECK (client_type IN ('Corporate','Individual')),
  ADD COLUMN IF NOT EXISTS corporate_client_id    text,
  ADD COLUMN IF NOT EXISTS linked_as_office_work  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_rate_per_kg    numeric(10,2);

ALTER TABLE public.manifests
  ADD COLUMN IF NOT EXISTS corporate_client_id    text,
  ADD COLUMN IF NOT EXISTS linked_as_office_work  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_rate_per_kg    numeric(10,2);

ALTER TABLE public.marketing_entries
  ADD COLUMN IF NOT EXISTS corporate_client_id    text,
  ADD COLUMN IF NOT EXISTS linked_as_office_work  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_rate_per_kg    numeric(10,2);

-- ─── 2. reconcile_package_office_entry ─────────────────────────────────
-- Mirrors reconcile_office_entry (cargo) exactly -- same idempotency
-- guard, same admin/accountant-only gate, same corporate-debt fold-in.
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
    applied_rate_per_kg   = COALESCE(p_new_rate, applied_rate_per_kg)
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

GRANT EXECUTE ON FUNCTION public.reconcile_package_office_entry(text, uuid, numeric, numeric, text) TO authenticated;

-- ─── 3. reconcile_baggage_office_entry ─────────────────────────────────
-- manifests uses transaction_id as its ref column (not entry_ref) --
-- matches process_baggage_retrieval's own naming.
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
    applied_rate_per_kg   = COALESCE(p_new_rate, applied_rate_per_kg)
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

GRANT EXECUTE ON FUNCTION public.reconcile_baggage_office_entry(text, uuid, numeric, numeric, text) TO authenticated;

-- ─── 4. reconcile_marketing_office_entry ───────────────────────────────
-- marketing_entries has the inverted naming convention noted throughout
-- this codebase (see clear_marketing_debt's own comment, debt.ts):
-- amount_paid holds the SALE TOTAL, not what's been paid down -- actual
-- debt repayment tracking is the separate debt_amount_paid column, and
-- the bare `amount` column is never written by the app for this table at
-- all. So here, p_new_amount is the corrected SALE TOTAL and gets written
-- to amount_paid (not amount), and the outstanding-debt fold-in compares
-- against debt_amount_paid (not amount_paid) -- matching CreditDebit.tsx's
-- own mapping of this table.
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
    applied_rate_per_kg   = COALESCE(p_new_rate, applied_rate_per_kg)
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

GRANT EXECUTE ON FUNCTION public.reconcile_marketing_office_entry(text, uuid, numeric, numeric, text) TO authenticated;
