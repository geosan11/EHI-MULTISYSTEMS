-- =============================================================
-- Fix: retrieval and wallet top-up broke completely right after
-- 20260917_phoneless_wallet_dedupe_race.sql was applied.
--
-- That migration added, to all 5 of process_cargo_retrieval/
-- process_package_retrieval/process_baggage_retrieval/
-- process_marketing_retrieval/find_or_create_customer_wallet, an
-- unconditional call to:
--   pg_advisory_xact_lock(hashtextextended(<key text>, 0))
-- hashtextextended(text, bigint) is a real Postgres catalog function on
-- recent Postgres versions, but its presence/behavior on this specific
-- Supabase Postgres instance was never actually verified against the live
-- database (no way to do so from this environment). Since this call runs
-- on essentially every retrieval that credits a wallet and on every
-- single wallet top-up, if it errors, both break completely and
-- immediately -- which matches exactly what was reported.
--
-- Fix: replace hashtextextended(key, 0) with hashtext(key)::bigint in all
-- 5 functions. hashtext(text) RETURNS integer is a long-standing,
-- universally-available Postgres builtin with no version/edition
-- uncertainty; ::bigint is a safe, always-valid widening cast. The actual
-- hash VALUE differs from hashtextextended's, which doesn't matter --
-- advisory lock keys only need to be consistent per identity within a
-- single call, not any particular value, and locks are transaction-
-- scoped so there's no stored/compared state across the change.
--
-- All 5 signatures are unchanged, so CREATE OR REPLACE is safe here too.
-- =============================================================

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
    IF v_wallet_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(
        'wallet:' || COALESCE(NULLIF(public.normalize_phone(p_customer_phone), ''), 'name:' || lower(trim(p_customer_name)) || ':' || COALESCE(p_hub_id::text, ''))
      )::bigint);
    END IF;

    -- Prefer an explicit wallet, then match by phone, then by name (name
    -- match narrowed below), else create.
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

CREATE OR REPLACE FUNCTION public.find_or_create_customer_wallet(
  p_hub_id uuid,
  p_customer_name text,
  p_customer_phone text DEFAULT NULL,
  p_created_by text DEFAULT NULL,
  p_source_type text DEFAULT 'advance_deposit',
  p_source_ref text DEFAULT NULL,
  p_source_note text DEFAULT NULL,
  p_opening_balance numeric DEFAULT 0
)
RETURNS TABLE (wallet_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id uuid;
  v_created boolean := false;
  v_phone text := NULLIF(trim(p_customer_phone), '');
BEGIN
  IF trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wallet:name:' || lower(trim(p_customer_name)))::bigint);

  SELECT id INTO v_wallet_id FROM public.customer_wallets
  WHERE lower(customer_name) = lower(trim(p_customer_name))
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    INSERT INTO public.customer_wallets (
      hub_id, customer_name, customer_phone, opening_balance, balance,
      total_topped_up, total_used, source_type, source_ref, source_note,
      status, created_by
    ) VALUES (
      p_hub_id, trim(p_customer_name), v_phone, p_opening_balance, 0,
      0, 0, p_source_type, p_source_ref, p_source_note,
      'active', COALESCE(p_created_by, 'system')
    ) RETURNING id INTO v_wallet_id;
    v_created := true;
  ELSIF v_phone IS NOT NULL THEN
    UPDATE public.customer_wallets SET customer_phone = v_phone, updated_at = now()
    WHERE id = v_wallet_id AND customer_phone IS DISTINCT FROM v_phone;
  END IF;

  RETURN QUERY SELECT v_wallet_id, v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_customer_wallet(uuid, text, text, text, text, text, text, numeric) TO authenticated;
