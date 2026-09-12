-- =============================================================
-- Same-shift Individual debt: reclassify on full clearance
-- =============================================================
-- Business rule: an INDIVIDUAL (retail, non-corporate) debt that is created
-- AND fully cleared while the same hub+department shift has stayed open the
-- whole time (no shift close in between) should read, from that moment on,
-- as an ordinary sale under whatever payment mode actually cleared it --
-- not as a permanent 'Debt' entry. A debt that survives past a shift close
-- before being cleared keeps today's unchanged behavior: receipt_mode/
-- payment_mode stays 'Debt' forever, surfaced via debt_collection_events.
-- Corporate/office-work debt (monthly-billed, not shift-scoped) is never
-- affected either way.
--
-- Mechanism:
--   1. A new created_shift_id column (nullable, FK to hub_shifts) is stamped
--      at intake time with whichever shift is open for that hub+department
--      right then (client-side change, not in this migration). Existing
--      rows and any row created before the client ships this simply have
--      created_shift_id = NULL, which safely falls through to "no
--      reclassification" -- the current, permanent-Debt behavior.
--   2. clear_<type>_debt (SECURITY DEFINER, already re-reading the row with
--      FOR UPDATE) additionally reads created_shift_id + client_type, and on
--      FULL clearance only, looks up whichever shift is CURRENTLY open for
--      that hub+department. If it's the same shift the entry was created
--      under and client_type = 'Individual', the mode column is rewritten
--      to the real payment mode and the payment_history element gets a
--      'reclassified: true' marker.
--   3. reopen_<type>_debt looks for that marker on whichever payment_history
--      element it's popping (always the last one, and reclassification can
--      only ever happen on the payment that completes clearance, so at most
--      one element ever carries it) and reverts the mode column back to
--      'Debt' when found -- otherwise "Reopen Debt" would leave a
--      reclassified entry looking like a paid normal sale with its debt
--      quietly reopened underneath it.
--
-- Gating happens SERVER-SIDE inside the RPCs (re-deriving client_type from
-- the row itself), not just client-side, since these functions are
-- SECURITY DEFINER and GRANTed directly to `authenticated` -- callable
-- without going through the app's own UI at all.
-- =============================================================

-- ─── 0. Schema: where an entry was created, shift-wise ───────────────────
ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS created_shift_id uuid REFERENCES public.hub_shifts(id);
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS created_shift_id uuid REFERENCES public.hub_shifts(id);
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS created_shift_id uuid REFERENCES public.hub_shifts(id);
ALTER TABLE public.package_entries    ADD COLUMN IF NOT EXISTS created_shift_id uuid REFERENCES public.hub_shifts(id);

-- ─── 1. clear_<type>_debt: reclassify on same-shift full clearance ───────
-- Signatures are unchanged (still text, numeric, text, text, text, numeric,
-- uuid) -- CREATE OR REPLACE only, no DROP needed. Everything each function
-- already did (including the wallet leg from 20260946) is unchanged; the
-- new logic slots in after the post-payment v_remaining is known and before
-- the payment_history element is built, exactly like every other single
-- addition this function has taken on over time.

