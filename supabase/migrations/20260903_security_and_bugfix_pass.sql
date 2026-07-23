-- =============================================================
-- Security + bugfix pass, 2026-07-22
-- =============================================================
-- Full audit requested by the business owner: computation/auto-computation
-- review, financial-loophole review, TransactionLedger full debug, debt
-- visibility, retrieval system review, GAT debug, double-entry debug,
-- payment-verification debug. This file fixes everything found that
-- touches functions/tables from ALREADY-APPLIED migrations (older than
-- 20260902) -- CREATE OR REPLACE where the signature is unchanged, or an
-- explicit DROP FUNCTION IF EXISTS <old exact signature> first when a
-- parameter is being added (Postgres treats an added parameter as a new
-- overload, not a replace -- this is exactly how process_cargo_retrieval's
-- overload collision happened, fixed in 20260902 alongside this file).
-- Run this AFTER 20260902_multi_department_retrieval_and_wallet_cashout.sql.
-- =============================================================

-- ─── 1. apply_wallet_transaction(): money-creating types need a role gate ──
-- 'top_up'/'adjustment' manufacture real spendable wallet balance from
-- nothing -- GRANT EXECUTE TO authenticated meant ANY logged-in staffer
-- could call this directly (bypassing the app entirely) to credit any
-- in-hub wallet with an arbitrary amount, then cash it out via the wallet
-- cash-payout flow. 'deduction'/'refund' stay broadly available since
-- they're always tied to a real sale or a real retrieval RPC call, not a
-- bare balance mutation. Same signature as 20260902's redefine -- plain
-- CREATE OR REPLACE, no DROP needed.
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_wallet_id       uuid,
  p_type            text,
  p_amount          numeric,
  p_cargo_ref       text DEFAULT NULL,
  p_cargo_entry_id  uuid DEFAULT NULL,
  p_description     text DEFAULT NULL,
  p_logged_by       text DEFAULT NULL,
  p_department      text DEFAULT 'cargo'
)
RETURNS TABLE(new_balance numeric, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_hub      uuid;
  v_balance_before  numeric;
  v_balance_after   numeric;
  v_delta           numeric;
  v_txn_id          uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Wallet transaction amount must be positive (got %)', p_amount;
  END IF;

  IF p_type NOT IN ('top_up', 'deduction', 'refund', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid wallet transaction type: %', p_type;
  END IF;

  IF p_type IN ('top_up', 'adjustment') AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Only accountant/admin/super_admin/auditor roles may top up or adjust a wallet balance directly';
  END IF;

  v_delta := CASE WHEN p_type = 'deduction' THEN -p_amount ELSE p_amount END;

  SELECT hub_id, balance INTO v_wallet_hub, v_balance_before
  FROM public.customer_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  IF v_wallet_hub IS NOT NULL
    AND v_wallet_hub <> public.current_user_hub_id()
    AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to update this wallet';
  END IF;

  IF p_type = 'deduction' AND v_balance_before + v_delta < 0 THEN
    RAISE EXCEPTION 'Insufficient wallet balance: has %, needs %', v_balance_before, p_amount;
  END IF;

  UPDATE public.customer_wallets
  SET balance         = balance + v_delta,
      total_topped_up = total_topped_up + (CASE WHEN p_type IN ('top_up', 'refund') THEN p_amount ELSE 0 END),
      total_used      = total_used + (CASE WHEN p_type = 'deduction' THEN p_amount ELSE 0 END),
      status          = CASE WHEN balance + v_delta <= 0 THEN 'exhausted' ELSE 'active' END,
      updated_at      = now()
  WHERE id = p_wallet_id
  RETURNING balance INTO v_balance_after;

  INSERT INTO public.wallet_transactions (
    wallet_id, hub_id, type, amount, balance_before, balance_after,
    cargo_ref, cargo_entry_id, description, logged_by, department, status
  ) VALUES (
    p_wallet_id, v_wallet_hub, p_type, p_amount, v_balance_before, v_balance_after,
    p_cargo_ref, p_cargo_entry_id, p_description, COALESCE(p_logged_by, 'system'),
    p_department, 'completed'
  ) RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_balance_after, v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, uuid, text, text, text) TO authenticated;

-- ─── 2. decrement_corporate_debt(): confirmed dead in client code, lock it down ──
-- Only increment_corporate_debt is called from the app (CargoForm.tsx's
-- B2B gate-weighing finalize); the client-side decrement call was already
-- removed (see EHIApp.tsx's own comment on handleUpdateTx). With nothing
-- legitimate calling it, GRANT EXECUTE TO authenticated left it sitting
-- exploitable: any hub agent could call decrement_corporate_debt(client_id,
-- 999999999) directly and erase a corporate client's entire running debt
-- with no payment, no audit trail, no trace beyond the number changing.
CREATE OR REPLACE FUNCTION public.decrement_corporate_debt(p_client_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_total numeric;
  v_client_hub uuid;
BEGIN
  IF NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to directly adjust a corporate client''s debt balance';
  END IF;

  SELECT hub_id INTO v_client_hub FROM public.corporate_clients WHERE id = p_client_id;
  IF v_client_hub IS NOT NULL
     AND v_client_hub <> public.current_user_hub_id()
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to update this corporate client''s debt balance';
  END IF;

  UPDATE public.corporate_clients
  SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - p_amount, 0)
  WHERE id = p_client_id
  RETURNING accumulated_monthly_debt INTO v_new_total;

  RETURN v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_corporate_debt(uuid, numeric) TO authenticated;

-- NOTE: increment_corporate_debt is left unchanged -- it's legitimately
-- called by any hub agent finishing a corporate gate-weighing sale
-- (CargoForm.tsx), so restricting it to unrestricted roles would break
-- that real workflow. Its p_amount still isn't cross-checked against any
-- real shipment total; fully closing that needs linking the call to an
-- actual cargo_entries row, which is a larger change deferred out of this
-- pass.

-- ─── 3. clear_*_debt(): retrieved_amount parity + double-payment guard ────
-- Two fixes to all four, applied together since both touch the same
-- function bodies:
--   a) clear_baggage_debt/clear_marketing_debt/clear_package_debt never
--      subtracted retrieved_amount from the remaining balance (only
--      clear_cargo_debt did) -- a debt partially or fully settled via a
--      retrieval (not a manual payment) still showed its full original
--      balance as owed on these three, and a clearing attempt against it
--      could overpay/misreport.
--   b) None of the four protect a PARTIAL payment against a double-fire
--      (double-click / DebtorsTab's previously-unguarded Confirm button,
--      see the frontend fix in the same commit): the existing guard only
--      rejects a payment that EXCEEDS the remaining balance, so two
--      sequential partial payments that each individually fit under the
--      (shrinking) remaining balance both silently succeed. p_expected_
--      remaining is optional (NULL = skip the check, for any caller not
--      yet updated) -- when the caller passes the balance it displayed to
--      the user, a second call after the first already committed sees a
--      different actual remaining balance and fails deterministically.
-- All four gain a 6th param, so each needs an explicit DROP of the old
-- 5-param signature before CREATE OR REPLACE.

