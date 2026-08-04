-- =============================================================
-- Maker-checker approval for wallet top-ups and retrieval refunds
-- =============================================================
-- Today: apply_wallet_transaction() restricts top_up/adjustment to
-- accountant/admin/super_admin/auditor -- front-line roles (cargo_agent,
-- baggage_agent, marketing_agent, driver, office_work) can't top up a
-- wallet at all. Separately, process_*_retrieval() credits a wallet
-- refund immediately and unconditionally for ANY role with zero approval
-- gate -- the existing approve_*_retrieval()/can_approve_retrievals
-- machinery (20260906_retrieval_approval_and_permission.sql) only stamps
-- a review flag AFTER the money already moved; it blocks nothing.
--
-- This migration extends the already-hardened cash-payout maker-checker
-- pattern (request_wallet_cash_payout/approve_wallet_cash_payout/
-- reject_wallet_cash_payout, 20260902 + 20260907) to both:
--   1. Top-ups: new request_wallet_top_up() lets ANY authenticated,
--      hub-matched user create a 'pending' wallet_transactions row without
--      touching balance. The existing direct apply_wallet_transaction()
--      path (accountant/admin/super_admin/auditor) is untouched.
--   2. Retrieval refunds: process_*_retrieval() (all 4 department types)
--      no longer calls apply_wallet_transaction() to credit the refund
--      inline. It still updates the entry's retrieved_pieces/kg/amount/
--      status and folds debt reduction into retrieved_amount immediately
--      and unconditionally (goods release + debt bookkeeping are physical/
--      operational facts, not a second money movement) -- only the wallet
--      credit itself is deferred to a new pending 'retrieval_refund' row.
--
-- Both new pending types are approved/rejected by accountant/admin/
-- super_admin (matching CustomerWallets.tsx's existing canApprovePayouts
-- gate), self-approval blocked via auth.uid(), same as cash payouts.
-- =============================================================

-- ─── 1. wallet_transactions: allow the new 'retrieval_refund' type ────
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('top_up', 'deduction', 'refund', 'adjustment', 'cash_payout', 'retrieval_refund'));

