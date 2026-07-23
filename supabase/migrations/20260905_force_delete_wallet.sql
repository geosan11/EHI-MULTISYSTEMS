-- Force-deleting a wallet with real balance/history was previously
-- impossible from the app -- CustomerWallets.tsx's handleRemoveWallet only
-- hard-deletes a wallet with zero balance/total_topped_up/total_used;
-- anything with real activity could only be archived. This adds a genuine
-- destructive path, restricted to super_admin/accountant/admin/office_work.
--
-- A plain DELETE would fail outright: cargo_entries.wallet_id references
-- customer_wallets(id) with no ON DELETE clause (20260717_cargo_workflow_
-- overhaul.sql), which defaults to NO ACTION -- any entry still pointing at
-- this wallet blocks the delete. manifests/marketing_entries/package_entries
-- have the same wallet_id FK shape (see the repoint logic in
-- 20260826_wallet_phone_identity.sql, which unlinks the same four tables
-- before deleting a merged-away wallet). wallet_transactions.wallet_id is
-- ON DELETE CASCADE and needs no manual handling -- its audit trail
-- disappearing is the whole point of a *forceful* delete, unlike the merge
-- migration which deliberately repoints it to preserve history.
CREATE OR REPLACE FUNCTION public.force_delete_wallet(
  p_wallet_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'accountant', 'admin', 'office_work') THEN
    RAISE EXCEPTION 'Not authorized to force-delete a wallet';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customer_wallets WHERE id = p_wallet_id) THEN
    RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
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