-- CARGO
DROP FUNCTION IF EXISTS public.clear_cargo_debt(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.clear_cargo_debt(
  p_entry_ref         text,
  p_payment_amount    numeric,
  p_payment_mode      text,
  p_bank              text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL
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

  IF p_expected_remaining IS NOT NULL AND round(v_remaining::numeric, 2) <> round(p_expected_remaining::numeric, 2) THEN
    RAISE EXCEPTION 'Debt balance changed since this payment was prepared (expected %, actual %) -- refresh and retry', p_expected_remaining, v_remaining;
  END IF;

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

  IF v_entry.corporate_client_id IS NOT NULL THEN
    UPDATE public.corporate_clients
    SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - p_payment_amount, 0)
    WHERE id = v_entry.corporate_client_id::uuid;
  END IF;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_cargo_debt(text, numeric, text, text, text, numeric) TO authenticated;

-- BAGGAGE
DROP FUNCTION IF EXISTS public.clear_baggage_debt(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.clear_baggage_debt(
  p_transaction_id    text,
  p_payment_amount    numeric,
  p_payment_mode      text,
  p_bank              text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL
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

  SELECT hub_id, amount, amount_paid, retrieved_amount, payment_mode
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

  v_new_amount_paid := COALESCE(v_entry.amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  UPDATE public.manifests SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) ||
      jsonb_build_object('amount', p_payment_amount, 'mode', p_payment_mode, 'by', COALESCE(p_logged_by, 'system'), 'at', now()),
    bank = COALESCE(p_bank, bank),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE transaction_id = p_transaction_id;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_baggage_debt(text, numeric, text, text, text, numeric) TO authenticated;

-- MARKETING (inverted naming: amount_paid holds the sale total, debt
-- repayment tracking lives in debt_amount_paid -- see clear_marketing_debt's
-- original comment in 20260819_clear_debt_state_wide.sql for why)
DROP FUNCTION IF EXISTS public.clear_marketing_debt(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.clear_marketing_debt(
  p_entry_ref         text,
  p_payment_amount    numeric,
  p_payment_mode      text,
  p_bank              text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL
)
RETURNS TABLE (new_debt_amount_paid numeric, remaining_balance numeric, fully_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_new_debt_amount_paid numeric;
  v_remaining numeric;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive (got %)', p_payment_amount;
  END IF;

  SELECT hub_id, amount_paid AS sale_amount, debt_amount_paid, retrieved_amount, payment_mode
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

  v_new_debt_amount_paid := COALESCE(v_entry.debt_amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  UPDATE public.marketing_entries SET
    debt_amount_paid = v_new_debt_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) ||
      jsonb_build_object('amount', p_payment_amount, 'mode', p_payment_mode, 'by', COALESCE(p_logged_by, 'system'), 'at', now()),
    bank = COALESCE(p_bank, bank),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_debt_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_marketing_debt(text, numeric, text, text, text, numeric) TO authenticated;

-- PACKAGE
DROP FUNCTION IF EXISTS public.clear_package_debt(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.clear_package_debt(
  p_entry_ref         text,
  p_payment_amount    numeric,
  p_payment_mode      text,
  p_bank              text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_expected_remaining numeric DEFAULT NULL
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

  SELECT hub_id, amount, amount_paid, retrieved_amount, payment_mode
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

  v_new_amount_paid := COALESCE(v_entry.amount_paid, 0) + p_payment_amount;
  v_remaining := v_remaining - p_payment_amount;

  UPDATE public.package_entries SET
    amount_paid = v_new_amount_paid,
    payment_history = COALESCE(payment_history, '[]'::jsonb) ||
      jsonb_build_object('amount', p_payment_amount, 'mode', p_payment_mode, 'by', COALESCE(p_logged_by, 'system'), 'at', now()),
    bank = COALESCE(p_bank, bank),
    payment_confirmed = CASE WHEN v_remaining <= 0 THEN true ELSE payment_confirmed END,
    confirmed_by = CASE WHEN v_remaining <= 0 THEN COALESCE(p_logged_by, confirmed_by) ELSE confirmed_by END,
    confirmed_at = CASE WHEN v_remaining <= 0 THEN now() ELSE confirmed_at END,
    debt_paid = CASE WHEN v_remaining <= 0 THEN true ELSE debt_paid END,
    debt_paid_at = CASE WHEN v_remaining <= 0 THEN now() ELSE debt_paid_at END
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_new_amount_paid, GREATEST(v_remaining, 0), (v_remaining <= 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_package_debt(text, numeric, text, text, text, numeric) TO authenticated;

-- ─── 4. Bank-alert reference reuse: partial unique indexes ────────────────
-- PaymentValidation.tsx's paste-and-match flow never checked whether a
-- bank_reference had already been used to confirm a DIFFERENT entry, and
-- these columns (20260730_bank_reference_columns.sql) had no uniqueness
-- constraint at all -- the same real bank credit could be matched and
-- "confirmed" against two separate ledger entries. package_entries has no
-- bank_reference column (its debt is Cash/POS-collected, not Transfer --
-- see 20260730's own comment), so it's excluded here. This doesn't catch a
-- reference reused ACROSS tables (cargo vs marketing, say) -- accepted
-- residual risk, rare in practice compared to the same-table case.
CREATE UNIQUE INDEX IF NOT EXISTS cargo_entries_bank_reference_key
  ON public.cargo_entries (bank_reference) WHERE bank_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manifests_bank_reference_key
  ON public.manifests (bank_reference) WHERE bank_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_entries_bank_reference_key
  ON public.marketing_entries (bank_reference) WHERE bank_reference IS NOT NULL;

-- ─── 5. confirm_payment_cargo/_baggage/_marketing: accept bank-alert fields ──
-- Lets PaymentValidation.tsx route its confirm-and-stamp action through the
-- same sibling-hub-authorized RPC dispatcher TransactionLedger.tsx already
-- uses (src/lib/paymentConfirmation.ts), instead of the generic hub-locked
-- client .update() it used before -- which could silently affect 0 rows for
-- a sibling-hub entry while still showing a false "confirmed" toast.
-- package_entries has no bank_reference/bank_sender/bank_alert_text
-- columns (see note above), so confirm_payment_package is untouched.
-- These 3 already exist with a 4-param signature from 20260902 -- DROP
-- first since 3 params are being added.
DROP FUNCTION IF EXISTS public.confirm_payment_cargo(text, boolean, text, text);

CREATE OR REPLACE FUNCTION public.confirm_payment_cargo(
  p_entry_ref         text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_bank_reference    text DEFAULT NULL,
  p_bank_sender       text DEFAULT NULL,
  p_bank_alert_text   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id     uuid;
  v_entered_by text;
BEGIN
  SELECT hub_id, entered_by INTO v_hub_id, v_entered_by FROM public.cargo_entries WHERE entry_ref = p_entry_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
  END IF;
  IF v_hub_id IS NOT NULL AND v_hub_id <> ALL(public.sibling_hub_ids()) AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment for this entry''s hub';
  END IF;
  IF p_confirmed AND v_entered_by IS NOT NULL AND v_entered_by = p_logged_by AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'You cannot confirm a payment you personally logged';
  END IF;

  UPDATE public.cargo_entries SET
    payment_confirmed = p_confirmed,
    confirmed_by      = CASE WHEN p_confirmed THEN COALESCE(p_logged_by, confirmed_by) ELSE NULL END,
    confirmed_at       = CASE WHEN p_confirmed THEN now() ELSE NULL END,
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code),
    bank_reference     = COALESCE(p_bank_reference, bank_reference),
    bank_sender        = COALESCE(p_bank_sender, bank_sender),
    bank_alert_text    = COALESCE(p_bank_alert_text, bank_alert_text)
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_cargo(text, boolean, text, text, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.confirm_payment_baggage(text, boolean, text, text);

CREATE OR REPLACE FUNCTION public.confirm_payment_baggage(
  p_transaction_id    text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_bank_reference    text DEFAULT NULL,
  p_bank_sender       text DEFAULT NULL,
  p_bank_alert_text   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id     uuid;
  v_entered_by text;
BEGIN
  SELECT hub_id, entered_by INTO v_hub_id, v_entered_by FROM public.manifests WHERE transaction_id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage manifest % not found', p_transaction_id;
  END IF;
  IF v_hub_id IS NOT NULL AND v_hub_id <> ALL(public.sibling_hub_ids()) AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment for this entry''s hub';
  END IF;
  IF p_confirmed AND v_entered_by IS NOT NULL AND v_entered_by = p_logged_by AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'You cannot confirm a payment you personally logged';
  END IF;

  UPDATE public.manifests SET
    payment_confirmed = p_confirmed,
    confirmed_by      = CASE WHEN p_confirmed THEN COALESCE(p_logged_by, confirmed_by) ELSE NULL END,
    confirmed_at       = CASE WHEN p_confirmed THEN now() ELSE NULL END,
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code),
    bank_reference     = COALESCE(p_bank_reference, bank_reference),
    bank_sender        = COALESCE(p_bank_sender, bank_sender),
    bank_alert_text    = COALESCE(p_bank_alert_text, bank_alert_text)
  WHERE transaction_id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_baggage(text, boolean, text, text, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.confirm_payment_marketing(text, boolean, text, text);

CREATE OR REPLACE FUNCTION public.confirm_payment_marketing(
  p_entry_ref         text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL,
  p_bank_reference    text DEFAULT NULL,
  p_bank_sender       text DEFAULT NULL,
  p_bank_alert_text   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id     uuid;
  v_entered_by text;
BEGIN
  SELECT hub_id, entered_by INTO v_hub_id, v_entered_by FROM public.marketing_entries WHERE entry_ref = p_entry_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketing entry % not found', p_entry_ref;
  END IF;
  IF v_hub_id IS NOT NULL AND v_hub_id <> ALL(public.sibling_hub_ids()) AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment for this entry''s hub';
  END IF;
  IF p_confirmed AND v_entered_by IS NOT NULL AND v_entered_by = p_logged_by AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'You cannot confirm a payment you personally logged';
  END IF;

  UPDATE public.marketing_entries SET
    payment_confirmed = p_confirmed,
    confirmed_by      = CASE WHEN p_confirmed THEN COALESCE(p_logged_by, confirmed_by) ELSE NULL END,
    confirmed_at       = CASE WHEN p_confirmed THEN now() ELSE NULL END,
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code),
    bank_reference     = COALESCE(p_bank_reference, bank_reference),
    bank_sender        = COALESCE(p_bank_sender, bank_sender),
    bank_alert_text    = COALESCE(p_bank_alert_text, bank_alert_text)
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_marketing(text, boolean, text, text, text, text, text) TO authenticated;

-- ─── 6. GAT print-queue "mark printed" stamp: narrow authorized RPC ───────
-- GatPrintQueue.tsx's "mark as printed" write was a plain client .update()
-- on cargo_entries/package_entries. The SELECT that populates the queue
-- uses the sibling-hub-widened RLS policy (20260817_state_visibility.sql),
-- but the UPDATE policy was never widened to match (same bug class already
-- fixed for debt-clearing in 20260819_clear_debt_state_wide.sql) -- a
-- cargo_agent/baggage_agent/etc. whose own hub differs from the GAT-tagged
-- rows' hub got a false "N printed" toast while the write silently
-- affected 0 rows. p_table/p_column are whitelisted before being used in
-- dynamic SQL (format()'s %I safely quotes identifiers; the IN checks
-- below block anything outside the two expected tables/columns from ever
-- reaching it).
CREATE OR REPLACE FUNCTION public.mark_gat_printed(
  p_table     text,
  p_entry_ref text,
  p_column    text,
  p_logged_by text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id uuid;
BEGIN
  IF p_table NOT IN ('cargo_entries', 'package_entries') THEN
    RAISE EXCEPTION 'Invalid table for GAT print stamping: %', p_table;
  END IF;
  IF p_column NOT IN ('tag_printed_at', 'receipt_printed_at') THEN
    RAISE EXCEPTION 'Invalid column for GAT print stamping: %', p_column;
  END IF;

  EXECUTE format('SELECT hub_id FROM public.%I WHERE entry_ref = $1 FOR UPDATE', p_table)
    INTO v_hub_id USING p_entry_ref;

  IF NOT FOUND THEN
    RAISE EXCEPTION '% entry % not found', p_table, p_entry_ref;
  END IF;

  IF v_hub_id IS NOT NULL AND v_hub_id <> ALL(public.sibling_hub_ids()) AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to mark this entry printed for its hub';
  END IF;

  EXECUTE format('UPDATE public.%I SET %I = now() WHERE entry_ref = $1', p_table, p_column)
    USING p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_gat_printed(text, text, text, text) TO authenticated;

INSERT INTO public.schema_migrations (filename) VALUES ('20260903_security_and_bugfix_pass.sql')
ON CONFLICT (filename) DO NOTHING;