-- ─── 2. Top-up request/approve/reject ──────────────────────────────────
-- No role restriction on the REQUEST side, matching request_wallet_cash_
-- payout's own precedent -- the client (CustomerWallets.tsx) decides
-- whether a role gets the immediate apply_wallet_transaction() path or
-- this pending path; this RPC only enforces the hub check, same as every
-- other wallet RPC.
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

  IF v_wallet_hub IS NOT NULL
    AND v_wallet_hub <> public.current_user_hub_id()
    AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to request a top-up for this wallet';
  END IF;

  -- balance_before/after both hold the CURRENT balance -- nothing has
  -- moved yet. EODReconciliation.tsx's cash-reconciliation query for
  -- type='top_up' has no status filter, so this pending row is already
  -- correctly counted as cash/transfer/POS collected today even before
  -- approval (the money was physically received; only the WALLET CREDIT
  -- is what's pending) -- and since approval updates this same row rather
  -- than inserting a second one, it's never double-counted either.
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

GRANT EXECUTE ON FUNCTION public.request_wallet_top_up(uuid, numeric, text, text, text) TO authenticated;

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

  IF v_wallet_hub IS NOT NULL
    AND v_wallet_hub <> public.current_user_hub_id()
    AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a top-up for this wallet';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.approve_wallet_top_up(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_wallet_top_up(
  p_transaction_id uuid,
  p_rejected_by    text,
  p_reason         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to reject a wallet top-up';
  END IF;

  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'top_up' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending top-up', p_transaction_id;
  END IF;

  UPDATE public.wallet_transactions
  SET status            = 'rejected',
      approved_by       = p_rejected_by,
      approved_by_user_id = auth.uid(),
      approved_at       = now(),
      rejection_reason  = p_reason
  WHERE id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_wallet_top_up(uuid, text, text) TO authenticated;

-- ─── 3. Retrieval refund approve/reject (shared across all 4 departments) ──
-- By approval time this is purely a wallet_transactions row -- no
-- department-specific entry table interaction needed, so one shared pair
-- of functions covers cargo/baggage/marketing/package alike.
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

  IF v_wallet_hub IS NOT NULL
    AND v_wallet_hub <> public.current_user_hub_id()
    AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a refund for this wallet';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.approve_retrieval_refund(uuid, text) TO authenticated;

-- Rejecting a refund does NOT reverse the entry's retrieved_pieces/kg/
-- status or its debt reduction -- those already happened as a separate,
-- unconditional operational fact (goods were released). If a refund is
-- rejected because the retrieval itself was mistaken, unretrieveEntry()
-- (src/lib/wallet.ts) is the existing, correct reversal path for that --
-- this function only ever un-does the wallet-credit side.
CREATE OR REPLACE FUNCTION public.reject_retrieval_refund(
  p_transaction_id uuid,
  p_rejected_by    text,
  p_reason         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to reject a retrieval refund';
  END IF;

  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'retrieval_refund' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending retrieval refund', p_transaction_id;
  END IF;

  UPDATE public.wallet_transactions
  SET status              = 'rejected',
      approved_by         = p_rejected_by,
      approved_by_user_id = auth.uid(),
      approved_at         = now(),
      rejection_reason    = p_reason
  WHERE id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_retrieval_refund(uuid, text, text) TO authenticated;

-- ─── 4. process_*_retrieval(): defer the wallet-credit branch to a ────
--        pending retrieval_refund row instead of crediting inline.
-- Return type changes (two new columns), so CREATE OR REPLACE can't be
-- used directly -- DROP first, matching each function's existing GRANT
-- parameter signature.

DROP FUNCTION IF EXISTS public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.process_cargo_retrieval(
  p_entry_ref text,
  p_is_partial boolean,
  p_retrieved_value numeric,
  p_retrieved_pieces numeric,
  p_retrieved_kg numeric,
  p_customer_name text,
  p_hub_id uuid,
  p_logged_by text,
  p_wallet_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL
)
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric, refund_status text, refund_transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
  v_refund_txn_id uuid;
BEGIN
  IF p_retrieved_value <= 0 THEN
    RAISE EXCEPTION 'Retrieved value must be positive (got %)', p_retrieved_value;
  END IF;

  SELECT id, amount, status, retrieved_amount, hub_id, amount_paid, receipt_mode
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
    RAISE EXCEPTION 'Not authorized to process a retrieval for this entry''s hub';
  END IF;

  v_already := COALESCE(v_entry.retrieved_amount, 0);
  IF v_already + p_retrieved_value > v_entry.amount THEN
    RAISE EXCEPTION 'Retrieval value % would exceed remaining retrievable amount (already retrieved % of %)',
      p_retrieved_value, v_already, v_entry.amount;
  END IF;

  v_new_status := CASE WHEN v_already + p_retrieved_value >= v_entry.amount THEN 'Retrieved' ELSE v_entry.status END;

  IF v_entry.receipt_mode IN ('Cash', 'Transfer', 'TransferCash', 'POS', 'Wallet', 'Complementary') THEN
    v_amount_paid := v_entry.amount;
  ELSE
    v_amount_paid := COALESCE(v_entry.amount_paid, 0);
  END IF;

  v_unpaid_debt := v_entry.amount - v_amount_paid - v_already;
  IF v_unpaid_debt < 0 THEN v_unpaid_debt := 0; END IF;

  v_debt_reduction := LEAST(p_retrieved_value, v_unpaid_debt);
  v_wallet_refund := p_retrieved_value - v_debt_reduction;

  -- Goods release + debt reduction (via retrieved_amount) apply
  -- unconditionally, regardless of refund-approval status below -- a
  -- customer isn't held at the counter waiting on a remote approval.
  UPDATE public.cargo_entries SET
    retrieved_pieces = COALESCE(retrieved_pieces, 0) + p_retrieved_pieces,
    retrieved_kg     = COALESCE(retrieved_kg, 0) + p_retrieved_kg,
    retrieved_amount = v_already + p_retrieved_value,
    retrieved        = (v_already + p_retrieved_value >= v_entry.amount),
    retrieved_at     = now(),
    retrieved_by     = p_logged_by,
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s pending wallet refund',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(
        'wallet:' || COALESCE(NULLIF(public.normalize_phone(p_customer_phone), ''), 'name:' || lower(trim(p_customer_name)) || ':' || COALESCE(p_hub_id::text, ''))
      )::bigint);
    END IF;

    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) = '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
        AND public.normalize_phone(customer_phone) = ''
      LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.customer_wallets (
        hub_id, customer_name, customer_phone, opening_balance, balance,
        total_topped_up, total_used, source_type, source_ref, source_note,
        status, created_by
      ) VALUES (
        p_hub_id, p_customer_name, NULLIF(p_customer_phone, ''), 0, 0,
        0, 0, 'airline_retrieval', p_entry_ref,
        format('Credit from %sretrieved cargo %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
        'active', p_logged_by
      ) RETURNING id INTO v_wallet_id;
    END IF;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status, requested_by_user_id
    ) VALUES (
      v_wallet_id, p_hub_id, 'retrieval_refund', v_wallet_refund,
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      p_entry_ref, v_entry.id,
      format('Cargo %sretrieval refund for %s (pending approval)', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by, auth.uid(), 'cargo', 'pending', auth.uid()
    ) RETURNING id INTO v_refund_txn_id;

    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'pending'::text, v_refund_txn_id;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'none'::text, NULL::uuid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.process_package_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.process_package_retrieval(
  p_entry_ref text,
  p_is_partial boolean,
  p_retrieved_value numeric,
  p_retrieved_pieces numeric,
  p_retrieved_kg numeric,
  p_customer_name text,
  p_hub_id uuid,
  p_logged_by text,
  p_wallet_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL
)
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric, refund_status text, refund_transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
  v_refund_txn_id uuid;
BEGIN
  IF p_retrieved_value <= 0 THEN
    RAISE EXCEPTION 'Retrieved value must be positive (got %)', p_retrieved_value;
  END IF;

  SELECT id, amount, status, retrieved_amount, hub_id, amount_paid, payment_mode
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
    RAISE EXCEPTION 'Not authorized to process a retrieval for this entry''s hub';
  END IF;

  v_already := COALESCE(v_entry.retrieved_amount, 0);
  IF v_already + p_retrieved_value > v_entry.amount THEN
    RAISE EXCEPTION 'Retrieval value % would exceed remaining retrievable amount (already retrieved % of %)',
      p_retrieved_value, v_already, v_entry.amount;
  END IF;

  v_new_status := CASE WHEN v_already + p_retrieved_value >= v_entry.amount THEN 'Retrieved' ELSE v_entry.status END;

  IF v_entry.payment_mode IN ('Cash', 'Transfer', 'TransferCash', 'POS', 'Wallet', 'Complementary') THEN
    v_amount_paid := v_entry.amount;
  ELSE
    v_amount_paid := COALESCE(v_entry.amount_paid, 0);
  END IF;

  v_unpaid_debt := v_entry.amount - v_amount_paid - v_already;
  IF v_unpaid_debt < 0 THEN v_unpaid_debt := 0; END IF;

  v_debt_reduction := LEAST(p_retrieved_value, v_unpaid_debt);
  v_wallet_refund := p_retrieved_value - v_debt_reduction;

  UPDATE public.package_entries SET
    retrieved_pieces = COALESCE(retrieved_pieces, 0) + p_retrieved_pieces,
    retrieved_kg     = COALESCE(retrieved_kg, 0) + p_retrieved_kg,
    retrieved_amount = v_already + p_retrieved_value,
    retrieved        = (v_already + p_retrieved_value >= v_entry.amount),
    retrieved_at     = now(),
    retrieved_by     = p_logged_by,
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s pending wallet refund',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(
        'wallet:' || COALESCE(NULLIF(public.normalize_phone(p_customer_phone), ''), 'name:' || lower(trim(p_customer_name)) || ':' || COALESCE(p_hub_id::text, ''))
      )::bigint);
    END IF;

    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) = '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
        AND public.normalize_phone(customer_phone) = ''
      LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.customer_wallets (
        hub_id, customer_name, customer_phone, opening_balance, balance,
        total_topped_up, total_used, source_type, source_ref, source_note,
        status, created_by
      ) VALUES (
        p_hub_id, p_customer_name, NULLIF(p_customer_phone, ''), 0, 0,
        0, 0, 'airline_retrieval', p_entry_ref,
        format('Credit from %sretrieved package %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
        'active', p_logged_by
      ) RETURNING id INTO v_wallet_id;
    END IF;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status, requested_by_user_id
    ) VALUES (
      v_wallet_id, p_hub_id, 'retrieval_refund', v_wallet_refund,
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      p_entry_ref, v_entry.id,
      format('Package %sretrieval refund for %s (pending approval)', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by, auth.uid(), 'package', 'pending', auth.uid()
    ) RETURNING id INTO v_refund_txn_id;

    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'pending'::text, v_refund_txn_id;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'none'::text, NULL::uuid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_package_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.process_baggage_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.process_baggage_retrieval(
  p_transaction_id text,
  p_is_partial boolean,
  p_retrieved_value numeric,
  p_retrieved_pieces numeric,
  p_retrieved_kg numeric,
  p_customer_name text,
  p_hub_id uuid,
  p_logged_by text,
  p_wallet_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL
)
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric, refund_status text, refund_transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
  v_refund_txn_id uuid;
BEGIN
  IF p_retrieved_value <= 0 THEN
    RAISE EXCEPTION 'Retrieved value must be positive (got %)', p_retrieved_value;
  END IF;

  SELECT id, amount, status, retrieved_amount, hub_id, amount_paid, payment_mode
  INTO v_entry
  FROM public.manifests
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baggage manifest % not found', p_transaction_id;
  END IF;

  IF v_entry.hub_id IS NOT NULL
     AND v_entry.hub_id <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to process a retrieval for this entry''s hub';
  END IF;

  v_already := COALESCE(v_entry.retrieved_amount, 0);
  IF v_already + p_retrieved_value > v_entry.amount THEN
    RAISE EXCEPTION 'Retrieval value % would exceed remaining retrievable amount (already retrieved % of %)',
      p_retrieved_value, v_already, v_entry.amount;
  END IF;

  v_new_status := CASE WHEN v_already + p_retrieved_value >= v_entry.amount THEN 'Retrieved' ELSE v_entry.status END;

  IF v_entry.payment_mode IN ('Cash', 'Transfer', 'TransferCash', 'POS', 'Wallet', 'Complementary') THEN
    v_amount_paid := v_entry.amount;
  ELSE
    v_amount_paid := COALESCE(v_entry.amount_paid, 0);
  END IF;

  v_unpaid_debt := v_entry.amount - v_amount_paid - v_already;
  IF v_unpaid_debt < 0 THEN v_unpaid_debt := 0; END IF;

  v_debt_reduction := LEAST(p_retrieved_value, v_unpaid_debt);
  v_wallet_refund := p_retrieved_value - v_debt_reduction;

  UPDATE public.manifests SET
    retrieved_pieces = COALESCE(retrieved_pieces, 0) + p_retrieved_pieces,
    retrieved_kg     = COALESCE(retrieved_kg, 0) + p_retrieved_kg,
    retrieved_amount = v_already + p_retrieved_value,
    retrieved        = (v_already + p_retrieved_value >= v_entry.amount),
    retrieved_at     = now(),
    retrieved_by     = p_logged_by,
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s pending wallet refund',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE transaction_id = p_transaction_id;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(
        'wallet:' || COALESCE(NULLIF(public.normalize_phone(p_customer_phone), ''), 'name:' || lower(trim(p_customer_name)) || ':' || COALESCE(p_hub_id::text, ''))
      )::bigint);
    END IF;

    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) = '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
        AND public.normalize_phone(customer_phone) = ''
      LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.customer_wallets (
        hub_id, customer_name, customer_phone, opening_balance, balance,
        total_topped_up, total_used, source_type, source_ref, source_note,
        status, created_by
      ) VALUES (
        p_hub_id, p_customer_name, NULLIF(p_customer_phone, ''), 0, 0,
        0, 0, 'airline_retrieval', p_transaction_id,
        format('Credit from %sretrieved baggage %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_transaction_id),
        'active', p_logged_by
      ) RETURNING id INTO v_wallet_id;
    END IF;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status, requested_by_user_id
    ) VALUES (
      v_wallet_id, p_hub_id, 'retrieval_refund', v_wallet_refund,
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      p_transaction_id, v_entry.id,
      format('Baggage %sretrieval refund for %s (pending approval)', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_transaction_id),
      p_logged_by, auth.uid(), 'baggage', 'pending', auth.uid()
    ) RETURNING id INTO v_refund_txn_id;

    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'pending'::text, v_refund_txn_id;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'none'::text, NULL::uuid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_baggage_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.process_marketing_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.process_marketing_retrieval(
  p_entry_ref text,
  p_is_partial boolean,
  p_retrieved_value numeric,
  p_retrieved_pieces numeric,
  p_retrieved_kg numeric,
  p_customer_name text,
  p_hub_id uuid,
  p_logged_by text,
  p_wallet_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL
)
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric, refund_status text, refund_transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
  v_refund_txn_id uuid;
