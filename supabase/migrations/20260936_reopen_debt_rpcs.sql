-- Reopen-debt RPCs: the mirror-image of clear_cargo_debt/clear_baggage_debt/
-- clear_marketing_debt/clear_package_debt (20260903_security_and_bugfix_pass.sql).
--
-- Until now there was no way to actually undo a debt clearance -- the only
-- UI path (TransactionLedger's generic Edit modal, picking "Debt" from the
-- Payment Mode dropdown) never touched amount_paid, so a "Debt Paid" entry
-- silently reverted to Debt Paid on the next reload. These four functions
-- give that a real, working implementation.
--
-- Policy: same as clearing a debt -- ANY staff who can see the entry
-- (sibling-hub visibility) can reopen it, not a role-restricted action.
-- Accountability comes from the audit_log row the client writes alongside
-- this call (action DEBT_REOPENED), not from blocking who can call it.
--
-- Each function reverses only the MOST RECENT payment_history entry (the
-- clearance being corrected), not the entry's whole payment history -- a
-- debt may have had legitimate partial payments before the clearance that's
-- being undone, so resetting amount_paid to 0 would destroy real history.

-- CARGO
DROP FUNCTION IF EXISTS public.reopen_cargo_debt(text, text, numeric);

CREATE OR REPLACE FUNCTION public.reopen_cargo_debt(
  p_entry_ref            text,
  p_logged_by            text DEFAULT NULL,
  p_expected_amount_paid numeric DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, reversed_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_remaining numeric;
  v_history_len integer;
  v_last_payment jsonb;
  v_reverse_amount numeric;
  v_new_amount_paid numeric;
BEGIN
  SELECT hub_id, amount, amount_paid, retrieved_amount, payment_history, corporate_client_id
  INTO v_entry
  FROM public.cargo_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reopen debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.amount - COALESCE(v_entry.amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Entry % is not currently fully paid -- nothing to reopen', p_entry_ref;
  END IF;

  IF p_expected_amount_paid IS NOT NULL AND round(COALESCE(v_entry.amount_paid, 0)::numeric, 2) <> round(p_expected_amount_paid::numeric, 2) THEN
    RAISE EXCEPTION 'Amount paid changed since this reopen was prepared (expected %, actual %) -- refresh and retry', p_expected_amount_paid, v_entry.amount_paid;
  END IF;

  v_history_len := COALESCE(jsonb_array_length(v_entry.payment_history), 0);
  IF v_history_len = 0 THEN
    RAISE EXCEPTION 'Entry % has no payment history to reverse', p_entry_ref;
  END IF;

  v_last_payment := v_entry.payment_history -> (v_history_len - 1);
  v_reverse_amount := COALESCE((v_last_payment ->> 'amount')::numeric, 0);
  v_new_amount_paid := GREATEST(COALESCE(v_entry.amount_paid, 0) - v_reverse_amount, 0);

  UPDATE public.cargo_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_confirmed = false,
    confirmed_by = NULL,
    confirmed_at = NULL
  WHERE entry_ref = p_entry_ref;

  IF v_entry.corporate_client_id IS NOT NULL THEN
    UPDATE public.corporate_clients
    SET accumulated_monthly_debt = accumulated_monthly_debt + v_reverse_amount
    WHERE id = v_entry.corporate_client_id::uuid;
  END IF;

  RETURN QUERY SELECT v_new_amount_paid, (v_entry.amount - v_new_amount_paid - COALESCE(v_entry.retrieved_amount, 0)), v_reverse_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_cargo_debt(text, text, numeric) TO authenticated;

-- BAGGAGE
DROP FUNCTION IF EXISTS public.reopen_baggage_debt(text, text, numeric);

CREATE OR REPLACE FUNCTION public.reopen_baggage_debt(
  p_transaction_id       text,
  p_logged_by            text DEFAULT NULL,
  p_expected_amount_paid numeric DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, reversed_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_remaining numeric;
  v_history_len integer;
  v_last_payment jsonb;
  v_reverse_amount numeric;
  v_new_amount_paid numeric;
BEGIN
  SELECT hub_id, amount, amount_paid, retrieved_amount, payment_history
  INTO v_entry
  FROM public.manifests
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage entry % not found', p_transaction_id;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reopen debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.amount - COALESCE(v_entry.amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Entry % is not currently fully paid -- nothing to reopen', p_transaction_id;
  END IF;

  IF p_expected_amount_paid IS NOT NULL AND round(COALESCE(v_entry.amount_paid, 0)::numeric, 2) <> round(p_expected_amount_paid::numeric, 2) THEN
    RAISE EXCEPTION 'Amount paid changed since this reopen was prepared (expected %, actual %) -- refresh and retry', p_expected_amount_paid, v_entry.amount_paid;
  END IF;

  v_history_len := COALESCE(jsonb_array_length(v_entry.payment_history), 0);
  IF v_history_len = 0 THEN
    RAISE EXCEPTION 'Entry % has no payment history to reverse', p_transaction_id;
  END IF;

  v_last_payment := v_entry.payment_history -> (v_history_len - 1);
  v_reverse_amount := COALESCE((v_last_payment ->> 'amount')::numeric, 0);
  v_new_amount_paid := GREATEST(COALESCE(v_entry.amount_paid, 0) - v_reverse_amount, 0);

  UPDATE public.manifests SET
    amount_paid = v_new_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_confirmed = false,
    confirmed_by = NULL,
    confirmed_at = NULL
  WHERE transaction_id = p_transaction_id;

  RETURN QUERY SELECT v_new_amount_paid, (v_entry.amount - v_new_amount_paid - COALESCE(v_entry.retrieved_amount, 0)), v_reverse_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_baggage_debt(text, text, numeric) TO authenticated;

-- MARKETING (inverted naming: amount_paid holds the sale total, debt
-- repayment tracking lives in debt_amount_paid -- see clear_marketing_debt)
DROP FUNCTION IF EXISTS public.reopen_marketing_debt(text, text, numeric);

CREATE OR REPLACE FUNCTION public.reopen_marketing_debt(
  p_entry_ref            text,
  p_logged_by            text DEFAULT NULL,
  p_expected_amount_paid numeric DEFAULT NULL
)
RETURNS TABLE (new_debt_amount_paid numeric, remaining_balance numeric, reversed_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_remaining numeric;
  v_history_len integer;
  v_last_payment jsonb;
  v_reverse_amount numeric;
  v_new_debt_amount_paid numeric;
BEGIN
  SELECT hub_id, amount_paid AS sale_amount, debt_amount_paid, retrieved_amount, payment_history
  INTO v_entry
  FROM public.marketing_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketing entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reopen debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.sale_amount - COALESCE(v_entry.debt_amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Entry % is not currently fully paid -- nothing to reopen', p_entry_ref;
  END IF;

  IF p_expected_amount_paid IS NOT NULL AND round(COALESCE(v_entry.debt_amount_paid, 0)::numeric, 2) <> round(p_expected_amount_paid::numeric, 2) THEN
    RAISE EXCEPTION 'Amount paid changed since this reopen was prepared (expected %, actual %) -- refresh and retry', p_expected_amount_paid, v_entry.debt_amount_paid;
  END IF;

  v_history_len := COALESCE(jsonb_array_length(v_entry.payment_history), 0);
  IF v_history_len = 0 THEN
    RAISE EXCEPTION 'Entry % has no payment history to reverse', p_entry_ref;
  END IF;

  v_last_payment := v_entry.payment_history -> (v_history_len - 1);
  v_reverse_amount := COALESCE((v_last_payment ->> 'amount')::numeric, 0);
  v_new_debt_amount_paid := GREATEST(COALESCE(v_entry.debt_amount_paid, 0) - v_reverse_amount, 0);

  UPDATE public.marketing_entries SET
    debt_amount_paid = v_new_debt_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_confirmed = false,
    confirmed_by = NULL,
    confirmed_at = NULL
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_debt_amount_paid, (v_entry.sale_amount - v_new_debt_amount_paid - COALESCE(v_entry.retrieved_amount, 0)), v_reverse_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_marketing_debt(text, text, numeric) TO authenticated;

-- PACKAGE
DROP FUNCTION IF EXISTS public.reopen_package_debt(text, text, numeric);

CREATE OR REPLACE FUNCTION public.reopen_package_debt(
  p_entry_ref            text,
  p_logged_by            text DEFAULT NULL,
  p_expected_amount_paid numeric DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, reversed_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_remaining numeric;
  v_history_len integer;
  v_last_payment jsonb;
  v_reverse_amount numeric;
  v_new_amount_paid numeric;
BEGIN
  SELECT hub_id, amount, amount_paid, retrieved_amount, payment_history
  INTO v_entry
  FROM public.package_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package entry % not found', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to reopen debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.amount - COALESCE(v_entry.amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Entry % is not currently fully paid -- nothing to reopen', p_entry_ref;
  END IF;

  IF p_expected_amount_paid IS NOT NULL AND round(COALESCE(v_entry.amount_paid, 0)::numeric, 2) <> round(p_expected_amount_paid::numeric, 2) THEN
    RAISE EXCEPTION 'Amount paid changed since this reopen was prepared (expected %, actual %) -- refresh and retry', p_expected_amount_paid, v_entry.amount_paid;
  END IF;

  v_history_len := COALESCE(jsonb_array_length(v_entry.payment_history), 0);
  IF v_history_len = 0 THEN
    RAISE EXCEPTION 'Entry % has no payment history to reverse', p_entry_ref;
  END IF;

  v_last_payment := v_entry.payment_history -> (v_history_len - 1);
  v_reverse_amount := COALESCE((v_last_payment ->> 'amount')::numeric, 0);
  v_new_amount_paid := GREATEST(COALESCE(v_entry.amount_paid, 0) - v_reverse_amount, 0);

  UPDATE public.package_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_confirmed = false,
    confirmed_by = NULL,
    confirmed_at = NULL,
    debt_paid = false,
    debt_paid_at = NULL
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_amount_paid, (v_entry.amount - v_new_amount_paid - COALESCE(v_entry.retrieved_amount, 0)), v_reverse_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_package_debt(text, text, numeric) TO authenticated;
