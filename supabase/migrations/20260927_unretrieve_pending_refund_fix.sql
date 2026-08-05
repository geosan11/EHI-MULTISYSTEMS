-- =============================================================
-- CRITICAL FIX: unretrieve_*_entry() never learned about 'retrieval_refund'
-- =============================================================
-- 20260925_top_up_and_retrieval_refund_approval.sql changed process_*_
-- retrieval() to write the wallet-credit side as a wallet_transactions row
-- with type='retrieval_refund' (started 'pending', flipped to 'completed'
-- in place by approve_retrieval_refund) instead of type='refund'
-- (immediately 'completed', via apply_wallet_transaction). Nothing updated
-- unretrieve_cargo_entry/_package_/_baggage_/_marketing_entry
-- (20260913_retrieval_reversal_and_wallet_matching_parity.sql), which still
-- look ONLY for type='refund' when finding the credit to claw back.
--
-- Net effect before this fix: retrieve -> refund approved (wallet credited)
-- -> undo retrieval -> the lookup finds nothing (wrong type string) -> the
-- entry resets to un-retrieved with the wallet credit left in place --
-- silently reopening the exact double-credit hole 20260913 was written to
-- close. A second, related gap: undoing a retrieval whose refund is still
-- PENDING (not yet approved) left that pending row orphaned, so an
-- accountant could later approve a refund for a retrieval that no longer
-- exists, creating a credit with nothing behind it.
--
-- Same fix applied identically to all 4 department functions.
-- =============================================================

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

  -- Cancel any still-pending refund request for this entry BEFORE it can
  -- be approved for a retrieval that's about to no longer exist.
  UPDATE public.wallet_transactions
  SET status = 'rejected',
      rejection_reason = 'Retrieval reversed before refund was approved',
      approved_by = p_logged_by,
      approved_at = now()
  WHERE cargo_entry_id = v_entry.id AND type = 'retrieval_refund' AND status = 'pending';

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type IN ('refund', 'retrieval_refund') AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type IN ('refund', 'retrieval_refund') THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'retrieval_refund', 'deduction') AND status = 'completed';

    IF v_wallet_credited > 0 THEN
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

  UPDATE public.wallet_transactions
  SET status = 'rejected',
      rejection_reason = 'Retrieval reversed before refund was approved',
      approved_by = p_logged_by,
      approved_at = now()
  WHERE cargo_entry_id = v_entry.id AND type = 'retrieval_refund' AND status = 'pending';

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type IN ('refund', 'retrieval_refund') AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type IN ('refund', 'retrieval_refund') THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'retrieval_refund', 'deduction') AND status = 'completed';

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

  UPDATE public.wallet_transactions
  SET status = 'rejected',
      rejection_reason = 'Retrieval reversed before refund was approved',
      approved_by = p_logged_by,
      approved_at = now()
  WHERE cargo_entry_id = v_entry.id AND type = 'retrieval_refund' AND status = 'pending';

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type IN ('refund', 'retrieval_refund') AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type IN ('refund', 'retrieval_refund') THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'retrieval_refund', 'deduction') AND status = 'completed';

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

  UPDATE public.wallet_transactions
  SET status = 'rejected',
      rejection_reason = 'Retrieval reversed before refund was approved',
      approved_by = p_logged_by,
      approved_at = now()
  WHERE cargo_entry_id = v_entry.id AND type = 'retrieval_refund' AND status = 'pending';

  SELECT wallet_id INTO v_wallet_id
  FROM public.wallet_transactions
  WHERE cargo_entry_id = v_entry.id AND type IN ('refund', 'retrieval_refund') AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;

  IF v_wallet_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN type IN ('refund', 'retrieval_refund') THEN amount ELSE -amount END), 0)
    INTO v_wallet_credited
    FROM public.wallet_transactions
    WHERE cargo_entry_id = v_entry.id AND wallet_id = v_wallet_id
      AND type IN ('refund', 'retrieval_refund', 'deduction') AND status = 'completed';

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
