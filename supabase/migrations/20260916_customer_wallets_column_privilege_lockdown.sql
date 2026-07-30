-- =============================================================
-- Fix: customer_wallets' UPDATE RLS policy (20260810_wallet_atomicity_and_
-- isolation.sql) only checks WHICH HUB a wallet belongs to -- it says
-- nothing about which COLUMNS a same-hub caller may change. Every column
-- on the table, including `balance`, `total_topped_up`, `total_used`, and
-- `status`, is reachable by a plain client-side
-- supabase.from('customer_wallets').update({ balance: ... }) call from any
-- authenticated staff member in that hub, completely bypassing
-- apply_wallet_transaction() -- no role check, no insufficient-balance
-- guard, no wallet_transactions audit row. That RPC is the only intended
-- way balance/total_topped_up/total_used/status ever change; confirmed by
-- searching every client call site in src/components/views/CustomerWallets.tsx,
-- which only ever updates `archived_at` (auto-archive-on-exhausted) and
-- `customer_phone` (correcting a typo) directly.
--
-- Fix: revoke the table-level UPDATE grant Supabase's platform default
-- gives `authenticated` on every new public-schema table, then re-grant
-- UPDATE on only the two columns the app legitimately writes directly.
-- apply_wallet_transaction()/approve_wallet_cash_payout()/etc. are all
-- SECURITY DEFINER, so they run as their owner (not as `authenticated`)
-- and are completely unaffected by this -- this only closes the direct,
-- unmediated client path. RLS's existing hub-scoping stays as an
-- additional, independent layer on top of this.
-- =============================================================

REVOKE UPDATE ON public.customer_wallets FROM authenticated;
GRANT UPDATE (archived_at, customer_phone) ON public.customer_wallets TO authenticated;