-- CARGO
CREATE OR REPLACE FUNCTION public.clear_cargo_debt(
  p_entry_ref          text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_new_amount_paid numeric;
  v_remaining numeric;
  v_wallet_balance numeric;
  v_wallet_txn_id uuid;
  v_history_elem jsonb;
  v_current_shift_id uuid;
  v_reclassify_mode text;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount, amount_paid, retrieved_amount, receipt_mode, corporate_client_id,
         created_shift_id, client_type
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

  IF p_expected_remaining IS NOT NULL AND round(v_remaining::numeric, 2) <> round(p_expected_remaining::numeric, 2) THEN
    RAISE EXCEPTION 'Debt balance changed since this payment was prepared (expected %, actual %) -- refresh and retry', p_expected_remaining, v_remaining;
  END IF;

  IF p_payment_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment of % would exceed remaining balance of %', p_payment_amount, v_remaining;
  END IF;

  -- Optional wallet leg: settle this payment from a customer wallet,
  -- atomically. The deduction row is linked to the entry (cargo_entry_id)
  -- and its id is tagged onto the payment_history element below so
  -- reopen_cargo_debt can find and refund it precisely.
  IF p_wallet_id IS NOT NULL THEN
    SELECT balance INTO v_wallet_balance
    FROM public.customer_wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF p_payment_amount > v_wallet_balance THEN
      RAISE EXCEPTION 'Wallet balance % cannot cover this % payment', v_wallet_balance, p_payment_amount;
    END IF;

    UPDATE public.customer_wallets
    SET balance     = balance - p_payment_amount,
        total_used  = total_used + p_payment_amount,
        status      = CASE WHEN balance - p_payment_amount <= 0 THEN 'exhausted' ELSE 'active' END,
        updated_at  = now()
    WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status
    ) VALUES (
      p_wallet_id, v_entry.hub_id, 'deduction', p_payment_amount,
      v_wallet_balance, v_wallet_balance - p_payment_amount,
      p_entry_ref, v_entry.id, 'Debt settled from wallet',
      COALESCE(p_logged_by, 'system'), auth.uid(), 'cargo', 'completed'
    ) RETURNING id INTO v_wallet_txn_id;
  END IF;

  v_new_amount_paid := COALESCE(v_entry.amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  -- Same-shift reclassification -- see this migration's own header comment.
  IF v_remaining <= 0 AND v_entry.client_type = 'Individual' AND v_entry.created_shift_id IS NOT NULL THEN
    SELECT id INTO v_current_shift_id
    FROM public.hub_shifts
    WHERE hub_id = v_entry.hub_id AND department = 'cargo' AND status = 'open';

    IF v_current_shift_id IS NOT NULL AND v_current_shift_id = v_entry.created_shift_id THEN
      v_reclassify_mode := p_payment_mode;
    END IF;
  END IF;

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;
  IF v_reclassify_mode IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('reclassified', true);
  END IF;

  UPDATE public.cargo_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
    receipt_mode = COALESCE(v_reclassify_mode, receipt_mode),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  IF v_entry.corporate_client_id IS NOT NULL THEN
    UPDATE public.corporate_clients
    SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - p_payment_amount, 0)
    WHERE id = v_entry.corporate_client_id::uuid;
  END IF;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_cargo_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- BAGGAGE
