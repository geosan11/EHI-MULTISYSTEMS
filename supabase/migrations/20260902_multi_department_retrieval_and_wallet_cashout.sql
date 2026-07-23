-- =============================================================
-- Multi-department retrieval + wallet department tagging + wallet cash payouts
-- (Real authoring date: 2026-07-22. Filename prefixed 2026090x per
-- docs/MIGRATION_POLICY.md so it sorts after every migration already
-- applied to the live database.)
-- =============================================================
-- process_cargo_retrieval() (20260810_wallet_atomicity_and_isolation.sql,
-- redefined by 20260815_fix_retrieval_debt_logic.sql) is the only
-- retrieval-to-wallet path in the app -- hardcoded against cargo_entries.
-- Package/Baggage/Marketing have no equivalent at all. This migration:
--   1. Adds the same retrieved_* tracking columns cargo_entries already has
--      to package_entries, manifests, marketing_entries.
--   2. Adds wallet_transactions.department so a shared cross-department
--      wallet's history shows which department each transaction came from.
--   3. Adds wallet_transactions.status/approved_by/approved_at/
--      rejection_reason and a new 'cash_payout' type, for a maker-checker
--      cash-payout flow: one agent requests it (no balance change yet),
--      a different person with financial authority approves or rejects it.
--   4. Redefines apply_wallet_transaction()/process_cargo_retrieval() to
--      thread the department through, and adds process_package_retrieval/
--      process_baggage_retrieval/process_marketing_retrieval mirroring
--      cargo's debt-then-wallet-refund split logic against their own
--      tables (each table's id column, amount-paid column, and payment
--      mode column differ -- same per-type split debt.ts's clear_*_debt
--      functions already established for debt clearing).
-- =============================================================

-- ─── 1. RETRIEVAL TRACKING COLUMNS ON THE 3 REMAINING TABLES ──────────
-- Mirrors cargo_entries' own retrieved_pieces/retrieved_kg/retrieved_amount
-- (20260810_wallet_atomicity_and_isolation.sql) plus retrieved/retrieved_at/
-- retrieved_by/retrieval_note (present on cargo_entries since the original
-- 20260706_full_schema.sql boolean + the same migration's text/timestamptz
-- additions).
ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS retrieved_pieces  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved_kg      numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved_amount  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS retrieved_by      text,
  ADD COLUMN IF NOT EXISTS retrieval_note    text;

ALTER TABLE public.manifests
  ADD COLUMN IF NOT EXISTS retrieved_pieces  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved_kg      numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved_amount  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS retrieved_by      text,
  ADD COLUMN IF NOT EXISTS retrieval_note    text;

ALTER TABLE public.marketing_entries
  ADD COLUMN IF NOT EXISTS retrieved_pieces  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved_kg      numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved_amount  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retrieved         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retrieved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS retrieved_by      text,
  ADD COLUMN IF NOT EXISTS retrieval_note    text;

-- ─── 2. WALLET_TRANSACTIONS: DEPARTMENT TAG ────────────────────────────
-- The wallet itself (customer_wallets) stays ONE shared cross-department
-- balance -- this tags each individual transaction with which department
-- it happened in, not the wallet as a whole.
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS department text;

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_department_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_department_check
  CHECK (department IS NULL OR department IN ('cargo', 'baggage', 'marketing', 'package'));

-- Every wallet transaction to date came from cargo retrieval -- the only
-- department wired up before this migration.
UPDATE public.wallet_transactions SET department = 'cargo' WHERE department IS NULL;

-- ─── 3. WALLET_TRANSACTIONS: CASH-PAYOUT MAKER-CHECKER COLUMNS ────────
-- status stays 'completed' (the default) for every existing type and every
-- future top_up/deduction/refund/adjustment -- no behavior change for
-- those. Only a new 'cash_payout' row starts 'pending' and is later
-- flipped to 'completed' (by approve_wallet_cash_payout) or 'rejected' (by
-- reject_wallet_cash_payout).
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS approved_by       text,
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason  text;

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_status_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_status_check
  CHECK (status IN ('completed', 'pending', 'rejected'));

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('top_up', 'deduction', 'refund', 'adjustment', 'cash_payout'));

-- ─── 4. apply_wallet_transaction(): THREAD DEPARTMENT THROUGH ─────────
-- Same 2-column return shape as before -- safe CREATE OR REPLACE, no DROP
-- needed. p_department defaults to 'cargo' so every existing call site
-- (CargoForm, ExcessBaggageForm, MarketingWorkspace, PackageForm,
-- CustomerWallets top-up, FraudAlerts) keeps working unmodified until
-- callers are updated to pass their own department explicitly.
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

