-- =============================================================
-- Debug pass (financial logic audit, 2026-07-28): two confirmed
-- money-integrity bugs in the retrieval/wallet RPCs.
--
--   a) unretrieve_cargo_entry/unretrieve_package_entry/unretrieve_
--      baggage_entry/unretrieve_marketing_entry (20260902_multi_
--      department_retrieval_and_wallet_cashout.sql) reset
--      retrieved_amount back to 0 without reversing the wallet_refund
--      that was paid out during the original retrieval. Since the
--      double-credit guard in every process_*_retrieval is
--      "v_already + p_retrieved_value > v_entry.amount", resetting
--      v_already back to 0 lets the exact same entry be retrieved (and
--      credited) a second time -- money created from nothing.
--      FIXED here: each unretrieve_*_entry now looks up the net wallet
--      credit still outstanding from this entry's retrieval(s) (derived
--      from wallet_transactions itself -- the ledger is the source of
--      truth, not a new counter column) and claws it back via a
--      'deduction' through the existing apply_wallet_transaction() before
--      resetting the entry. apply_wallet_transaction's own balance guard
--      ("Insufficient wallet balance: has %, needs %") already raises a
--      clear, actionable error and rolls back the whole reversal (entry
--      included) if the customer already spent the mistaken credit
--      elsewhere -- reused as-is rather than duplicating that check here.
--      Return type changes from a bare numeric to a two-column table
--      (reversed_amount, wallet_reversed) so the UI can show what
--      actually happened; requires DROP FUNCTION first (Postgres
--      disallows changing an existing function's return type via
--      CREATE OR REPLACE).
--
--   b) 20260912_wallet_and_audit_integrity_hardening.sql fixed
--      process_cargo_retrieval's wallet-matching fallback (it now only
--      falls back to name-only matching when NO phone was supplied at
--      all, and only against a candidate wallet that ALSO has no phone
--      on file) but left process_package_retrieval/process_baggage_
--      retrieval/process_marketing_retrieval on the original unconditional
--      "lower(customer_name) = lower(p_customer_name) LIMIT 1" fallback --
--      confirmed unchanged by reading the current migration set. Two
--      different customers sharing a name can have a refund silently
--      routed into the wrong person's wallet via any of these 3 siblings.
--      FIXED here: identical phone-first / name-only-when-no-phone-and-
--      candidate-has-no-phone logic applied to all three, re-verified
--      line-by-line against their current (20260902) bodies first so
--      nothing else in them regresses -- same 10-param signature in each
--      case, so CREATE OR REPLACE is safe, no DROP needed (matching how
--      20260912 patched process_cargo_retrieval).
-- =============================================================

-- ─── a. process_package_retrieval: stop matching wallets by name alone ──
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
    -- Prefer an explicit wallet, then match by phone, then by name (name
    -- match narrowed below), else create.
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone)
      LIMIT 1;
    END IF;
    -- FIXED: only fall back to name-only matching when NO phone was given
    -- for this retrieval at all, AND only against a candidate wallet that
    -- ALSO has no phone on file -- see process_cargo_retrieval's identical
    -- fix (20260912_wallet_and_audit_integrity_hardening.sql) for the full
    -- rationale on why the unconditional name-only fallback was unsafe.
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

-- ─── b. process_baggage_retrieval: stop matching wallets by name alone ──
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

-- ─── c. process_marketing_retrieval: stop matching wallets by name alone ──
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

-- ─── d. unretrieve_*_entry: auto-reverse the wallet credit, don't just
--        reopen the double-credit hole ────────────────────────────────
-- Return type changes (numeric -> two-column table), so DROP first.
DROP FUNCTION IF EXISTS public.unretrieve_cargo_entry(text, text);
DROP FUNCTION IF EXISTS public.unretrieve_package_entry(text, text);
DROP FUNCTION IF EXISTS public.unretrieve_baggage_entry(text, text);
DROP FUNCTION IF EXISTS public.unretrieve_marketing_entry(text, text);

