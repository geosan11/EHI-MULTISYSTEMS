-- =============================================================
-- Wallet RPC security hardening: cash-payout role check + force-delete hub check
-- (Real authoring date: 2026-07-23. Filename prefixed 2026090x per
-- docs/MIGRATION_POLICY.md so it sorts after every migration already
-- applied to the live database.)
-- =============================================================
-- Found during a wallet-system audit (requested alongside the retrieval-
-- approval feature in 20260906, since both touch the same role-check
-- patterns):
--   a) approve_wallet_cash_payout/reject_wallet_cash_payout
--      (20260902_multi_department_retrieval_and_wallet_cashout.sql)
--      correctly block self-approval (auth.uid() comparison) and check
--      the wallet's hub, but never check the CALLER's role at all. The
--      UI hides the Approve/Reject buttons from anyone but accountant/
--      admin/super_admin (CustomerWallets.tsx's canApprovePayouts), but
--      that's cosmetic only -- a raw supabase.rpc() call from any two
--      same-hub staff (e.g. two cargo_agents) could collude to move real
--      cash out of a wallet with zero financial-authority involvement.
--   b) force_delete_wallet (20260905_force_delete_wallet.sql) checks role
--      but has NO hub check at all -- unlike every other wallet RPC. An
--      accountant/admin/office_work user (any hub) could permanently
--      destroy a wallet belonging to a completely different hub.
-- =============================================================

-- ─── a. approve_wallet_cash_payout / reject_wallet_cash_payout: add role check ──
-- Same signatures as 20260902 -- safe CREATE OR REPLACE, no DROP needed.
-- Role list matches CustomerWallets.tsx's existing canApprovePayouts gate
-- exactly (deliberately excludes auditor -- Staff Management already
-- describes that role as read-only).
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
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to approve a wallet cash payout';
  END IF;

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
  IF public.current_user_role() NOT IN ('accountant', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to reject a wallet cash payout';
  END IF;

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

-- ─── b. force_delete_wallet: add the missing hub check ─────────────────
-- Same signature as 20260905 -- safe CREATE OR REPLACE, no DROP needed.
-- Deliberately the STRICT current_user_hub_id() rule (matching
-- apply_wallet_transaction), not the looser sibling_hub_ids() model used
-- for retrieval/debt-clearing -- this is a destructive, irreversible
-- action, so it should be at least as strict as an ordinary wallet
-- transaction, not looser. office_work is in the function's allowed-role
-- list but not in is_hub_unrestricted(), so it correctly stays hub-locked.
CREATE OR REPLACE FUNCTION public.force_delete_wallet(
  p_wallet_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id uuid;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'accountant', 'admin', 'office_work') THEN
    RAISE EXCEPTION 'Not authorized to force-delete a wallet';
  END IF;

  SELECT hub_id INTO v_hub_id FROM public.customer_wallets WHERE id = p_wallet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
  END IF;

  IF v_hub_id IS NOT NULL
     AND v_hub_id <> public.current_user_hub_id()
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to force-delete a wallet outside your hub';
  END IF;

  -- Unlink every entry that paid via this wallet -- wallet_deduction_amount
  -- is left untouched on all four (it's a historical fact about that
  -- entry's own cost breakdown, independent of which wallet covered it).
  UPDATE public.cargo_entries     SET wallet_id = NULL WHERE wallet_id = p_wallet_id;
  UPDATE public.manifests         SET wallet_id = NULL WHERE wallet_id = p_wallet_id;
  UPDATE public.marketing_entries SET wallet_id = NULL WHERE wallet_id = p_wallet_id;
  UPDATE public.package_entries   SET wallet_id = NULL WHERE wallet_id = p_wallet_id;

  -- Cascades to wallet_transactions automatically (ON DELETE CASCADE).
  DELETE FROM public.customer_wallets WHERE id = p_wallet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_delete_wallet(uuid) TO authenticated;

INSERT INTO public.schema_migrations (filename) VALUES ('20260907_wallet_rpc_security_hardening.sql')
ON CONFLICT (filename) DO NOTHING;
