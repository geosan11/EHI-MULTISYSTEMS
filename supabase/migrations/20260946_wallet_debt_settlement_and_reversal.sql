-- =============================================================
-- Wallet ↔ debt settlement, and a first-class "undo a deduction"
-- =============================================================
-- Two connected gaps this migration closes:
--
-- 1. The ONLY way to apply a customer's wallet credit to an existing ledger
--    entry was TransactionLedger's generic Edit modal (Payment Mode →
--    "Customer Wallet"). That path called chargeWalletForSale directly with
--    NO check that the entry was already settled -- on a "Debt Cleared"
--    entry it deducted the wallet a SECOND time, wrote a wallet_transactions
--    row with cargo_entry_id = NULL (nothing ties it back to the shipment),
--    never touched payment_history / amount_paid, and flipped receipt_mode
--    off 'Debt' so the shipment vanished from every debt view while
--    payment_history still said "cleared". Money left the wallet; nothing on
--    the shipment recorded why.
--
--    Fix: clear_<type>_debt gains an optional p_wallet_id. When set, the
--    wallet is debited and its deduction row written HERE -- linked to the
--    entry (cargo_entry_id) and tagged onto the payment_history element it
--    appends (wallet_txn_id) -- all in the one transaction. receipt_mode
--    stays 'Debt', so the entry reads "Debt Cleared" via the existing
--    derived rule. reopen_<type>_debt learns to refund that wallet when it
--    pops a wallet-settled payment, so "Reopen Debt" fully reverses.
--
-- 2. There was no way to undo an ordinary wallet deduction (an intake
--    wallet sale). reverse_wallet_deduction() adds one: refund the wallet,
--    mark the deduction REVERSED, and put the linked shipment back to owing
--    (unpaid Debt) for the reverted amount. Deliberately DISJOINT from the
--    retrieval-clawback (Unretrieve) and debt-settlement (Reopen Debt)
--    paths -- it refuses those and points at the right button.
--
-- New 'reversal' wallet_transactions type + reversed_at/by/reversal_of
-- columns back both halves. Compensation balance moves are done INLINE
-- (not via apply_wallet_transaction) specifically so total_topped_up is
-- NOT inflated and total_used is decremented -- keeps lifetime wallet
-- stats and CustomerWallets' noHistory fast-delete check honest.
-- =============================================================

-- ─── 0. Schema: reversal bookkeeping + widened type check ────────────────
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS reversed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by         text,
  ADD COLUMN IF NOT EXISTS reversed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_of         uuid REFERENCES public.wallet_transactions(id);

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('top_up', 'deduction', 'refund', 'adjustment', 'cash_payout', 'retrieval_refund', 'reversal'));


-- ─── 1. clear_<type>_debt gains an optional wallet leg ───────────────────
-- Both the existing 6-arg signature AND the new 7-arg one are dropped first:
--   * the 6-arg drop is what lets the p_wallet_id 7th arg be added without
--     an ambiguous overload (same reason 20260903 dropped the 5-arg version
--     before adding p_expected_remaining);
--   * the 7-arg drop makes this migration re-runnable -- CREATE OR REPLACE
--     cannot change a function's RETURNS TABLE shape, so once a prior run
--     has created the 7-arg version, re-running would fail 42P13 without an
--     explicit DROP (this migration adds `wallet_txn_id` to the return).
-- Everything the function already did is unchanged; the wallet block runs
-- AFTER the remaining-balance guard so a short wallet aborts before any
-- entry mutation.

