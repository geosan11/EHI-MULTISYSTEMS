-- find_or_create_customer_wallet() (last defined in
-- 20260919_fix_advisory_lock_hashtextextended.sql) matched an existing
-- wallet by customer_name alone, ignoring customer_phone entirely -- and if
-- a name match was found, unconditionally overwrote its stored phone with
-- whatever was just typed. Every process_*_retrieval RPC in this codebase
-- (same file) matches phone-first, falling back to name-only when phone is
-- blank, specifically to avoid merging two different customers who happen
-- to share a name. This function was the one wallet-touching RPC that never
-- got that parity fix: two same-named customers with different phone
-- numbers could have a manual Top-Up (the only caller of this RPC, see
-- CustomerWallets.tsx) merge them into one wallet, or silently stomp one
-- customer's phone with the other's.
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

  PERFORM pg_advisory_xact_lock(hashtext(
    'wallet:' || COALESCE(NULLIF(public.normalize_phone(p_customer_phone), ''), 'name:' || lower(trim(p_customer_name)))
  )::bigint);

  -- Phone-first, name-as-fallback-when-phone-blank -- matches every
  -- process_*_retrieval RPC's matching order so a customer identified by
  -- phone in one flow can't be split from (or merged into the wrong
  -- customer via) the same person's wallet in this flow.
  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_wallet_id FROM public.customer_wallets
    WHERE public.normalize_phone(customer_phone) = public.normalize_phone(v_phone)
    LIMIT 1;
  ELSE
    SELECT id INTO v_wallet_id FROM public.customer_wallets
    WHERE lower(customer_name) = lower(trim(p_customer_name))
      AND public.normalize_phone(customer_phone) = ''
    LIMIT 1;
  END IF;

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
    -- Reached only via the blank-phone name-match branch above (a
    -- phone-matched wallet already has this exact phone, so this is a
    -- no-op there) -- legitimate first-time phone capture for a wallet
    -- that had none on file yet, never an overwrite of a different
    -- customer's phone.
    UPDATE public.customer_wallets SET customer_phone = v_phone, updated_at = now()
    WHERE id = v_wallet_id AND customer_phone IS DISTINCT FROM v_phone;
  END IF;

  RETURN QUERY SELECT v_wallet_id, v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_customer_wallet(uuid, text, text, text, text, text, text, numeric) TO authenticated;
