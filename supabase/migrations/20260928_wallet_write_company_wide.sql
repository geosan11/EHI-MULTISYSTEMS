-- =============================================================
-- Complete the company-wide wallet fix: writes, not just reads
-- =============================================================
-- 20260924_customer_wallets_company_wide_read.sql made customer_wallets
-- readable company-wide (SELECT policy), fixing the reported bug where a
-- wallet created by a super_admin (or any staff at a different hub) was
-- invisible to front-line staff elsewhere. But every wallet-MUTATING RPC
-- still independently hub-checks the wallet itself (`v_wallet_hub <>
-- current_user_hub_id()`), so the fix was read-only: staff could now SEE a
-- cross-hub wallet in the picker, but topping it up or paying with it
-- ("Select Wallet for <customer>" -> charge, the exact live-repro flow
-- that surfaced the original bug) still raised "Not authorized to update
-- this wallet". Since customer wallets are explicitly a company-wide
-- customer relationship (not hub-scoped operational data like a cargo
-- entry), the write-side hub gate is removed here too, for every RPC that
-- gates on the WALLET's own hub_id specifically:
--   - apply_wallet_transaction (the direct top-up/deduction/refund/
--     adjustment path used by chargeWalletForSale at intake and
--     CustomerWallets.tsx's accountant+ top-up)
--   - request_wallet_cash_payout / approve_wallet_cash_payout
--   - request_wallet_top_up / approve_wallet_top_up
--   - approve_retrieval_refund
-- Deliberately NOT touched:
--   - force_delete_wallet's hub check (20260907_wallet_rpc_security_
--     hardening.sql) -- added there as a deliberate hardening for a
--     maximally destructive, irreversible action, not an oversight; stays
--     stricter than the rest of the wallet surface on purpose.
--   - Every ENTRY-side hub check (cargo_entries/manifests/package_entries/
--     marketing_entries via sibling_hub_ids()) -- those are genuinely
--     hub-scoped operational records and are untouched by this migration.
-- =============================================================

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_wallet_id       uuid,
  p_type            text,
  p_amount          numeric,
  p_cargo_ref       text DEFAULT NULL,
  p_cargo_entry_id  uuid DEFAULT NULL,
  p_description     text DEFAULT NULL,
  p_logged_by       text DEFAULT NULL,
  p_department      text DEFAULT 'cargo',
  p_payment_mode    text DEFAULT NULL
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

  IF p_payment_mode IS NOT NULL AND p_payment_mode NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Invalid payment mode: %', p_payment_mode;
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
    cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id, department, status, payment_mode
  ) VALUES (
    p_wallet_id, v_wallet_hub, p_type, p_amount, v_balance_before, v_balance_after,
    p_cargo_ref, p_cargo_entry_id, p_description, COALESCE(p_logged_by, 'system'), auth.uid(),
    p_department, 'completed', p_payment_mode
  ) RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_balance_after, v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_wallet_cash_payout(
  p_wallet_id     uuid,
  p_amount        numeric,
  p_department    text,
  p_requested_by  text,
  p_note          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_hub  uuid;
  v_balance     numeric;
  v_txn_id      uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Cash payout amount must be positive (got %)', p_amount;
  END IF;

  IF p_department NOT IN ('cargo', 'baggage', 'marketing', 'package') THEN
    RAISE EXCEPTION 'Invalid department: %', p_department;
  END IF;

  SELECT hub_id, balance INTO v_wallet_hub, v_balance
  FROM public.customer_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Insufficient wallet balance: has %, requested %', v_balance, p_amount;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, hub_id, type, amount, balance_before, balance_after,
    description, logged_by, department, status, requested_by_user_id
  ) VALUES (
    p_wallet_id, v_wallet_hub, 'cash_payout', p_amount, v_balance, v_balance,
    p_note, p_requested_by, p_department, 'pending', auth.uid()
  ) RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_wallet_cash_payout(
  p_transaction_id uuid,
  p_approved_by    text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         RECORD;
  v_wallet_hub  uuid;
  v_balance     numeric;
  v_new_balance numeric;
BEGIN
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to approve a wallet cash payout';
  END IF;

  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'cash_payout' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending cash payout', p_transaction_id;
  END IF;

  IF v_row.requested_by_user_id IS NOT NULL THEN
    IF v_row.requested_by_user_id = auth.uid() THEN
      RAISE EXCEPTION 'The agent who requested a cash payout cannot also approve it';
    END IF;
  ELSIF v_row.logged_by = p_approved_by THEN
    RAISE EXCEPTION 'The agent who requested a cash payout cannot also approve it';
  END IF;

  SELECT hub_id, balance INTO v_wallet_hub, v_balance
  FROM public.customer_wallets
  WHERE id = v_row.wallet_id
  FOR UPDATE;

  IF v_row.amount > v_balance THEN
    RAISE EXCEPTION 'Insufficient wallet balance: has %, needs %', v_balance, v_row.amount;
  END IF;

  UPDATE public.customer_wallets
  SET balance         = balance - v_row.amount,
      total_used      = total_used + v_row.amount,
      status          = CASE WHEN balance - v_row.amount <= 0 THEN 'exhausted' ELSE 'active' END,
      updated_at      = now()
  WHERE id = v_row.wallet_id
  RETURNING balance INTO v_new_balance;

  UPDATE public.wallet_transactions
  SET status              = 'completed',
      balance_before      = v_balance,
      balance_after       = v_new_balance,
      approved_by         = p_approved_by,
      approved_by_user_id = auth.uid(),
      approved_at         = now()
  WHERE id = p_transaction_id;

  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_wallet_top_up(
  p_wallet_id     uuid,
  p_amount        numeric,
  p_requested_by  text,
  p_payment_mode  text DEFAULT NULL,
  p_note          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_hub  uuid;
  v_balance     numeric;
  v_txn_id      uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Top-up amount must be positive (got %)', p_amount;
  END IF;

  IF p_payment_mode IS NOT NULL AND p_payment_mode NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Invalid payment mode: %', p_payment_mode;
  END IF;

  SELECT hub_id, balance INTO v_wallet_hub, v_balance
  FROM public.customer_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, hub_id, type, amount, balance_before, balance_after,
    description, logged_by, logged_by_user_id, status, requested_by_user_id, payment_mode
  ) VALUES (
    p_wallet_id, v_wallet_hub, 'top_up', p_amount, v_balance, v_balance,
    p_note, p_requested_by, auth.uid(), 'pending', auth.uid(), p_payment_mode
  ) RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_wallet_top_up(
  p_transaction_id uuid,
  p_approved_by    text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         RECORD;
  v_wallet_hub  uuid;
  v_balance     numeric;
  v_new_balance numeric;
BEGIN
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to approve a wallet top-up';
  END IF;

  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'top_up' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending top-up', p_transaction_id;
  END IF;

  IF v_row.requested_by_user_id IS NOT NULL THEN
    IF v_row.requested_by_user_id = auth.uid() THEN
      RAISE EXCEPTION 'The agent who requested a top-up cannot also approve it';
    END IF;
  ELSIF v_row.logged_by = p_approved_by THEN
    RAISE EXCEPTION 'The agent who requested a top-up cannot also approve it';
  END IF;

  SELECT hub_id, balance INTO v_wallet_hub, v_balance
  FROM public.customer_wallets
  WHERE id = v_row.wallet_id
  FOR UPDATE;

  UPDATE public.customer_wallets
  SET balance         = balance + v_row.amount,
      total_topped_up = total_topped_up + v_row.amount,
      status          = 'active',
      updated_at      = now()
  WHERE id = v_row.wallet_id
  RETURNING balance INTO v_new_balance;

  UPDATE public.wallet_transactions
  SET status              = 'completed',
      balance_before      = v_balance,
      balance_after       = v_new_balance,
      approved_by         = p_approved_by,
      approved_by_user_id = auth.uid(),
      approved_at         = now()
  WHERE id = p_transaction_id;

  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_retrieval_refund(
  p_transaction_id uuid,
  p_approved_by    text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         RECORD;
  v_wallet_hub  uuid;
  v_balance     numeric;
  v_new_balance numeric;
BEGIN
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to approve a retrieval refund';
  END IF;

  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'retrieval_refund' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending retrieval refund', p_transaction_id;
  END IF;

  IF v_row.requested_by_user_id IS NOT NULL THEN
    IF v_row.requested_by_user_id = auth.uid() THEN
      RAISE EXCEPTION 'The agent who processed the retrieval cannot also approve its refund';
    END IF;
  ELSIF v_row.logged_by = p_approved_by THEN
    RAISE EXCEPTION 'The agent who processed the retrieval cannot also approve its refund';
  END IF;

  SELECT hub_id, balance INTO v_wallet_hub, v_balance
  FROM public.customer_wallets
  WHERE id = v_row.wallet_id
  FOR UPDATE;

  UPDATE public.customer_wallets
  SET balance         = balance + v_row.amount,
      total_topped_up = total_topped_up + v_row.amount,
      status          = 'active',
      updated_at      = now()
  WHERE id = v_row.wallet_id
  RETURNING balance INTO v_new_balance;

  UPDATE public.wallet_transactions
  SET status              = 'completed',
      balance_before      = v_balance,
      balance_after       = v_new_balance,
      approved_by         = p_approved_by,
      approved_by_user_id = auth.uid(),
      approved_at         = now()
  WHERE id = p_transaction_id;

  RETURN v_new_balance;
END;
$$;
