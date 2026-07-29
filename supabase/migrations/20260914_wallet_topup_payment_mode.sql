-- =============================================================
-- Debug pass (financial logic audit, 2026-07-28): wallet top-ups had no
-- payment-mode field at all -- a top-up only ever produced an
-- apply_wallet_transaction('top_up', ...) row, with nothing recording
-- whether the money was collected as Cash, Transfer, or POS. That made a
-- real cash top-up invisible to EODReconciliation.tsx's expected-cash math:
-- on any shift with a genuine cash top-up, physical cash-in-till exceeded
-- the system's "expected" cash with no line item explaining why, so a
-- legitimate top-up and a real shortfall looked identical in the numbers.
--
-- FIXED here: an explicit payment_mode column (meaningful for 'top_up'
-- only; NULL for every other transaction type) plus the matching
-- apply_wallet_transaction parameter to set it. Purely additive -- new
-- trailing optional parameter with a DEFAULT, same pattern already used to
-- add p_department earlier in this function's history, so CREATE OR
-- REPLACE is safe without a DROP.
-- =============================================================

ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS payment_mode text;
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_payment_mode_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_payment_mode_check
  CHECK (payment_mode IS NULL OR payment_mode IN ('Cash', 'Transfer', 'POS'));

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
    cargo_ref, cargo_entry_id, description, logged_by, logged_by_user_id, department, status, payment_mode
  ) VALUES (
    p_wallet_id, v_wallet_hub, p_type, p_amount, v_balance_before, v_balance_after,
    p_cargo_ref, p_cargo_entry_id, p_description, COALESCE(p_logged_by, 'system'), auth.uid(),
    p_department, 'completed', p_payment_mode
  ) RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_balance_after, v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, uuid, text, text, text, text) TO authenticated;
