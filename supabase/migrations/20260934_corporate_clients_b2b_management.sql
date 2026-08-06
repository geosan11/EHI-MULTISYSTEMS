-- =============================================================
-- B2B client management: deactivation column + role-aligned write RLS +
-- corporate_route_rates delete policy
-- =============================================================
-- 1. corporate_clients had no way to be deactivated at all (nothing in the
--    app exposed it, and officeWork.ts explicitly noted the column didn't
--    exist). Adds it, mirroring the existing hubs.active pattern -- default
--    true so every existing client stays visible/matchable exactly as
--    before this migration.
--
-- 2. corporate_clients/corporate_route_rates INSERT (and corporate_route_
--    rates UPDATE) policies required role = 'super_admin' exactly
--    (20260716_security_hardening.sql), but permissions.ts's
--    'More:PricingConfiguration' menu entry grants 'admin' and 'accountant'
--    access to this same screen too. Those two roles could open Pricing
--    Configuration and see the B2B panel, but every attempt to add a client
--    or set/update a negotiated rate was silently rejected by the database
--    -- the UI's permission model and the RLS never actually agreed.
--    Realigns both to the same role list already used for the sibling
--    minimum_charges/special_goods_rates tables.
--
-- 3. corporate_route_rates had no DELETE policy at all -- there was no way
--    to remove a mis-entered or expired negotiated rate short of a direct
--    DB operation. Adds one with the same role list.
-- =============================================================

ALTER TABLE public.corporate_clients
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Super admin insert corporate_clients" ON public.corporate_clients;
CREATE POLICY "Admins insert corporate_clients" ON public.corporate_clients FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin', 'accountant'));

DROP POLICY IF EXISTS "Super admin insert corporate_route_rates" ON public.corporate_route_rates;
CREATE POLICY "Admins insert corporate_route_rates" ON public.corporate_route_rates FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin', 'accountant'));

DROP POLICY IF EXISTS "Super admin update corporate_route_rates" ON public.corporate_route_rates;
CREATE POLICY "Admins update corporate_route_rates" ON public.corporate_route_rates FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin', 'accountant'));

DROP POLICY IF EXISTS "Admins delete corporate_route_rates" ON public.corporate_route_rates;
CREATE POLICY "Admins delete corporate_route_rates" ON public.corporate_route_rates FOR DELETE TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin', 'accountant'));
