-- ============================================================
-- CUSTOMER WALLETS: phone as the identity key (dedupe + enforce)
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN ''
    WHEN regexp_replace(p, '\D', '', 'g') LIKE '234%'
      THEN '0' || substr(regexp_replace(p, '\D', '', 'g'), 4)
    ELSE regexp_replace(p, '\D', '', 'g')
  END;
$$;

-- Merge wallets sharing a normalized phone: keep the oldest, fold balances +
-- totals, repoint every wallet_id FK, then delete the losers.
DO $$
DECLARE g RECORD; keeper uuid; loser uuid;
BEGIN
  FOR g IN
    SELECT public.normalize_phone(customer_phone) AS np
    FROM public.customer_wallets
    WHERE public.normalize_phone(customer_phone) <> ''
    GROUP BY 1 HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper FROM public.customer_wallets
    WHERE public.normalize_phone(customer_phone) = g.np
    ORDER BY created_at ASC, id ASC LIMIT 1;

    FOR loser IN
      SELECT id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = g.np AND id <> keeper
    LOOP
      UPDATE public.customer_wallets k SET
        balance         = k.balance         + coalesce((SELECT l.balance         FROM public.customer_wallets l WHERE l.id = loser), 0),
        total_topped_up = k.total_topped_up + coalesce((SELECT l.total_topped_up FROM public.customer_wallets l WHERE l.id = loser), 0),
        total_used      = k.total_used      + coalesce((SELECT l.total_used      FROM public.customer_wallets l WHERE l.id = loser), 0)
      WHERE k.id = keeper;

      UPDATE public.wallet_transactions SET wallet_id = keeper WHERE wallet_id = loser;
      UPDATE public.cargo_entries       SET wallet_id = keeper WHERE wallet_id = loser;
      UPDATE public.manifests           SET wallet_id = keeper WHERE wallet_id = loser;
      UPDATE public.marketing_entries   SET wallet_id = keeper WHERE wallet_id = loser;
      UPDATE public.package_entries     SET wallet_id = keeper WHERE wallet_id = loser;

      DELETE FROM public.customer_wallets WHERE id = loser;
    END LOOP;
  END LOOP;
END $$;

-- One wallet per phone going forward (phone-less wallets are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallets_phone_key
  ON public.customer_wallets (public.normalize_phone(customer_phone))
  WHERE public.normalize_phone(customer_phone) <> '';

-- Let retrieval-created wallets carry the customer's phone so they're
-- phone-keyed from birth. Re-declare process_cargo_retrieval with an added
-- p_customer_phone param (DROP first — return type/signature change).
DROP FUNCTION IF EXISTS public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.process_cargo_retrieval(
  p_entry_ref text, p_is_partial boolean, p_retrieved_value numeric,
  p_retrieved_pieces numeric, p_retrieved_kg numeric, p_customer_name text,
  p_hub_id uuid, p_logged_by text, p_wallet_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL
)
RETURNS TABLE (wallet_id uuid, new_balance numeric, wallet_refund numeric, debt_reduction numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry RECORD; v_already numeric; v_new_status text;
  v_wallet_id uuid := p_wallet_id; v_txn_result RECORD;
  v_amount_paid numeric; v_unpaid_debt numeric; v_wallet_refund numeric; v_debt_reduction numeric;
BEGIN
  IF p_retrieved_value <= 0 THEN RAISE EXCEPTION 'Retrieved value must be positive (got %)', p_retrieved_value; END IF;

  SELECT id, amount, status, retrieved_amount, hub_id, amount_paid, receipt_mode
  INTO v_entry FROM public.cargo_entries WHERE entry_ref = p_entry_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref; END IF;

  IF v_entry.hub_id IS NOT NULL AND v_entry.hub_id <> public.current_user_hub_id()
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
    retrieved_at     = now(), retrieved_by = p_logged_by,
    retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
      format('%s retrieval: %s pcs / %s kg, %s debt cleared, %s refunded to wallet',
        CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
        p_retrieved_pieces, p_retrieved_kg, v_debt_reduction, v_wallet_refund),
    status = v_new_status
  WHERE entry_ref = p_entry_ref;

  IF v_wallet_refund > 0 THEN
    -- Prefer an explicit wallet, then match by phone, then by name, else create.
    IF v_wallet_id IS NULL AND public.normalize_phone(p_customer_phone) <> '' THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE public.normalize_phone(customer_phone) = public.normalize_phone(p_customer_phone) LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name) LIMIT 1;
    END IF;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.customer_wallets (
        hub_id, customer_name, customer_phone, opening_balance, balance,
        total_topped_up, total_used, source_type, source_ref, source_note, status, created_by
      ) VALUES (
        p_hub_id, p_customer_name, NULLIF(p_customer_phone, ''), 0, 0, 0, 0,
        'airline_retrieval', p_entry_ref,
        format('Credit from %sretrieved cargo %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
        'active', p_logged_by
      ) RETURNING id INTO v_wallet_id;
    END IF;

    SELECT * INTO v_txn_result FROM public.apply_wallet_transaction(
      v_wallet_id, 'refund', v_wallet_refund, p_entry_ref, v_entry.id,
      format('Airline %sretrieval refund for %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by);
    RETURN QUERY SELECT v_wallet_id, v_txn_result.new_balance, v_wallet_refund, v_debt_reduction;
  ELSE
    RETURN QUERY SELECT v_wallet_id, 0::numeric, v_wallet_refund, v_debt_reduction;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid, text) TO authenticated;
