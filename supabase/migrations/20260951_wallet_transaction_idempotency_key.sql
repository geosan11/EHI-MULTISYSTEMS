-- =============================================================
-- apply_wallet_transaction: idempotency key
-- =============================================================
-- apply_wallet_transaction is an imperative "lock wallet row, compute new
-- balance, insert an audit row" RPC -- not an upsert on a natural key like
-- cargo_entries/manifests/marketing_entries/package_entries' writes (see
-- writeWithOfflineSupport). A network drop AFTER this RPC commits but
-- BEFORE the client sees the response, followed by any retry (automatic at
-- the network layer, or a future manual "Retry" action), would double-
-- apply the deduction/top-up with no error -- there is no client-suppliable
-- dedupe column on wallet_transactions today, and cargo_ref/cargo_entry_id
-- can't serve as one (legitimate repeat deductions against the same ref
-- happen, e.g. a partial debt-clearance payment sequence).
--
-- idempotency_key is nullable + a PARTIAL unique index (WHERE NOT NULL) so
-- every historical row and every caller that doesn't pass one (still the
-- default -- see wallet.ts) is completely unaffected. A caller that does
-- pass one gets: first call applies normally and stores the key; any later
-- call with the SAME key is a no-op that returns the original result
-- instead of re-applying.
-- =============================================================

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_key_uidx
  ON public.wallet_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Adding a new parameter is a different signature, not a like-for-like
-- CREATE OR REPLACE -- Postgres would keep the old 9-arg overload alongside
-- this new 10-arg one (both having every parameter defaulted makes a
-- named-argument RPC call from PostgREST ambiguous between them). Drop the
-- old overload explicitly first, same reasoning as the DROP FUNCTION calls
-- in 20260948_clear_debt_return_final_mode.sql.
DROP FUNCTION IF EXISTS public.apply_wallet_transaction(uuid, text, numeric, text, uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_wallet_id        uuid,
  p_type             text,
  p_amount           numeric,
  p_cargo_ref        text DEFAULT NULL,
  p_cargo_entry_id   uuid DEFAULT NULL,
  p_description      text DEFAULT NULL,
  p_logged_by        text DEFAULT NULL,
  p_department       text DEFAULT 'cargo',
  p_payment_mode     text DEFAULT NULL,
  p_idempotency_key  uuid DEFAULT NULL
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
  v_existing_id     uuid;
  v_existing_after  numeric;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, balance_after INTO v_existing_id, v_existing_after
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      -- A retry of an attempt that already landed -- return the original
      -- result instead of applying the delta a second time.
      RETURN QUERY SELECT v_existing_after, v_existing_id;
      RETURN;
    END IF;
  END IF;

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

  -- ON CONFLICT DO NOTHING closes the race between the SELECT check above
  -- and this INSERT (two concurrent calls with the same key both passing
  -- the check before either commits) -- if that happens, re-select the
  -- winner's row instead of raising, so this call still returns a valid
  -- result rather than erroring out from underneath a legitimate caller.
  INSERT INTO public.wallet_transactions (
    wallet_id, hub_id, type, amount, balance_before, balance_after,
    cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id,
    department, status, payment_mode, idempotency_key
  ) VALUES (
    p_wallet_id, v_wallet_hub, p_type, p_amount, v_balance_before, v_balance_after,
    p_cargo_ref, p_cargo_entry_id, p_description, COALESCE(p_logged_by, 'system'), auth.uid(),
    p_department, 'completed', p_payment_mode, p_idempotency_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_txn_id;

  IF v_txn_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id, balance_after INTO v_txn_id, v_balance_after
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN QUERY SELECT v_balance_after, v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, uuid, text, text, text, text, uuid) TO authenticated;
