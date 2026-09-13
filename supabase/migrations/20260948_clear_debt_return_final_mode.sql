-- =============================================================
-- clear_<type>_debt: also return the entry's final mode
-- =============================================================
-- Bug: 20260947_same_shift_debt_reclassification.sql correctly rewrites
-- receipt_mode/payment_mode server-side on a same-shift Individual full
-- clearance, but never told the CLIENT what it changed the mode to. The
-- client's clearDebt() callers (TransactionLedger.tsx) hardcode the local
-- Transaction's mode to 'Debt Paid' on full clearance -- always, whether or
-- not the RPC actually reclassified it -- and that locally-built object is
-- immediately written back to the database again via the app's shared
-- onUpdateTx/handleUpdateTx path (a long-standing redundant write that was
-- harmless before this feature existed, since 'Debt Paid' has always
-- deserialized back to the literal DB value 'Debt' either way -- see
-- EHIApp.tsx's buildTxUpdatePayload). With reclassification, that redundant
-- write now overwrites the RPC's correct new receipt_mode/payment_mode
-- (e.g. 'Transfer') back to 'Debt' a moment after the RPC set it -- so a
-- reclassified debt looks cleared correctly for an instant, then reverts to
-- "Debt Cleared" for good, both on screen and in the database, once the
-- client's own write lands.
--
-- Fix here: each function also returns the mode it actually ended up
-- writing (new_mode), same COALESCE(v_reclassify_mode, <mode col>)
-- expression already used in each UPDATE's SET clause, just captured into a
-- variable first so it can also be returned. The client (src/lib/debt.ts,
-- TransactionLedger.tsx) is updated in the same change to use this
-- returned value instead of hardcoding 'Debt Paid', making that redundant
-- write idempotent again -- same fix already applied once before for
-- amountPaid (see TransactionLedger.tsx's own comment on why using the
-- RPC's real returned total instead of a client-assumed one matters).
--
-- RETURNS TABLE's shape is changing, so each function needs DROP + CREATE
-- (CREATE OR REPLACE can't alter a function's return type) -- parameter
-- signatures are unchanged, so each GRANT below just needs re-issuing.
-- =============================================================

-- CARGO
DROP FUNCTION IF EXISTS public.clear_cargo_debt(text, numeric, text, text, text, numeric, uuid);

CREATE FUNCTION public.clear_cargo_debt(
  p_entry_ref          text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid, new_mode text)
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
  v_final_mode text;
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

  -- Same-shift reclassification -- see 20260947's own header comment.
  IF v_remaining <= 0 AND v_entry.client_type = 'Individual' AND v_entry.created_shift_id IS NOT NULL THEN
    SELECT id INTO v_current_shift_id
    FROM public.hub_shifts
    WHERE hub_id = v_entry.hub_id AND department = 'cargo' AND status = 'open';

    IF v_current_shift_id IS NOT NULL AND v_current_shift_id = v_entry.created_shift_id THEN
      v_reclassify_mode := p_payment_mode;
    END IF;
  END IF;

  v_final_mode := COALESCE(v_reclassify_mode, v_entry.receipt_mode);

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
    receipt_mode = v_final_mode,
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  IF v_entry.corporate_client_id IS NOT NULL THEN
    UPDATE public.corporate_clients
    SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - p_payment_amount, 0)
    WHERE id = v_entry.corporate_client_id::uuid;
  END IF;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id, v_final_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_cargo_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- BAGGAGE
DROP FUNCTION IF EXISTS public.clear_baggage_debt(text, numeric, text, text, text, numeric, uuid);

CREATE FUNCTION public.clear_baggage_debt(
  p_transaction_id     text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid, new_mode text)
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
  v_final_mode text;
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

  v_final_mode := COALESCE(v_reclassify_mode, v_entry.payment_mode);

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
    payment_mode = v_final_mode,
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE transaction_id = p_transaction_id;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id, v_final_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_baggage_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- MARKETING (inverted naming: amount_paid holds the sale total, debt
-- repayment tracking lives in debt_amount_paid)
DROP FUNCTION IF EXISTS public.clear_marketing_debt(text, numeric, text, text, text, numeric, uuid);

CREATE FUNCTION public.clear_marketing_debt(
  p_entry_ref          text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_debt_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid, new_mode text)
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
  v_final_mode text;
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

  v_final_mode := COALESCE(v_reclassify_mode, v_entry.payment_mode);

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
    payment_mode = v_final_mode,
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_debt_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id, v_final_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_marketing_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- PACKAGE
DROP FUNCTION IF EXISTS public.clear_package_debt(text, numeric, text, text, text, numeric, uuid);

CREATE FUNCTION public.clear_package_debt(
  p_entry_ref          text,
  p_payment_amount     numeric,
  p_payment_mode       text,
  p_bank               text DEFAULT NULL,
  p_logged_by          text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL,
  p_wallet_id          uuid DEFAULT NULL
)
RETURNS TABLE (new_amount_paid numeric, remaining_balance numeric, fully_paid boolean, wallet_txn_id uuid, new_mode text)
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
  v_final_mode text;
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

  v_final_mode := COALESCE(v_reclassify_mode, v_entry.payment_mode);

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
    payment_mode = v_final_mode,
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END,
    debt_paid = CASE WHEN v_remaining <= 0 THEN true ELSE debt_paid END,
    debt_paid_at = CASE WHEN v_remaining <= 0 THEN now() ELSE debt_paid_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id, v_final_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_package_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;
