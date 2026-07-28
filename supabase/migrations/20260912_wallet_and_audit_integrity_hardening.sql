-- =============================================================
-- Wallet integrity + audit-trail impersonation hardening
-- (Real authoring date: 2026-07-28. Filename prefixed 2026091x per
-- docs/MIGRATION_POLICY.md so it sorts after every migration already
-- applied to the live database.)
-- =============================================================
-- Found during a 4-pass audit specifically requested on the wallet system
-- and on "who made certain changes" traceability across the ledger/database.
-- Four separate, confirmed gaps:
--
--   a) customer_wallets' UPDATE policy (20260810_wallet_atomicity_and_
--      isolation.sql) has a USING clause but no WITH CHECK. Nothing stops
--      a same-hub authenticated client from reassigning a wallet's hub_id
--      to a different hub via a plain .update() call, entirely outside
--      apply_wallet_transaction. Frontend code never does this today
--      (verified: CustomerWallets.tsx's only two direct .update() calls
--      touch archived_at and customer_phone) but the database itself
--      doesn't enforce it, which is the actual security boundary.
--
--   b) apply_wallet_transaction() records who performed a top-up/deduction/
--      refund/adjustment in `logged_by`, a plain client-supplied display
--      name with no server-verified identity behind it -- unlike the
--      cash-payout maker-checker flow (20260902/20260907), which correctly
--      captures requested_by_user_id/approved_by_user_id via auth.uid().
--      Every regular wallet transaction -- the majority of wallet activity
--      -- has never had this same protection.
--
--   c) process_cargo_retrieval()'s wallet-matching fallback (20260826_
--      wallet_phone_identity.sql) matches an existing wallet by
--      lower(customer_name) = lower(p_customer_name) alone, with no
--      requirement that a provided phone number failed to match first, and
--      no check that the candidate wallet itself has no phone on file.
--      Two different customers who share a common name can have a
--      retrieval refund silently routed into the wrong person's wallet.
--
--   d) audit_log's INSERT policy (20260708_hub_isolation_rls.sql) checks
--      hub_id but never verifies user_id = auth.uid(). Any authenticated
--      staff member can insert an audit_log row claiming to be a DIFFERENT
--      user_id/user_name for any action, as long as the hub matches --
--      the one system whose entire purpose is "who did what" can itself
--      be forged by anyone with API access.
--
-- NOT addressed here (documented, deliberately deferred): cargo_entries/
-- manifests/marketing_entries/package_entries' UPDATE policies have the
-- exact same missing-WITH-CHECK gap as (a), confirmed during this same
-- audit. Fixing those safely requires verifying every direct .update()
-- call site across CargoForm.tsx/ExcessBaggageForm.tsx/MarketingWorkspace.
-- tsx/PackageForm.tsx/TransactionLedger.tsx first (a much larger surface
-- than the two call sites checked for customer_wallets) -- flagged as a
-- follow-up audit rather than risking an under-verified change to the
-- core revenue tables.
--
-- CORRECTED before this file was ever applied: (c)'s first draft based
-- process_cargo_retrieval's body on 20260826_wallet_phone_identity.sql,
-- which was superseded by 20260902_multi_department_retrieval_and_wallet_
-- cashout.sql. Re-diffing against that actual latest version caught 3
-- differences the stale base would have silently reverted: the hub
-- authorization check (sibling_hub_ids() vs a stricter current_user_
-- hub_id()), apply_wallet_transaction's department argument, and the
-- no-refund branch's return value (real current balance vs a hardcoded 0).
-- The version below is re-verified against 20260902 with only the
-- intended wallet-matching fix layered on top.
-- =============================================================

-- ─── a. customer_wallets UPDATE: lock hub_id against reassignment ──────
DROP POLICY IF EXISTS "Hub-scoped update customer_wallets" ON public.customer_wallets;
CREATE POLICY "Hub-scoped update customer_wallets" ON public.customer_wallets FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted())
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- ─── b. wallet_transactions: real identity behind every transaction type ──
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS logged_by_user_id uuid;

-- Same 8-param signature as 20260903_security_and_bugfix_pass.sql's
-- redefine -- safe CREATE OR REPLACE, no DROP needed.
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

  -- logged_by stays a convenience display name (may still drift from the
  -- real caller if the client's cached user.name is stale); logged_by_user_id
  -- is the tamper-proof anchor -- auth.uid() cannot be spoofed by the caller,
  -- unlike a plain text parameter. Matches the pattern already used
  -- correctly for requested_by_user_id/approved_by_user_id on the
  -- cash-payout maker-checker flow.
  INSERT INTO public.wallet_transactions (
    wallet_id, hub_id, type, amount, balance_before, balance_after,
    cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id, department, status
  ) VALUES (
    p_wallet_id, v_wallet_hub, p_type, p_amount, v_balance_before, v_balance_after,
    p_cargo_ref, p_cargo_entry_id, p_description, COALESCE(p_logged_by, 'system'), auth.uid(),
    p_department, 'completed'
  ) RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_balance_after, v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, uuid, text, text, text) TO authenticated;

-- ─── c. process_cargo_retrieval: stop matching wallets by name alone ────
-- CORRECTED: the first draft of this fix was based on 20260826_wallet_
-- phone_identity.sql's body, which was superseded by 20260902_multi_
-- department_retrieval_and_wallet_cashout.sql (sibling_hub_ids() instead of
-- a strict current_user_hub_id() match, apply_wallet_transaction called
-- with the 'cargo' department argument, and the no-refund branch returning
-- the wallet's real current balance instead of a hardcoded 0). Re-verified
-- against that actual latest version before writing this -- using the
-- older body here would have silently reverted all three of those already-
-- shipped fixes. Same 10-param signature -- safe CREATE OR REPLACE, no
-- DROP needed.
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

  -- sibling_hub_ids(), not a strict current_user_hub_id() match (20260902's
  -- own fix, kept as-is here): an agent who can SEE this entry via
  -- sibling-hub visibility must also be able to act on it.
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
    -- Prefer an explicit wallet, then match by phone, then by name (name
    -- match narrowed below), else create.
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    -- FIXED: only fall back to name-only matching when NO phone was given
    -- for this retrieval at all, AND only against a candidate wallet that
    -- ALSO has no phone on file. Previously matched by name whenever a
    -- phone-based match failed to find a row -- including when a phone WAS
    -- provided but simply didn't match any wallet (a genuinely different or
    -- not-yet-phone-linked customer), and against ANY same-named wallet
    -- regardless of whether it already belonged to a different, phone-
    -- verified person. Two customers sharing a common name could have a
    -- refund silently routed into the wrong one's wallet.
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

-- ─── d. audit_log INSERT: stop allowing impersonation of another user ──
DROP POLICY IF EXISTS "Hub-scoped insert audit_log" ON public.audit_log;
CREATE POLICY "Hub-scoped insert audit_log" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (
    (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted())
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

INSERT INTO public.schema_migrations (filename) VALUES ('20260912_wallet_and_audit_integrity_hardening.sql')
ON CONFLICT (filename) DO NOTHING;
