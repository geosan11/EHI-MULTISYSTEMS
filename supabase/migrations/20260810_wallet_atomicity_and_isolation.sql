  -- =============================================================
  -- Wallet atomicity, hub isolation, and retrieval double-credit fix
  -- =============================================================
  -- customer_wallets/wallet_transactions were created (20260717,
  -- 20260802) after the rest of the app's financial tables had already
  -- been locked down to hub-scoped RLS (20260708_hub_isolation_rls.sql)
  -- and after the atomic increment_corporate_debt() pattern
  -- (20260719_atomic_corporate_debt.sql) was established to close
  -- exactly this class of bug -- but neither fix was ever ported to
  -- wallets. Every wallet write in the app (CargoForm, ExcessBaggageForm,
  -- MarketingWorkspace, PackageForm, CustomerWallets, TransactionLedger,
  -- FraudAlerts) reads customer_wallets.balance client-side, computes
  -- balance +/- amount in JS, and writes back the absolute value -- a
  -- classic read-modify-write race (two concurrent deductions/credits
  -- for the same wallet can silently clobber each other), with no
  -- server-side floor at zero and no hub scoping (any hub's staff can
  -- read/write any other hub's customer wallets).
  --
  -- This migration:
  --   1. Adds apply_wallet_transaction(), mirroring increment_corporate_
  --      debt()'s single-atomic-UPDATE pattern, but also inserting the
  --      wallet_transactions audit row in the SAME function call so the
  --      balance and its audit trail can never drift apart from a
  --      failure between two separate network round-trips.
  --   2. Adds retrieved_pieces/retrieved_kg/retrieved_amount to
  --      cargo_entries and process_cargo_retrieval(), which locks the
  --      cargo entry row and rejects a refund that would push cumulative
  --      retrieved_amount past the entry's original amount -- closing
  --      the double-credit hole where a double-click, retry, or a
  --      partial retrieval followed later by a full retrieval on the
  --      same entry could each refund the full amount independently.
  --   3. Adds a balance >= 0 check constraint (defense in depth below
  --      the RPC's own check).
  --   4. Replaces customer_wallets/wallet_transactions' USING (true)
  --      policies with the same hub-scoped pattern every other
  --      financial table already uses.
  -- =============================================================

  -- ─── 1. ATOMIC WALLET BALANCE + AUDIT TRAIL ───────────────────
  -- p_type: 'top_up' | 'deduction' | 'refund' | 'adjustment' (matches
  -- wallet_transactions' own CHECK constraint). p_amount is always
  -- positive; the sign is applied here based on p_type. Row-locked via
  -- FOR UPDATE so concurrent calls against the same wallet serialize
  -- instead of racing, same as next_awb_number()/increment_corporate_
  -- debt(). SECURITY DEFINER bypasses RLS, so the hub check below is
  -- explicit, matching increment_corporate_debt()'s own comment on why.
  CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
    p_wallet_id       uuid,
    p_type            text,
    p_amount          numeric,
    p_cargo_ref       text DEFAULT NULL,
    p_cargo_entry_id  uuid DEFAULT NULL,
    p_description     text DEFAULT NULL,
    p_logged_by       text DEFAULT NULL
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
      cargo_ref, cargo_entry_id, description, logged_by
    ) VALUES (
      p_wallet_id, v_wallet_hub, p_type, p_amount, v_balance_before, v_balance_after,
      p_cargo_ref, p_cargo_entry_id, p_description, COALESCE(p_logged_by, 'system')
    ) RETURNING id INTO v_txn_id;

    RETURN QUERY SELECT v_balance_after, v_txn_id;
  END;
  $$;

  GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, uuid, text, text) TO authenticated;

  -- ─── 2. CUMULATIVE RETRIEVAL TRACKING ─────────────────────────
  -- cargo_entries.retrieved was always a single boolean -- nothing
  -- tracked how much of an entry's pieces/kg/amount had already been
  -- refunded, so a partial retrieval followed later by a "full"
  -- retrieval (or two independent partial retrievals) on the same
  -- entry could each credit a wallet again for goods already refunded.
  ALTER TABLE public.cargo_entries
    ADD COLUMN IF NOT EXISTS retrieved_pieces  numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS retrieved_kg      numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS retrieved_amount  numeric(12,2) NOT NULL DEFAULT 0;

  -- Processes a full or partial cargo retrieval atomically: locks the
  -- cargo entry, rejects a refund that would push cumulative
  -- retrieved_amount past the entry's original amount, updates the
  -- retrieval-tracking columns, finds-or-creates the customer's wallet,
  -- and credits it via apply_wallet_transaction -- all in one
  -- transaction, so a failure partway through can't leave the entry
  -- marked retrieved without the wallet credited, or vice versa.
  --
  -- DROP first: this bundle can be re-run against a database that was
  -- previously brought fully up to date (including
  -- 20260815_fix_retrieval_debt_logic.sql's later redefinition of this
  -- same function, which returns a different, 4-column TABLE shape). If
  -- that newer shape is already live, this CREATE OR REPLACE -- which
  -- declares the original 2-column shape -- hits Postgres's "cannot
  -- change return type of existing function" error just as surely as the
  -- reverse direction does. Unconditionally dropping and recreating here
  -- is safe either way: 20260815 immediately replaces this definition
  -- again later in the same run.
  DROP FUNCTION IF EXISTS public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid);

  CREATE OR REPLACE FUNCTION public.process_cargo_retrieval(
    p_entry_ref         text,
    p_is_partial        boolean,
    p_refund_amount     numeric,
    p_retrieved_pieces  numeric,
    p_retrieved_kg      numeric,
    p_customer_name     text,
    p_hub_id            uuid,
    p_logged_by         text,
    p_wallet_id         uuid DEFAULT NULL
  )
  RETURNS TABLE(out_wallet_id uuid, new_balance numeric)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_entry           RECORD;
    v_wallet_id       uuid := p_wallet_id;
    v_already         numeric;
    v_new_status      text;
    v_txn_result      RECORD;
  BEGIN
    IF p_refund_amount <= 0 THEN
      RAISE EXCEPTION 'Refund amount must be positive (got %)', p_refund_amount;
    END IF;

    SELECT id, hub_id, amount, retrieved_amount, status
    INTO v_entry
    FROM public.cargo_entries
    WHERE entry_ref = p_entry_ref
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cargo entry % not found', p_entry_ref;
    END IF;

    IF v_entry.hub_id IS NOT NULL
      AND v_entry.hub_id <> public.current_user_hub_id()
      AND NOT public.is_hub_unrestricted() THEN
      RAISE EXCEPTION 'Not authorized to process a retrieval for this entry''s hub';
    END IF;

    v_already := COALESCE(v_entry.retrieved_amount, 0);
    IF v_already + p_refund_amount > v_entry.amount THEN
      RAISE EXCEPTION 'Refund of % would exceed remaining retrievable amount (already retrieved % of %)',
        p_refund_amount, v_already, v_entry.amount;
    END IF;

    v_new_status := CASE WHEN v_already + p_refund_amount >= v_entry.amount THEN 'Retrieved' ELSE v_entry.status END;

    UPDATE public.cargo_entries SET
      retrieved_pieces = COALESCE(retrieved_pieces, 0) + p_retrieved_pieces,
      retrieved_kg     = COALESCE(retrieved_kg, 0) + p_retrieved_kg,
      retrieved_amount = v_already + p_refund_amount,
      retrieved        = (v_already + p_refund_amount >= v_entry.amount),
      retrieved_at     = now(),
      retrieved_by     = p_logged_by,
      retrieval_note   = COALESCE(retrieval_note || E'\n', '') ||
                          format('%s retrieval: %s pcs / %s kg, %s refunded to wallet',
                            CASE WHEN p_is_partial THEN 'Partial' ELSE 'Full' END,
                            p_retrieved_pieces, p_retrieved_kg, p_refund_amount),
      status           = v_new_status
    WHERE entry_ref = p_entry_ref;

    IF v_wallet_id IS NULL THEN
      SELECT id INTO v_wallet_id FROM public.customer_wallets
      WHERE lower(customer_name) = lower(p_customer_name)
      LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
      INSERT INTO public.customer_wallets (
        hub_id, customer_name, opening_balance, balance,
        total_topped_up, total_used, source_type, source_ref, source_note,
        status, created_by
      ) VALUES (
        p_hub_id, p_customer_name, 0, 0,
        0, 0, 'airline_retrieval', p_entry_ref,
        format('Credit from %sretrieved cargo %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
        'active', p_logged_by
      ) RETURNING id INTO v_wallet_id;
    END IF;

    SELECT * INTO v_txn_result FROM public.apply_wallet_transaction(
      v_wallet_id, 'refund', p_refund_amount, p_entry_ref, v_entry.id,
      format('Airline %sretrieval refund for %s', CASE WHEN p_is_partial THEN 'partial ' ELSE '' END, p_entry_ref),
      p_logged_by
    );

    RETURN QUERY SELECT v_wallet_id, v_txn_result.new_balance;
  END;
  $$;

  GRANT EXECUTE ON FUNCTION public.process_cargo_retrieval(text, boolean, numeric, numeric, numeric, text, uuid, text, uuid) TO authenticated;

  -- ─── 3. DB-LEVEL FLOOR AT ZERO (defense in depth) ─────────────
  -- apply_wallet_transaction() already rejects a deduction that would
  -- go negative, but nothing stopped a direct client UPDATE (bypassing
  -- the RPC entirely) from setting balance to any value.
  ALTER TABLE public.customer_wallets DROP CONSTRAINT IF EXISTS customer_wallets_balance_nonneg;
  ALTER TABLE public.customer_wallets ADD CONSTRAINT customer_wallets_balance_nonneg CHECK (balance >= 0);

  -- ─── 4. HUB-SCOPED RLS ─────────────────────────────────────────
  -- Matches the pattern every other financial table uses
  -- (20260708_hub_isolation_rls.sql) -- direct UPDATE access is kept
  -- (same as corporate_clients, 20260716_security_hardening.sql) since
  -- app code outside the RPC still needs to read/write same-hub wallet
  -- rows; SECURITY DEFINER functions above bypass RLS and re-check hub
  -- scoping themselves.
  DROP POLICY IF EXISTS "Allow full access to customer_wallets"   ON public.customer_wallets;
  DROP POLICY IF EXISTS "Allow public access to customer_wallets" ON public.customer_wallets;
  DROP POLICY IF EXISTS "Hub-scoped read customer_wallets" ON public.customer_wallets;
  CREATE POLICY "Hub-scoped read customer_wallets"   ON public.customer_wallets FOR SELECT TO authenticated
    USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
  DROP POLICY IF EXISTS "Hub-scoped insert customer_wallets" ON public.customer_wallets;
  CREATE POLICY "Hub-scoped insert customer_wallets" ON public.customer_wallets FOR INSERT TO authenticated
    WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
  DROP POLICY IF EXISTS "Hub-scoped update customer_wallets" ON public.customer_wallets;
  CREATE POLICY "Hub-scoped update customer_wallets" ON public.customer_wallets FOR UPDATE TO authenticated
    USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

  DROP POLICY IF EXISTS "Allow full access to wallet_transactions"   ON public.wallet_transactions;
  DROP POLICY IF EXISTS "Allow public access to wallet_transactions" ON public.wallet_transactions;
  DROP POLICY IF EXISTS "Hub-scoped read wallet_transactions" ON public.wallet_transactions;
  CREATE POLICY "Hub-scoped read wallet_transactions"   ON public.wallet_transactions FOR SELECT TO authenticated
    USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
  DROP POLICY IF EXISTS "Hub-scoped insert wallet_transactions" ON public.wallet_transactions;
  CREATE POLICY "Hub-scoped insert wallet_transactions" ON public.wallet_transactions FOR INSERT TO authenticated
    WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