-- CARGO
DROP FUNCTION IF EXISTS public.clear_cargo_debt(text, numeric, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.clear_cargo_debt(text, numeric, text, text, text, numeric, uuid);

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
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount, amount_paid, retrieved_amount, receipt_mode, corporate_client_id
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

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;

  UPDATE public.cargo_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
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
DROP FUNCTION IF EXISTS public.clear_baggage_debt(text, numeric, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.clear_baggage_debt(text, numeric, text, text, text, numeric, uuid);

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
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount, amount_paid, retrieved_amount, payment_mode
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

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;

  UPDATE public.manifests SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
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
DROP FUNCTION IF EXISTS public.clear_marketing_debt(text, numeric, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.clear_marketing_debt(text, numeric, text, text, text, numeric, uuid);

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
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount_paid AS sale_amount, debt_amount_paid, retrieved_amount, payment_mode
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

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;

  UPDATE public.marketing_entries SET
    debt_amount_paid = v_new_debt_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_debt_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0), v_wallet_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_marketing_debt(text, numeric, text, text, text, numeric, uuid) TO authenticated;

-- PACKAGE
DROP FUNCTION IF EXISTS public.clear_package_debt(text, numeric, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.clear_package_debt(text, numeric, text, text, text, numeric, uuid);

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
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT id, hub_id, amount, amount_paid, retrieved_amount, payment_mode
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

  v_history_elem := jsonb_build_object(
    'amount', p_payment_amount, 'mode', p_payment_mode,
    'by', COALESCE(p_logged_by, 'system'), 'at', now()
  );
  IF v_wallet_txn_id IS NOT NULL THEN
    v_history_elem := v_history_elem || jsonb_build_object('wallet_txn_id', v_wallet_txn_id);
  END IF;

  UPDATE public.package_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) || v_history_elem,
    bank = COALESCE(p_bank, bank),
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


-- ─── 2. reopen_<type>_debt refunds a wallet-settled payment ──────────────
-- Signature unchanged (text, text, numeric) -- CREATE OR REPLACE only. When
-- the payment_history element being popped was settled from a wallet
-- (carries wallet_txn_id, written by clear_<type>_debt above), refund that
-- wallet in the same transaction and stamp the deduction REVERSED, so
-- "Reopen Debt" fully returns the customer's money instead of reopening the
-- debt while the wallet stays drained.

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


-- ─── 3. reverse_wallet_deduction(): undo an ordinary wallet deduction ────
-- Refunds the wallet, marks the deduction REVERSED, and puts the linked
-- shipment back to owing (unpaid Debt) for the reverted amount. One
-- function, branching on which entry table owns the shipment (the entry
-- point -- wallet_transactions.id -- is uniform, so the "four functions
-- because the id column differs" split doesn't apply here).
--
-- Refuses -- pointing at the right dedicated path instead -- for:
--   * an already-reversed deduction
--   * a retrieval-refund clawback  (description 'Retrieval reversal%')  -> Unretrieve
--   * a debt-settlement deduction  (description 'Debt settled from wallet'
--     / cargo_entry_id set)                                            -> Reopen Debt
--   * a shipment that has since been retrieved (retrieved_amount > 0)
--
-- Role-gated to accountant/admin/super_admin (this hands money back).
CREATE OR REPLACE FUNCTION public.reverse_wallet_deduction(
  p_transaction_id uuid,
  p_logged_by      text DEFAULT NULL
)
RETURNS TABLE (new_balance numeric, reversal_txn_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         public.wallet_transactions%ROWTYPE;
  v_bal_before  numeric;
  v_bal_after   numeric;
  v_new_id      uuid;
  v_table       text;
  v_entry       RECORD;
  v_deduct      numeric;
  v_non_wallet  numeric;
BEGIN
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only accountant/admin/super_admin may undo a wallet deduction';
  END IF;

  SELECT * INTO v_row FROM public.wallet_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'deduction' OR v_row.status <> 'completed' THEN
    RAISE EXCEPTION 'Transaction % is not a completed deduction', p_transaction_id;
  END IF;

  IF v_row.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This deduction was already reversed on %', v_row.reversed_at;
  END IF;

  IF v_row.description LIKE 'Retrieval reversal%'
     OR v_row.description = 'Debt settled from wallet'
     OR v_row.cargo_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This deduction is tied to a retrieval or a debt settlement -- undo it from the shipment (Unretrieve / Reopen Debt) instead';
  END IF;

  IF v_row.cargo_ref IS NULL THEN
    RAISE EXCEPTION 'This deduction has no shipment reference -- reverse it manually with a wallet adjustment';
  END IF;

  v_deduct := v_row.amount;

  -- Resolve the shipment. Intake wallet-sale deductions are stamped
  -- department='cargo' regardless of the real department
  -- (apply_wallet_transaction's default was never overridden by
  -- chargeWalletForSale), so probe every ref column rather than trusting
  -- v_row.department.
  v_table := NULL;
  PERFORM 1 FROM public.cargo_entries WHERE entry_ref = v_row.cargo_ref;
  IF FOUND THEN v_table := 'cargo'; END IF;
  IF v_table IS NULL THEN
    PERFORM 1 FROM public.manifests WHERE transaction_id = v_row.cargo_ref;
    IF FOUND THEN v_table := 'baggage'; END IF;
  END IF;
  IF v_table IS NULL THEN
    PERFORM 1 FROM public.marketing_entries WHERE entry_ref = v_row.cargo_ref;
    IF FOUND THEN v_table := 'marketing'; END IF;
  END IF;
  IF v_table IS NULL THEN
    PERFORM 1 FROM public.package_entries WHERE entry_ref = v_row.cargo_ref;
    IF FOUND THEN v_table := 'package'; END IF;
  END IF;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'Cannot find the shipment (%) this deduction paid for -- reverse it manually', v_row.cargo_ref;
  END IF;

  -- Entry leg: revert the shipment to unpaid Debt for the reverted amount.
  -- v_non_wallet = the non-wallet portion actually collected at intake
  -- (0 for a full wallet sale, the Cash/Transfer remainder for a split) --
  -- recorded as amount_paid + a payment_history row so remaining works out
  -- to exactly the wallet amount being clawed back.
  IF v_table = 'cargo' THEN
    SELECT amount, amount_paid, wallet_deduction_amount, retrieved_amount,
           receipt_mode, created_at, entered_by, corporate_client_id
    INTO v_entry
    FROM public.cargo_entries WHERE entry_ref = v_row.cargo_ref FOR UPDATE;

    IF COALESCE(v_entry.retrieved_amount, 0) > 0 THEN
      RAISE EXCEPTION 'Shipment % has been retrieved -- reverse the retrieval, not the deduction', v_row.cargo_ref;
    END IF;

    v_non_wallet := GREATEST(COALESCE(v_entry.amount, 0) - COALESCE(v_entry.wallet_deduction_amount, 0), 0);

    UPDATE public.cargo_entries SET
      receipt_mode = 'Debt',
      wallet_id = NULL,
      wallet_deduction_amount = GREATEST(COALESCE(wallet_deduction_amount, 0) - v_deduct, 0),
      amount_paid = v_non_wallet,
      payment_history = CASE
        WHEN v_non_wallet > 0 AND COALESCE(v_entry.receipt_mode, 'Debt') <> 'Wallet'
        THEN COALESCE(payment_history, '[]'::jsonb) || jsonb_build_object(
          'amount', v_non_wallet, 'mode', v_entry.receipt_mode,
          'by', COALESCE(v_entry.entered_by, v_row.logged_by, 'system'),
          'at', v_entry.created_at)
        ELSE payment_history
      END,
      payment_confirmed = false,
      confirmed_by = NULL,
      confirmed_at = NULL
    WHERE entry_ref = v_row.cargo_ref;

    IF v_entry.corporate_client_id IS NOT NULL THEN
      UPDATE public.corporate_clients
      SET accumulated_monthly_debt = accumulated_monthly_debt + v_deduct
      WHERE id = v_entry.corporate_client_id::uuid;
    END IF;

  ELSIF v_table = 'baggage' THEN
    SELECT amount, amount_paid, wallet_deduction_amount, retrieved_amount,
           payment_mode, created_at, entered_by
    INTO v_entry
    FROM public.manifests WHERE transaction_id = v_row.cargo_ref FOR UPDATE;

    IF COALESCE(v_entry.retrieved_amount, 0) > 0 THEN
      RAISE EXCEPTION 'Shipment % has been retrieved -- reverse the retrieval, not the deduction', v_row.cargo_ref;
    END IF;

    v_non_wallet := GREATEST(COALESCE(v_entry.amount, 0) - COALESCE(v_entry.wallet_deduction_amount, 0), 0);

    UPDATE public.manifests SET
      payment_mode = 'Debt',
      wallet_id = NULL,
      wallet_deduction_amount = GREATEST(COALESCE(wallet_deduction_amount, 0) - v_deduct, 0),
      amount_paid = v_non_wallet,
      payment_history = CASE
        WHEN v_non_wallet > 0 AND COALESCE(v_entry.payment_mode, 'Debt') <> 'Wallet'
        THEN COALESCE(payment_history, '[]'::jsonb) || jsonb_build_object(
          'amount', v_non_wallet, 'mode', v_entry.payment_mode,
          'by', COALESCE(v_entry.entered_by, v_row.logged_by, 'system'),
          'at', v_entry.created_at)
        ELSE payment_history
      END,
      payment_confirmed = false,
      confirmed_by = NULL,
      confirmed_at = NULL
    WHERE transaction_id = v_row.cargo_ref;

  ELSIF v_table = 'marketing' THEN
    -- inverted: amount_paid holds the sale total, debt_amount_paid the repayment
    SELECT amount_paid AS sale_amount, debt_amount_paid, wallet_deduction_amount,
           retrieved_amount, payment_mode, created_at, entered_by
    INTO v_entry
    FROM public.marketing_entries WHERE entry_ref = v_row.cargo_ref FOR UPDATE;

    IF COALESCE(v_entry.retrieved_amount, 0) > 0 THEN
      RAISE EXCEPTION 'Shipment % has been retrieved -- reverse the retrieval, not the deduction', v_row.cargo_ref;
    END IF;

    v_non_wallet := GREATEST(COALESCE(v_entry.sale_amount, 0) - COALESCE(v_entry.wallet_deduction_amount, 0), 0);

    UPDATE public.marketing_entries SET
      payment_mode = 'Debt',
      wallet_id = NULL,
      wallet_deduction_amount = GREATEST(COALESCE(wallet_deduction_amount, 0) - v_deduct, 0),
      debt_amount_paid = v_non_wallet,
      payment_history = CASE
        WHEN v_non_wallet > 0 AND COALESCE(v_entry.payment_mode, 'Debt') <> 'Wallet'
        THEN COALESCE(payment_history, '[]'::jsonb) || jsonb_build_object(
          'amount', v_non_wallet, 'mode', v_entry.payment_mode,
          'by', COALESCE(v_entry.entered_by, v_row.logged_by, 'system'),
          'at', v_entry.created_at)
        ELSE payment_history
      END,
      payment_confirmed = false,
      confirmed_by = NULL,
      confirmed_at = NULL
    WHERE entry_ref = v_row.cargo_ref;

  ELSE  -- package
    SELECT amount, amount_paid, wallet_deduction_amount, retrieved_amount,
           payment_mode, created_at, entered_by
    INTO v_entry
    FROM public.package_entries WHERE entry_ref = v_row.cargo_ref FOR UPDATE;

    IF COALESCE(v_entry.retrieved_amount, 0) > 0 THEN
      RAISE EXCEPTION 'Shipment % has been retrieved -- reverse the retrieval, not the deduction', v_row.cargo_ref;
    END IF;

    v_non_wallet := GREATEST(COALESCE(v_entry.amount, 0) - COALESCE(v_entry.wallet_deduction_amount, 0), 0);

    UPDATE public.package_entries SET
      payment_mode = 'Debt',
      wallet_id = NULL,
      wallet_deduction_amount = GREATEST(COALESCE(wallet_deduction_amount, 0) - v_deduct, 0),
      amount_paid = v_non_wallet,
      payment_history = CASE
        WHEN v_non_wallet > 0 AND COALESCE(v_entry.payment_mode, 'Debt') <> 'Wallet'
        THEN COALESCE(payment_history, '[]'::jsonb) || jsonb_build_object(
          'amount', v_non_wallet, 'mode', v_entry.payment_mode,
          'by', COALESCE(v_entry.entered_by, v_row.logged_by, 'system'),
          'at', v_entry.created_at)
        ELSE payment_history
      END,
      payment_confirmed = false,
      confirmed_by = NULL,
      confirmed_at = NULL,
      debt_paid = false,
      debt_paid_at = NULL
    WHERE entry_ref = v_row.cargo_ref;
  END IF;

  -- Wallet leg: credit the money back. INLINE (not apply_wallet_transaction)
  -- so total_topped_up is NOT inflated and total_used is decremented.
  SELECT balance INTO v_bal_before FROM public.customer_wallets
  WHERE id = v_row.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', v_row.wallet_id;
  END IF;

  UPDATE public.customer_wallets SET
    balance     = balance + v_deduct,
    total_used  = GREATEST(total_used - v_deduct, 0),
    status      = 'active',
    archived_at = NULL,
    updated_at  = now()
  WHERE id = v_row.wallet_id
  RETURNING balance INTO v_bal_after;

  INSERT INTO public.wallet_transactions (
    wallet_id, hub_id, type, amount, balance_before, balance_after,
    cargo_ref, description, logged_by, logged_by_user_id, department, status, reversal_of
  ) VALUES (
    v_row.wallet_id, v_row.hub_id, 'reversal', v_deduct, v_bal_before, v_bal_after,
    v_row.cargo_ref, format('Reversal of deduction %s', p_transaction_id),
    COALESCE(p_logged_by, 'system'), auth.uid(), v_row.department, 'completed', p_transaction_id
  ) RETURNING id INTO v_new_id;

  UPDATE public.wallet_transactions SET
    reversed_at = now(),
    reversed_by = p_logged_by,
    reversed_by_user_id = auth.uid()
  WHERE id = p_transaction_id;

  RETURN QUERY SELECT v_bal_after, v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_wallet_deduction(uuid, text) TO authenticated;