CREATE OR REPLACE FUNCTION public.unretrieve_cargo_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS TABLE (reversed_amount numeric, wallet_reversed numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_wallet_id uuid;
  v_wallet_credited numeric := 0;
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

  -- Find the wallet this entry's retrieval(s) actually credited (if any --
  -- an entry fully absorbed by debt_reduction never creates a wallet_
  -- transactions row at all, which is fine, nothing to reverse then).
  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type = 'refund' AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    -- Net credit still outstanding from this entry's retrieval(s): refunds
    -- minus any prior reversal deductions, both scoped to cargo_entry_id (a
    -- uuid FK only ever populated by process_cargo_retrieval's refund and
    -- this function's own reversal below -- ordinary wallet-payment
    -- deductions for this same entry only ever set the text cargo_ref, not
    -- cargo_entry_id, so they can't be swept into this sum).
    SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'deduction') AND status = 'completed';

    IF v_wallet_credited > 0 THEN
      -- apply_wallet_transaction's own guard raises 'Insufficient wallet
      -- balance: has %, needs %' (and rolls back this whole function, entry
      -- reset included) if the customer already spent the mistaken credit
      -- elsewhere -- a loud, actionable error instead of silently reopening
      -- the double-credit hole.
      PERFORM public.apply_wallet_transaction(
        v_wallet_id, 'deduction', v_wallet_credited, p_entry_ref, v_entry.id,
        format('Retrieval reversal for %s', p_entry_ref),
        p_logged_by, 'cargo'
      );
    END IF;
  END IF;

  UPDATE public.cargo_entries SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s%s)',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount,
                          CASE WHEN v_wallet_credited > 0 THEN format(', %s wallet credit clawed back', v_wallet_credited) ELSE '' END)
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_entry.retrieved_amount, GREATEST(v_wallet_credited, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_cargo_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_package_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS TABLE (reversed_amount numeric, wallet_reversed numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_wallet_id uuid;
  v_wallet_credited numeric := 0;
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

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type = 'refund' AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'deduction') AND status = 'completed';

    IF v_wallet_credited > 0 THEN
      PERFORM public.apply_wallet_transaction(
        v_wallet_id, 'deduction', v_wallet_credited, p_entry_ref, v_entry.id,
        format('Retrieval reversal for %s', p_entry_ref),
        p_logged_by, 'package'
      );
    END IF;
  END IF;

  UPDATE public.package_entries SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s%s)',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount,
                          CASE WHEN v_wallet_credited > 0 THEN format(', %s wallet credit clawed back', v_wallet_credited) ELSE '' END)
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_entry.retrieved_amount, GREATEST(v_wallet_credited, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_package_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_baggage_entry(
  p_transaction_id text,
  p_logged_by text
)
RETURNS TABLE (reversed_amount numeric, wallet_reversed numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_wallet_id uuid;
  v_wallet_credited numeric := 0;
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

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type = 'refund' AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'deduction') AND status = 'completed';

    IF v_wallet_credited > 0 THEN
      PERFORM public.apply_wallet_transaction(
        v_wallet_id, 'deduction', v_wallet_credited, p_transaction_id, v_entry.id,
        format('Retrieval reversal for %s', p_transaction_id),
        p_logged_by, 'baggage'
      );
    END IF;
  END IF;

  UPDATE public.manifests SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s pcs / %s kg / %s%s)',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_kg, v_entry.retrieved_amount,
                          CASE WHEN v_wallet_credited > 0 THEN format(', %s wallet credit clawed back', v_wallet_credited) ELSE '' END)
  WHERE transaction_id = p_transaction_id;

  RETURN QUERY SELECT v_entry.retrieved_amount, GREATEST(v_wallet_credited, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_baggage_entry(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unretrieve_marketing_entry(
  p_entry_ref text,
  p_logged_by text
)
RETURNS TABLE (reversed_amount numeric, wallet_reversed numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_wallet_id uuid;
  v_wallet_credited numeric := 0;
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

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type = 'refund' AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'deduction') AND status = 'completed';

    IF v_wallet_credited > 0 THEN
      PERFORM public.apply_wallet_transaction(
        v_wallet_id, 'deduction', v_wallet_credited, p_entry_ref, v_entry.id,
        format('Retrieval reversal for %s', p_entry_ref),
        p_logged_by, 'marketing'
      );
    END IF;
  END IF;

  UPDATE public.marketing_entries SET
    retrieved_pieces = 0,
    retrieved_kg     = 0,
    retrieved_amount = 0,
    retrieved        = false,
    status           = 'Intake',
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                        format('Retrieval reversed by %s (was %s / %s%s)',
                          p_logged_by, v_entry.retrieved_pieces, v_entry.retrieved_amount,
                          CASE WHEN v_wallet_credited > 0 THEN format(', %s wallet credit clawed back', v_wallet_credited) ELSE '' END)
  WHERE entry_ref = p_entry_ref;

  RETURN QUERY SELECT v_entry.retrieved_amount, GREATEST(v_wallet_credited, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unretrieve_marketing_entry(text, text) TO authenticated;