CREATE OR REPLACE FUNCTION public.clear_baggage_debt(
  p_transaction_id     text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_new_amount_paid numeric;
  v_remaining numeric;
  v_wallet_balance numeric;
  v_wallet_txn_id uuid;
  v_history_elem jsonb;
  v_current_shift_id uuid;
  v_reclassify_mode text;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount, amount_paid, retrieved_amount, payment_mode,
         created_shift_id, client_type
  INTO v_entry
  FROM public.manifests
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage entry % not found', p_transaction_id;
  END IF;

  IF v_entry.payment_mode <> 'Debt' THEN
    RAISE EXCEPTION 'Entry % is not a Debt-mode entry', p_transaction_id;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to clear debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.amount - COALESCE(v_entry.amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);

  IF p_expected_remaining IS NOT NULL AND round(v_remaining::numeric, 2) <> round(p_expected_remaining::numeric, 2) THEN
    RAISE EXCEPTION 'Debt balance changed since this payment was prepared (expected %, actual %) -- refresh and retry', p_expected_remaining, v_remaining;
  END IF;

  IF p_payment_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment of % would exceed remaining balance of %', p_payment_amount, v_remaining;
  END IF;

  IF p_wallet_id IS NOT NULL THEN
    SELECT balance INTO v_wallet_balance
    FROM public.customer_wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF p_payment_amount > v_wallet_balance THEN
      RAISE EXCEPTION 'Wallet balance % cannot cover this % payment', v_wallet_balance, p_payment_amount;
    END IF;

    UPDATE public.customer_wallets
    SET balance     = balance - p_payment_amount,
        total_used  = total_used + p_payment_amount,
        status      = CASE WHEN balance - p_payment_amount <= 0 THEN 'exhausted' ELSE 'active' END,
        updated_at  = now()
    WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status
    ) VALUES (
      p_wallet_id, v_entry.hub_id, 'deduction', p_payment_amount,
      v_wallet_balance, v_wallet_balance - p_payment_amount,
      p_transaction_id, v_entry.id, 'Debt settled from wallet',
      COALESCE(p_logged_by, 'system'), auth.uid(), 'baggage', 'completed'
    ) RETURNING id INTO v_wallet_txn_id;
  END IF;

  v_new_amount_paid := COALESCE(v_entry.amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  IF v_remaining <= 0 AND v_entry.client_type = 'Individual' AND v_entry.created_shift_id IS NOT NULL THEN
    SELECT id INTO v_current_shift_id
    FROM public.hub_shifts
    WHERE hub_id = v_entry.hub_id AND department = 'baggage' AND status = 'open';

    IF v_current_shift_id IS NOT NULL AND v_current_shift_id = v_entry.created_shift_id THEN
      v_reclassify_mode := p_payment_mode;
    END IF;
  END IF;

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;
  IF v_reclassify_mode IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('reclassified', true);
  END IF;

  UPDATE public.manifests SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
    payment_mode = COALESCE(v_reclassify_mode, payment_mode),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE transaction_id = p_transaction_id;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_baggage_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- MARKETING (inverted naming: amount_paid holds the sale total, debt
-- repayment tracking lives in debt_amount_paid)
CREATE OR REPLACE FUNCTION public.clear_marketing_debt(
  p_entry_ref          text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_debt_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_new_debt_amount_paid numeric;
  v_remaining numeric;
  v_wallet_balance numeric;
  v_wallet_txn_id uuid;
  v_history_elem jsonb;
  v_current_shift_id uuid;
  v_reclassify_mode text;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount_paid AS sale_amount, debt_amount_paid, retrieved_amount, payment_mode,
         created_shift_id, client_type
  INTO v_entry
  FROM public.marketing_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketing entry % not found', p_entry_ref;
  END IF;

  IF v_entry.payment_mode <> 'Debt' THEN
    RAISE EXCEPTION 'Entry % is not a Debt-mode entry', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to clear debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.sale_amount - COALESCE(v_entry.debt_amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);

  IF p_expected_remaining IS NOT NULL AND round(v_remaining::numeric, 2) <> round(p_expected_remaining::numeric, 2) THEN
    RAISE EXCEPTION 'Debt balance changed since this payment was prepared (expected %, actual %) -- refresh and retry', p_expected_remaining, v_remaining;
  END IF;

  IF p_payment_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment of % would exceed remaining balance of %', p_payment_amount, v_remaining;
  END IF;

  IF p_wallet_id IS NOT NULL THEN
    SELECT balance INTO v_wallet_balance
    FROM public.customer_wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF p_payment_amount > v_wallet_balance THEN
      RAISE EXCEPTION 'Wallet balance % cannot cover this % payment', v_wallet_balance, p_payment_amount;
    END IF;

    UPDATE public.customer_wallets
    SET balance     = balance - p_payment_amount,
        total_used  = total_used + p_payment_amount,
        status      = CASE WHEN balance - p_payment_amount <= 0 THEN 'exhausted' ELSE 'active' END,
        updated_at  = now()
    WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status
    ) VALUES (
      p_wallet_id, v_entry.hub_id, 'deduction', p_payment_amount,
      v_wallet_balance, v_wallet_balance - p_payment_amount,
      p_entry_ref, v_entry.id, 'Debt settled from wallet',
      COALESCE(p_logged_by, 'system'), auth.uid(), 'marketing', 'completed'
    ) RETURNING id INTO v_wallet_txn_id;
  END IF;

  v_new_debt_amount_paid := COALESCE(v_entry.debt_amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  IF v_remaining <= 0 AND v_entry.client_type = 'Individual' AND v_entry.created_shift_id IS NOT NULL THEN
    SELECT id INTO v_current_shift_id
    FROM public.hub_shifts
    WHERE hub_id = v_entry.hub_id AND department = 'marketing' AND status = 'open';

    IF v_current_shift_id IS NOT NULL AND v_current_shift_id = v_entry.created_shift_id THEN
      v_reclassify_mode := p_payment_mode;
    END IF;
  END IF;

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;
  IF v_reclassify_mode IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('reclassified', true);
  END IF;

  UPDATE public.marketing_entries SET
    debt_amount_paid = v_new_debt_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
    payment_mode = COALESCE(v_reclassify_mode, payment_mode),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_debt_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_marketing_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- PACKAGE
CREATE OR REPLACE FUNCTION public.clear_package_debt(
  p_entry_ref          text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_new_amount_paid numeric;
  v_remaining numeric;
  v_wallet_balance numeric;
  v_wallet_txn_id uuid;
  v_history_elem jsonb;
  v_current_shift_id uuid;
  v_reclassify_mode text;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount, amount_paid, retrieved_amount, payment_mode,
         created_shift_id, client_type
  INTO v_entry
  FROM public.package_entries
  WHERE entry_ref = p_entry_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package entry % not found', p_entry_ref;
  END IF;

  IF v_entry.payment_mode <> 'Debt' THEN
    RAISE EXCEPTION 'Entry % is not a Debt-mode entry', p_entry_ref;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to clear debt for this entry''s hub';
  END IF;

  v_remaining := v_entry.amount - COALESCE(v_entry.amount_paid, 0) - COALESCE(v_entry.retrieved_amount, 0);

  IF p_expected_remaining IS NOT NULL AND round(v_remaining::numeric, 2) <> round(p_expected_remaining::numeric, 2) THEN
    RAISE EXCEPTION 'Debt balance changed since this payment was prepared (expected %, actual %) -- refresh and retry', p_expected_remaining, v_remaining;
  END IF;

  IF p_payment_amount > v_remaining THEN
    RAISE EXCEPTION 'Payment of % would exceed remaining balance of %', p_payment_amount, v_remaining;
  END IF;

  IF p_wallet_id IS NOT NULL THEN
    SELECT balance INTO v_wallet_balance
    FROM public.customer_wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF p_payment_amount > v_wallet_balance THEN
      RAISE EXCEPTION 'Wallet balance % cannot cover this % payment', v_wallet_balance, p_payment_amount;
    END IF;

    UPDATE public.customer_wallets
    SET balance     = balance - p_payment_amount,
        total_used  = total_used + p_payment_amount,
        status      = CASE WHEN balance - p_payment_amount <= 0 THEN 'exhausted' ELSE 'active' END,
        updated_at  = now()
    WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status
    ) VALUES (
      p_wallet_id, v_entry.hub_id, 'deduction', p_payment_amount,
      v_wallet_balance, v_wallet_balance - p_payment_amount,
      p_entry_ref, v_entry.id, 'Debt settled from wallet',
      COALESCE(p_logged_by, 'system'), auth.uid(), 'package', 'completed'
    ) RETURNING id INTO v_wallet_txn_id;
  END IF;

  v_new_amount_paid := COALESCE(v_entry.amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  IF v_remaining <= 0 AND v_entry.client_type = 'Individual' AND v_entry.created_shift_id IS NOT NULL THEN
    SELECT id INTO v_current_shift_id
    FROM public.hub_shifts
    WHERE hub_id = v_entry.hub_id AND department = 'package' AND status = 'open';

    IF v_current_shift_id IS NOT NULL AND v_current_shift_id = v_entry.created_shift_id THEN
      v_reclassify_mode := p_payment_mode;
    END IF;
  END IF;

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;
  IF v_reclassify_mode IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('reclassified', true);
  END IF;

  UPDATE public.package_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
    payment_mode = COALESCE(v_reclassify_mode, payment_mode),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END,
    debt_paid = CASE WHEN v_remaining <= 0 THEN true ELSE debt_paid END,
    debt_paid_at = CASE WHEN v_remaining <= 0 THEN now() ELSE debt_paid_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_package_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;


-- ─── 2. reopen_<type>_debt: revert the reclassification, if any ──────────
-- Signatures unchanged (text, text, numeric) -- CREATE OR REPLACE only.
-- Everything from 20260946 (wallet-refund-on-reopen) is unchanged; the only
-- addition is reading the 'reclassified' marker off the payment_history
-- element being popped and, if set, putting the mode column back to 'Debt'.

-- CARGO
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
  v_wallet_txn_id uuid;
  v_wtxn RECORD;
  v_wallet_bal numeric;
  v_was_reclassified boolean;
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
  v_was_reclassified := COALESCE((v_last_payment ->> 'reclassified')::boolean, false);

  v_wallet_txn_id := NULLIF(v_last_payment ->> 'wallet_txn_id', '')::uuid;
  IF v_wallet_txn_id IS NOT NULL THEN
    SELECT * INTO v_wtxn FROM public.wallet_transactions WHERE id = v_wallet_txn_id FOR UPDATE;
    IF FOUND AND v_wtxn.type = 'deduction' AND v_wtxn.status = 'completed' AND v_wtxn.reversed_at IS NULL THEN
      SELECT balance INTO v_wallet_bal FROM public.customer_wallets WHERE id = v_wtxn.wallet_id FOR UPDATE;
      UPDATE public.customer_wallets
      SET balance     = balance + v_wtxn.amount,
          total_used  = GREATEST(total_used - v_wtxn.amount, 0),
          status      = 'active',
          archived_at = NULL,
          updated_at  = now()
      WHERE id = v_wtxn.wallet_id;

      INSERT INTO public.wallet_transactions (
        wallet_id, hub_id, type, amount, balance_before, balance_after,
        cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
        department, status, reversal_of
      ) VALUES (
        v_wtxn.wallet_id, v_wtxn.hub_id, 'reversal', v_wtxn.amount,
        v_wallet_bal, v_wallet_bal + v_wtxn.amount,
        v_wtxn.cargo_ref, v_wtxn.cargo_entry_id,
        format('Reversal of deduction %s (debt reopened)', v_wtxn.id),
        COALESCE(p_logged_by, 'system'), auth.uid(),
        v_wtxn.department, 'completed', v_wtxn.id
      );

      UPDATE public.wallet_transactions
      SET reversed_at = now(), reversed_by = p_logged_by, reversed_by_user_id = auth.uid()
      WHERE id = v_wtxn.id;
    END IF;
  END IF;

  UPDATE public.cargo_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    receipt_mode = CASE WHEN v_was_reclassified THEN 'Debt' ELSE receipt_mode END,
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
  v_wallet_txn_id uuid;
  v_wtxn RECORD;
  v_wallet_bal numeric;
  v_was_reclassified boolean;
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
  v_was_reclassified := COALESCE((v_last_payment ->> 'reclassified')::boolean, false);

  v_wallet_txn_id := NULLIF(v_last_payment ->> 'wallet_txn_id', '')::uuid;
  IF v_wallet_txn_id IS NOT NULL THEN
    SELECT * INTO v_wtxn FROM public.wallet_transactions WHERE id = v_wallet_txn_id FOR UPDATE;
    IF FOUND AND v_wtxn.type = 'deduction' AND v_wtxn.status = 'completed' AND v_wtxn.reversed_at IS NULL THEN
      SELECT balance INTO v_wallet_bal FROM public.customer_wallets WHERE id = v_wtxn.wallet_id FOR UPDATE;
      UPDATE public.customer_wallets
      SET balance     = balance + v_wtxn.amount,
          total_used  = GREATEST(total_used - v_wtxn.amount, 0),
          status      = 'active',
          archived_at = NULL,
          updated_at  = now()
      WHERE id = v_wtxn.wallet_id;

      INSERT INTO public.wallet_transactions (
        wallet_id, hub_id, type, amount, balance_before, balance_after,
        cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
        department, status, reversal_of
      ) VALUES (
        v_wtxn.wallet_id, v_wtxn.hub_id, 'reversal', v_wtxn.amount,
        v_wallet_bal, v_wallet_bal + v_wtxn.amount,
        v_wtxn.cargo_ref, v_wtxn.cargo_entry_id,
        format('Reversal of deduction %s (debt reopened)', v_wtxn.id),
        COALESCE(p_logged_by, 'system'), auth.uid(),
        v_wtxn.department, 'completed', v_wtxn.id
      );

      UPDATE public.wallet_transactions
      SET reversed_at = now(), reversed_by = p_logged_by, reversed_by_user_id = auth.uid()
      WHERE id = v_wtxn.id;
    END IF;
  END IF;

  UPDATE public.manifests SET
    amount_paid = v_new_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_mode = CASE WHEN v_was_reclassified THEN 'Debt' ELSE payment_mode END,
    payment_confirmed = false,
    confirmed_by = NULL,
    confirmed_at = NULL
  WHERE transaction_id = p_transaction_id;

  RETURN QUERY SELECT v_new_amount_paid, (v_entry.amount - v_new_amount_paid - COALESCE(v_entry.retrieved_amount, 0)), v_reverse_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_baggage_debt(text, text, numeric) TO authenticated;

-- MARKETING
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
  v_wallet_txn_id uuid;
  v_wtxn RECORD;
  v_wallet_bal numeric;
  v_was_reclassified boolean;
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
  v_was_reclassified := COALESCE((v_last_payment ->> 'reclassified')::boolean, false);

  v_wallet_txn_id := NULLIF(v_last_payment ->> 'wallet_txn_id', '')::uuid;
  IF v_wallet_txn_id IS NOT NULL THEN
    SELECT * INTO v_wtxn FROM public.wallet_transactions WHERE id = v_wallet_txn_id FOR UPDATE;
    IF FOUND AND v_wtxn.type = 'deduction' AND v_wtxn.status = 'completed' AND v_wtxn.reversed_at IS NULL THEN
      SELECT balance INTO v_wallet_bal FROM public.customer_wallets WHERE id = v_wtxn.wallet_id FOR UPDATE;
      UPDATE public.customer_wallets
      SET balance     = balance + v_wtxn.amount,
          total_used  = GREATEST(total_used - v_wtxn.amount, 0),
          status      = 'active',
          archived_at = NULL,
          updated_at  = now()
      WHERE id = v_wtxn.wallet_id;

      INSERT INTO public.wallet_transactions (
        wallet_id, hub_id, type, amount, balance_before, balance_after,
        cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
        department, status, reversal_of
      ) VALUES (
        v_wtxn.wallet_id, v_wtxn.hub_id, 'reversal', v_wtxn.amount,
        v_wallet_bal, v_wallet_bal + v_wtxn.amount,
        v_wtxn.cargo_ref, v_wtxn.cargo_entry_id,
        format('Reversal of deduction %s (debt reopened)', v_wtxn.id),
        COALESCE(p_logged_by, 'system'), auth.uid(),
        v_wtxn.department, 'completed', v_wtxn.id
      );

      UPDATE public.wallet_transactions
      SET reversed_at = now(), reversed_by = p_logged_by, reversed_by_user_id = auth.uid()
      WHERE id = v_wtxn.id;
    END IF;
  END IF;

  UPDATE public.marketing_entries SET
    debt_amount_paid = v_new_debt_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_mode = CASE WHEN v_was_reclassified THEN 'Debt' ELSE payment_mode END,
    payment_confirmed = false,
    confirmed_by = NULL,
    confirmed_at = NULL
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_debt_amount_paid, (v_entry.sale_amount - v_new_debt_amount_paid - COALESCE(v_entry.retrieved_amount, 0)), v_reverse_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_marketing_debt(text, text, numeric) TO authenticated;

-- PACKAGE
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
  v_wallet_txn_id uuid;
  v_wtxn RECORD;
  v_wallet_bal numeric;
  v_was_reclassified boolean;
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
  v_was_reclassified := COALESCE((v_last_payment ->> 'reclassified')::boolean, false);

  v_wallet_txn_id := NULLIF(v_last_payment ->> 'wallet_txn_id', '')::uuid;
  IF v_wallet_txn_id IS NOT NULL THEN
    SELECT * INTO v_wtxn FROM public.wallet_transactions WHERE id = v_wallet_txn_id FOR UPDATE;
    IF FOUND AND v_wtxn.type = 'deduction' AND v_wtxn.status = 'completed' AND v_wtxn.reversed_at IS NULL THEN
      SELECT balance INTO v_wallet_bal FROM public.customer_wallets WHERE id = v_wtxn.wallet_id FOR UPDATE;
      UPDATE public.customer_wallets
      SET balance     = balance + v_wtxn.amount,
          total_used  = GREATEST(total_used - v_wtxn.amount, 0),
          status      = 'active',
          archived_at = NULL,
          updated_at  = now()
      WHERE id = v_wtxn.wallet_id;

      INSERT INTO public.wallet_transactions (
        wallet_id, hub_id, type, amount, balance_before, balance_after,
        cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
        department, status, reversal_of
      ) VALUES (
        v_wtxn.wallet_id, v_wtxn.hub_id, 'reversal', v_wtxn.amount,
        v_wallet_bal, v_wallet_bal + v_wtxn.amount,
        v_wtxn.cargo_ref, v_wtxn.cargo_entry_id,
        format('Reversal of deduction %s (debt reopened)', v_wtxn.id),
        COALESCE(p_logged_by, 'system'), auth.uid(),
        v_wtxn.department, 'completed', v_wtxn.id
      );

      UPDATE public.wallet_transactions
      SET reversed_at = now(), reversed_by = p_logged_by, reversed_by_user_id = auth.uid()
      WHERE id = v_wtxn.id;
    END IF;
  END IF;

  UPDATE public.package_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = v_entry.payment_history - (v_history_len - 1),
    payment_mode = CASE WHEN v_was_reclassified THEN 'Debt' ELSE payment_mode END,
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
