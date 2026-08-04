-- customer_wallets' SELECT policy (20260810_wallet_atomicity_and_isolation.sql)
-- was hub-scoped like every other financial table:
--   USING (hub_id = current_user_hub_id() OR hub_id IS NULL OR is_hub_unrestricted())
-- is_hub_unrestricted() only covers super_admin/admin/accountant/auditor --
-- cargo_agent/baggage_agent/marketing_agent/driver/office_work are hub-locked.
-- Every wallet is tagged with its CREATOR's hub_id (find_or_create_customer_
-- wallet), so a wallet a super_admin (or any staff at a different hub)
-- creates/tops-up is silently invisible to front-line staff at other hubs --
-- confirmed live: an agent's "Select Wallet for <customer>" picker (Cargo
-- Form, Package Form, Excess Baggage Form, Marketing Workspace, and
-- TransactionLedger's Edit Transaction modal all share this same picker)
-- showed "0 Active" for a customer who does have a wallet.
--
-- Unlike cargo/baggage/marketing/package entries (genuinely hub-specific
-- operational records), customer wallets are a company-wide CUSTOMER
-- relationship -- CustomerWallets.tsx's own fetch already carries a comment
-- saying exactly this ("all station agents across all hubs require
-- visibility into all customer wallets"), so the client code has always
-- assumed unrestricted read; only the RLS layer disagreed. Write access
-- (INSERT/UPDATE policies) is untouched -- this only changes who can SEE a
-- wallet, not who can create/mutate one.
DROP POLICY IF EXISTS "Hub-scoped read customer_wallets" ON public.customer_wallets;
CREATE POLICY "Company-wide read customer_wallets" ON public.customer_wallets FOR SELECT TO authenticated
  USING (true);