-- ─── 5. process_cargo_retrieval(): THREAD DEPARTMENT THROUGH ──────────
-- Identical logic to 20260815_fix_retrieval_debt_logic.sql's definition,
-- just passing p_department := 'cargo' into apply_wallet_transaction. Same
-- 4-column return shape -- safe CREATE OR REPLACE.
--
-- FIXED 2026-07-22: this CREATE OR REPLACE originally re-declared the OLD
-- 9-param signature (no p_customer_phone), while 20260826_wallet_phone_
-- identity.sql had already installed a 10-param version (with
-- p_customer_phone) via its own DROP FUNCTION + CREATE. Postgres treats a
-- different parameter list as a distinct overload, not a replace -- so
-- without the DROPs below, this file was creating a SECOND, coexisting
-- process_cargo_retrieval alongside the 10-param one, leaving every real
-- call (which omits p_customer_phone -- see src/lib/wallet.ts) ambiguous
-- between two candidate functions and likely to fail with Postgres error
-- 42725 "function is not unique". Both possible prior signatures are
-- dropped unconditionally so this is safe to re-run regardless of which
-- one (if either) is currently live, and p_customer_phone + phone-priority
-- wallet matching (20260826's actual fix) is restored here.
DROP FUNCTION IF EXISTS public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid);
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
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_txn_result RECORD;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
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

  -- sibling_hub_ids() (20260817_state_visibility.sql), not a strict
  -- current_user_hub_id() match -- matching the READ policy's scope and
  -- the same fix already applied to clear_cargo_debt/clear_baggage_debt/
  -- clear_marketing_debt/clear_package_debt (20260819_clear_debt_state_
  -- wide.sql): an agent who can SEE this entry via sibling-hub visibility
  -- must also be able to act on it, or every retrieval attempted on a
  -- sibling hub's own entry (not the agent's literal home hub) would hit
  -- this exception despite being fully visible in their ledger.
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

  UPDATE public.cargo_entries SET
    retrieved_pieces = COALESCE(retrieved_pieces, 0) + p_retrieved_pieces,
    retrieved_kg     = COALESCE(retrieved_kg, 0) + p_retrieved_kg,
    retrieved_amount = v_already + p_retrieved_value,
    retrieved        = (v_already + p_retrieved_value >= v_entry.amount),
    retrieved_at     = now(),
    retrieved_by     = p_logged_by,
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s refunded to wallet',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    -- Prefer an explicit wallet, then match by phone, then by name, else
    -- create -- restored from 20260826_wallet_phone_identity.sql, which
    -- this function's stray re-declare (see the fix comment above) had
    -- silently regressed back to name-only matching.
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
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

    SELECT * INTO v_txn_result FROM public.apply_wallet_transaction(
      v_wallet_id, 'refund', v_wallet_refund, p_entry_ref, v_entry.id,
      format('Cargo %sretrieval refund for %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by, 'cargo'
    );

    RETURN QUERY SELECT v_wallet_id, v_txn_result.new_balance, v_wallet_refund, v_debt_reduction;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

-- ─── 6. process_package_retrieval() ────────────────────────────────────
-- Mirrors process_cargo_retrieval() exactly against package_entries:
-- id column entry_ref, amount-paid column amount_paid, mode column
-- payment_mode (see debt.ts's RPC_BY_TYPE map for the same per-type split
-- already established for debt clearing).
--
-- FIXED 2026-07-22: added p_customer_phone + phone-priority wallet
-- matching to match process_cargo_retrieval's now-restored fix above --
-- this sibling never had phone matching at all (20260826 only patched
-- cargo). DROP first since this adds a parameter (same reasoning as above).
DROP FUNCTION IF EXISTS public.process_package_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid);

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
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_txn_result RECORD;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
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

  -- sibling_hub_ids() (20260817_state_visibility.sql), not a strict
  -- current_user_hub_id() match -- matching the READ policy's scope and
  -- the same fix already applied to clear_cargo_debt/clear_baggage_debt/
  -- clear_marketing_debt/clear_package_debt (20260819_clear_debt_state_
  -- wide.sql): an agent who can SEE this entry via sibling-hub visibility
  -- must also be able to act on it, or every retrieval attempted on a
  -- sibling hub's own entry (not the agent's literal home hub) would hit
  -- this exception despite being fully visible in their ledger.
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
                        format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s refunded to wallet',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
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

    SELECT * INTO v_txn_result FROM public.apply_wallet_transaction(
      v_wallet_id, 'refund', v_wallet_refund, p_entry_ref, v_entry.id,
      format('Package %sretrieval refund for %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by, 'package'
    );

    RETURN QUERY SELECT v_wallet_id, v_txn_result.new_balance, v_wallet_refund, v_debt_reduction;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_package_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

-- ─── 7. process_baggage_retrieval() ────────────────────────────────────
-- Mirrors process_cargo_retrieval() against manifests: id column
-- transaction_id, amount-paid column amount_paid, mode column payment_mode.
--
-- FIXED 2026-07-22: added p_customer_phone + phone-priority wallet
-- matching, same as the package sibling above.
DROP FUNCTION IF EXISTS public.process_baggage_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid);

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
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_txn_result RECORD;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
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

  -- sibling_hub_ids() (20260817_state_visibility.sql), not a strict
  -- current_user_hub_id() match -- matching the READ policy's scope and
  -- the same fix already applied to clear_cargo_debt/clear_baggage_debt/
  -- clear_marketing_debt/clear_package_debt (20260819_clear_debt_state_
  -- wide.sql): an agent who can SEE this entry via sibling-hub visibility
  -- must also be able to act on it, or every retrieval attempted on a
  -- sibling hub's own entry (not the agent's literal home hub) would hit
  -- this exception despite being fully visible in their ledger.
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
                        format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s refunded to wallet',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE transaction_id = p_transaction_id;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
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

    SELECT * INTO v_txn_result FROM public.apply_wallet_transaction(
      v_wallet_id, 'refund', v_wallet_refund, p_transaction_id, v_entry.id,
      format('Baggage %sretrieval refund for %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_transaction_id),
      p_logged_by, 'baggage'
    );

    RETURN QUERY SELECT v_wallet_id, v_txn_result.new_balance, v_wallet_refund, v_debt_reduction;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_baggage_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

-- ─── 8. process_marketing_retrieval() ──────────────────────────────────
-- Mirrors process_cargo_retrieval() against marketing_entries: id column
-- entry_ref, amount-paid column debt_amount_paid (naming inversion --
-- amount_paid on marketing_entries means the SALE total, not what's been
-- paid down -- see clear_marketing_debt's own comment on this, 20260710_
-- debt_payment_columns.sql), mode column payment_mode. p_retrieved_pieces/
-- p_retrieved_kg are accepted for signature parity with the other three
-- retrieval RPCs but marketing has no meaningful per-piece/per-kg concept
-- (bag-based); the client always passes 0 for both here.
-- FIXED 2026-07-22: added p_customer_phone + phone-priority wallet
-- matching, same as the other two siblings above.
DROP FUNCTION IF EXISTS public.process_marketing_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid);

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
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_already numeric;
  v_new_status text;
  v_wallet_id uuid := p_wallet_id;
  v_txn_result RECORD;
  v_amount_paid numeric;
  v_unpaid_debt numeric;
  v_wallet_refund numeric;
  v_debt_reduction numeric;
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

  -- sibling_hub_ids() (20260817_state_visibility.sql), not a strict
  -- current_user_hub_id() match -- matching the READ policy's scope and
  -- the same fix already applied to clear_cargo_debt/clear_baggage_debt/
  -- clear_marketing_debt/clear_package_debt (20260819_clear_debt_state_
  -- wide.sql): an agent who can SEE this entry via sibling-hub visibility
  -- must also be able to act on it, or every retrieval attempted on a
  -- sibling hub's own entry (not the agent's literal home hub) would hit
  -- this exception despite being fully visible in their ledger.
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
                        format('%s retrieval: %s debt cleared, %s refunded to wallet',
                          CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                          v_debt_reduction, v_wallet_refund),
    status           = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
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

    SELECT * INTO v_txn_result FROM public.apply_wallet_transaction(
      v_wallet_id, 'refund', v_wallet_refund, p_entry_ref, v_entry.id,
      format('Marketing %sretrieval refund for %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by, 'marketing'
    );

    RETURN QUERY SELECT v_wallet_id, v_txn_result.new_balance, v_wallet_refund, v_debt_reduction;
  ELSE
    RETURN QUERY SELECT v_wallet_id, (SELECT balance FROM public.customer_wallets WHERE id = v_wallet_id), v_wallet_refund, v_debt_reduction;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_marketing_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;

-- ─── 9. WALLET CASH-PAYOUT MAKER-CHECKER RPCs ──────────────────────────
-- FIXED 2026-07-22: the self-approval guard below originally compared
-- p_requested_by/p_approved_by, both plain client-supplied text display
-- names -- trivially defeated by calling request_wallet_cash_payout as
-- 'Staff A' and approve_wallet_cash_payout as 'Staff B' from the exact
-- same authenticated session. requested_by_user_id/approved_by_user_id
-- capture the real auth.uid() instead, which cannot be spoofed by the
-- caller -- the actual identity check now happens against that.
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by_user_id   uuid;


-- Requests a cash payout from a customer's existing wallet balance --
-- e.g. staff hand the customer physical cash instead of holding the
-- credit for a future purchase. Does NOT touch customer_wallets.balance;
-- it only records a 'pending' wallet_transactions row for a second person
-- to approve or reject. balance_before/balance_after are both set to the
-- CURRENT balance (unchanged) since nothing has actually moved yet --
-- approve_wallet_cash_payout re-reads the real balance at approval time
-- and overwrites both.
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

  IF v_wallet_hub IS NOT NULL
    AND v_wallet_hub <> public.current_user_hub_id()
    AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to request a payout from this wallet';
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

GRANT EXECUTE ON FUNCTION public.request_wallet_cash_payout(uuid, numeric, text, text, text) TO authenticated;

-- Approves a pending cash payout: re-validates the balance is still
-- sufficient (it may have changed since the request), rejects
-- self-approval (the requester cannot also be the approver -- same
-- maker-checker principle as TransactionLedger.tsx's toggleConfirm
-- skipping entries the current user logged themselves), then applies the
-- real deduction and finalizes the row.
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
  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'cash_payout' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending cash payout', p_transaction_id;
  END IF;

  -- Real-identity check (auth.uid()), not the spoofable text-name compare
  -- this used to be. v_row.requested_by_user_id IS NULL only for rows
  -- inserted before this column existed -- fall back to the name compare
  -- for those so old pending payouts aren't left permanently unapprovable.
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

  IF v_wallet_hub IS NOT NULL
    AND v_wallet_hub <> public.current_user_hub_id()
    AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to approve a payout for this wallet';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.approve_wallet_cash_payout(uuid, text) TO authenticated;

-- Rejects a pending cash payout -- no balance change, just records who
-- rejected it and why.
CREATE OR REPLACE FUNCTION public.reject_wallet_cash_payout(
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
  SELECT * INTO v_row FROM public.wallet_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet transaction % not found', p_transaction_id;
  END IF;

  IF v_row.type <> 'cash_payout' OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % is not a pending cash payout', p_transaction_id;
  END IF;

  UPDATE public.wallet_transactions
  SET status            = 'rejected',
      approved_by       = p_rejected_by,
      approved_at       = now(),
      rejection_reason  = p_reason
  WHERE id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_wallet_cash_payout(uuid, text, text) TO authenticated;

-- ─── 10. UNRETRIEVE: REVERSE A MISTAKEN RETRIEVAL ──────────────────────
-- Undoes retrieved_pieces/retrieved_kg/retrieved_amount/retrieved/status
-- back to never-retrieved. Deliberately does NOT touch any wallet balance
-- -- a retrieval's wallet credit and the entry's own retrieval bookkeeping
-- are corrected as two separate, deliberate actions (via CustomerWallets.tsx's
-- existing "Pay Cash Out" / TransactionLedger.tsx's edit-mode-to-Wallet
-- deduction), not bundled into one opaque undo. Bundling them would mean:
-- if a wallet was already corrected manually (exactly what happened for the
-- entry that prompted this feature), automatically deducting it AGAIN here
-- would either double-correct or hard-fail the whole reversal outright on
-- insufficient balance -- worse than just leaving wallet correction to a
-- clear, separate, already-available action.
CREATE OR REPLACE FUNCTION public.unretrieve_cargo_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
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
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_entry_ref;
  END IF;

  UPDATE public.cargo_entries SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount)
  WHERE entry_ref = p_entry_ref;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_cargo_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_package_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
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
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_entry_ref;
  END IF;

  UPDATE public.package_entries SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount)
  WHERE entry_ref = p_entry_ref;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_package_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_baggage_entry(
  p_transaction_id text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
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
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_transaction_id;
  END IF;

  UPDATE public.manifests SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount)
  WHERE transaction_id = p_transaction_id;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_baggage_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_marketing_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT id, hub_id, retrieved_amount, retrieved_pieces, retrieved_kg
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
    RAISE EXCEPTION 'Not authorized to reverse a retrieval for this entry''s hub';
  END IF;

  IF COALESCE(v_entry.retrieved_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Entry % has no retrieval to reverse', p_entry_ref;
  END IF;

  UPDATE public.marketing_entries SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s / %s) -- any wallet credit from it is NOT auto-reversed, correct separately if needed',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_amount)
  WHERE entry_ref = p_entry_ref;

  RETURN v_entry.retrieved_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_marketing_entry(text, text) TO authenticated;

