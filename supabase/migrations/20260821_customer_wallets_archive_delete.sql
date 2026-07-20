-- Customer wallet delete button, guarded against destroying financial
-- history. wallet_transactions.wallet_id is ON DELETE CASCADE
-- (20260717_cargo_workflow_overhaul.sql) -- a hard DELETE on customer_wallets
-- silently wipes that customer's entire top-up/deduction audit trail, which
-- this app already treats as a liability record (see that migration's own
-- comment: "a liability: EHI holds this money for the customer").
--
-- archived_at is a separate soft-delete flag from `status` (active/exhausted/
-- frozen) -- status is driven by balance and isn't meant to represent
-- "hidden from the list," so this doesn't overload it. NULL = visible
-- (the default for every existing wallet); a timestamp = archived/hidden.
-- The app only ever hard-deletes a wallet that has zero balance AND zero
-- transaction history (i.e. truly never used) -- anything with real
-- activity gets archived instead, keeping its full history intact and
-- queryable, just out of the default list.
ALTER TABLE public.customer_wallets ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- customer_wallets had SELECT/INSERT/UPDATE policies added in
-- 20260810_wallet_atomicity_and_isolation.sql but no DELETE policy at all --
-- RLS enabled with no matching policy means every .delete() call today
-- silently succeeds with 0 rows affected. Matches the existing hub-scoped
-- pattern used for INSERT/UPDATE on this same table.
DROP POLICY IF EXISTS "Hub-scoped delete customer_wallets" ON public.customer_wallets;
CREATE POLICY "Hub-scoped delete customer_wallets" ON public.customer_wallets FOR DELETE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