BEGIN
  IF p_retrieved_value <= 0 THEN
    RAISE EXCEPTION 'Retrieved value must be positive (got %)', p_retrieved_value;
  END IF;

  SELECT id, amount_paid AS amount, status, retrieved_amount, hub_id, debt_amount_paid, payment_mode
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
    RAISE EXCEPTION 'Not authorized to process a retrieval for this entry''s hub';
  END IF;

  v_already := COALESCE(v_entry.retrieved_amount, 0);
  IF v_already + p_retrieved_value > v_entry.amount THEN
    RAISE EXCEPTION 'Retrieval value % would exceed remaining retrievable amount (already retrieved % of %)',
      p_retrieved_value, v_already, v_entry.amount;
  END IF;

  v_new_status := CASE WHEN v_already + p_retrieved_value >= v_entry.amount THEN 'Retrieved' ELSE v_entry.status END;

  IF v_entry.payment_mode IN ('Cash', 'Transfer', 'TransferCash', 'POS', 'Wallet', 'Complementary') THEN
    v_amount_paid := v_entry.amount;
  ELSE
    v_amount_paid := COALESCE(v_entry.debt_amount_paid, 0);
  END IF;

  v_unpaid_debt := v_entry.amount - v_amount_paid - v_already;
  IF v_unpaid_debt < 0 THEN v_unpaid_debt := 0; END IF;

  v_debt_reduction := LEAST(p_retrieved_value, v_unpaid_debt);
  v_wallet_refund := p_retrieved_value - v_debt_reduction;

  UPDATE public.marketing_entries SET
    retrieved_pieces = COALESCE(retrieved_pieces, 0) + p_retrieved_pieces,
    retrieved_kg     = COALESCE(retrieved_kg, 0) + p_retrieved_kg,
    retrieved_amount = v_already + p_retrieved_value,
    retrieved        = (v_already + p_retrieved_value >= v_entry.amount),
    retrieved_at     = now(),
    retrieved_by     = p_logged_by,
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('%s retrieval: %s debt cleared, %s pending wallet refund',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(
        'wallet:' || COALESCE(NULLIF(public.normalize_phone(p_customer_phone), ''), 'name:' || lower(trim(p_customer_name)) || ':' || COALESCE(p_hub_id::text, ''))
      )::bigint);
    END IF;

    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) = '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
        AND public.normalize_phone(customer_phone) = ''
      LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.customer_wallets (
        hub_id, customer_name, customer_phone, opening_balance, balance,
        total_topped_up, total_used, source_type, source_ref, source_note,
        status, created_by
      ) VALUES (
        p_hub_id, p_customer_name, NULLIF(p_customer_phone, ''), 0, 0,
        0, 0, 'airline_retrieval', p_entry_ref,
        format('Credit from %sretrieved marketing entry %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
        'active', p_logged_by
      ) RETURNING id INTO v_wallet_id;
    END IF;

    INSERT INTO public.wallet_transactions (
      wallet_id, hub_id, type, amount, balance_before, balance_after,
      cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
      department, status, requested_by_user_id
    ) VALUES (
      v_wallet_id, p_hub_id, 'retrieval_refund', v_wallet_refund,
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id),
      p_entry_ref, v_entry.id,
      format('Marketing %sretrieval refund for %s (pending approval)', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by, auth.uid(), 'marketing', 'pending', auth.uid()
    ) RETURNING id INTO v_refund_txn_id;

    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'pending'::text, v_refund_txn_id;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction, 'none'::text, NULL::uuid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_marketing_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;