-- ─── 11. STATE-WIDE PAYMENT CONFIRMATION ───────────────────────────────
-- The UPDATE policies on cargo_entries/manifests/marketing_entries/
-- package_entries were never widened to sibling_hub_ids() to match their
-- READ policies (20260817_state_visibility.sql) -- deliberately, per
-- 20260819_clear_debt_state_wide.sql's own comment: widening the general
-- UPDATE policy would open every field on these tables to cross-hub
-- edits, not just one narrow action. That RPC-per-action pattern is
-- reused here rather than reversing that decision.
--
-- TransactionLedger.tsx's toggleConfirm/savePosCode both call the generic
-- onUpdateTx path (a plain client .update()), which is therefore still
-- hub-locked to an exact match -- any staff member with the
-- can_print_ledger flag but NOT one of is_hub_unrestricted()'s roles
-- (super_admin/admin/accountant/auditor) confirming payment on a sibling
-- hub's visible-but-not-their-own entry hits the same silent
-- 0-rows-affected UPDATE clear_cargo_debt was fixed for. These four
-- functions only ever touch payment-confirmation fields (never amount,
-- name, route, or any other field handleSaveEdit's full-form edit
-- covers) -- that broader edit path is intentionally NOT widened here;
-- it stays same-hub-only, matching the original design.
CREATE OR REPLACE FUNCTION public.confirm_payment_cargo(
  p_entry_ref         text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL
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
  -- Server-side twin of TransactionLedger.tsx's toggleConfirm client
  -- check -- that check alone is bypassable via a raw RPC call (and
  -- PaymentValidation.tsx never ran it at all). A staff member cannot
  -- confirm a payment on an entry they themselves logged, unless they
  -- hold an unrestricted role (matching the client rule's own carve-out).
  IF p_confirmed AND v_entered_by IS NOT NULL AND v_entered_by = p_logged_by AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'You cannot confirm a payment you personally logged';
  END IF;

  UPDATE public.cargo_entries SET
    payment_confirmed = p_confirmed,
    confirmed_by      = CASE WHEN p_confirmed THEN COALESCE(p_logged_by, confirmed_by) ELSE NULL END,
    confirmed_at       = CASE WHEN p_confirmed THEN now() ELSE NULL END,
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code)
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_cargo(text, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_payment_package(
  p_entry_ref         text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL
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
  SELECT hub_id, entered_by INTO v_hub_id, v_entered_by FROM public.package_entries WHERE entry_ref = p_entry_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package entry % not found', p_entry_ref;
  END IF;
  IF v_hub_id IS NOT NULL AND v_hub_id <> ALL(public.sibling_hub_ids()) AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment for this entry''s hub';
  END IF;
  IF p_confirmed AND v_entered_by IS NOT NULL AND v_entered_by = p_logged_by AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'You cannot confirm a payment you personally logged';
  END IF;

  UPDATE public.package_entries SET
    payment_confirmed = p_confirmed,
    confirmed_by      = CASE WHEN p_confirmed THEN COALESCE(p_logged_by, confirmed_by) ELSE NULL END,
    confirmed_at       = CASE WHEN p_confirmed THEN now() ELSE NULL END,
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code)
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_package(text, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_payment_baggage(
  p_transaction_id    text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL
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
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code)
  WHERE transaction_id = p_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_baggage(text, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_payment_marketing(
  p_entry_ref         text,
  p_confirmed         boolean,
  p_pos_approval_code text DEFAULT NULL,
  p_logged_by         text DEFAULT NULL
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
    pos_approval_code  = COALESCE(p_pos_approval_code, pos_approval_code)
  WHERE entry_ref = p_entry_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_marketing(text, boolean, text, text) TO authenticated;

INSERT INTO public.schema_migrations (filename) VALUES ('20260902_multi_department_retrieval_and_wallet_cashout.sql')
ON CONFLICT (filename) DO NOTHING;
