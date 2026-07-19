-- ============================================================
-- SECURITY HARDENING — close every gap found in a full audit of
-- RLS coverage, the deactivated-user path, and cross-hub exposure.
-- Safe to re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout).
-- ============================================================
--
-- Three separate problems, fixed together because they compound:
--
-- 1. Nine tables were created with NO RLS enabled at all: corporate_clients,
--    corporate_route_rates, pricing_config, standard_cargo_rates,
--    driver_trips, trip_pings, fleet_vehicles, fuel_logs, routing_hubs.
--    The Supabase anon key is bundled client-side by design (same as any
--    anon key) -- on a table with RLS off, that key reads/writes every
--    row and column directly via the REST API, with zero regard for what
--    the app's own UI shows or restricts. corporate_clients/
--    corporate_route_rates is the worst of these: negotiated per-client
--    freight rates and running debt balances, fully exposed.
--
-- 2. Deactivating a staff member (user_profiles.active = false) was only
--    checked at signIn() -- an already-issued session/refresh token kept
--    working through every RLS policy indefinitely, since none of them
--    checked `active` either. Fixed once, centrally: current_user_hub_id()
--    and current_user_role() (the SECURITY DEFINER helpers every hub-scoped
--    policy in 20260708_hub_isolation_rls.sql calls) now both return NULL
--    for a deactivated user, which correctly fails every dependent policy
--    closed without having to touch each of those policies individually.
--    A deactivated user can still read their OWN user_profiles row (that
--    policy checks auth.uid() = id directly, unaffected by this change) --
--    intentional, since the client needs that read to detect `active:
--    false` and force a sign-out (see src/lib/auth.ts getSession()).
--
-- 3. bank_reconciliations and proof_of_delivery had RLS enabled but with
--    "USING (true) TO authenticated" -- any staff member at any hub could
--    read every other hub's bank reconciliation runs and delivery proofs
--    (signatures/photos/GPS/ID numbers). Tightened to match how the app
--    actually gates these features client-side.
--
-- Also included: the public /track page's anon-role access is made
-- explicit and column-restricted at the database level (see bottom
-- section) -- it was previously relying entirely on the app's own
-- .select() column list for column restriction, which a direct REST call
-- bypassing the app entirely could ignore completely.
-- ============================================================

-- ============================================================
-- PART 1 — deactivated users lose access everywhere, automatically
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_hub_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT hub_id FROM public.user_profiles WHERE id = auth.uid() AND active = true;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid() AND active = true;
$$;

-- is_hub_unrestricted() is unchanged (defined in 20260708_hub_isolation_rls.sql)
-- but automatically inherits this fix since it calls current_user_role().

-- ============================================================
-- PART 2 — RLS for the nine tables that had none
-- ============================================================

-- CORPORATE_CLIENTS
-- Read: hub-scoped (matches cargo_entries pattern). Insert: PricingConfiguration.tsx
-- is the only Supabase INSERT path and is gated to super_admin client-side --
-- matched here at the DB layer too. Update: CargoForm.tsx's gate-weighing flow
-- updates accumulated_monthly_debt for any authenticated agent finishing a
-- corporate transaction, so that stays broadly authenticated.
REVOKE ALL ON TABLE public.corporate_clients FROM anon;
ALTER TABLE public.corporate_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read corporate_clients"    ON public.corporate_clients;
DROP POLICY IF EXISTS "Super admin insert corporate_clients" ON public.corporate_clients;
DROP POLICY IF EXISTS "Authenticated update corporate_clients" ON public.corporate_clients;
DROP POLICY IF EXISTS "Hub-scoped read corporate_clients" ON public.corporate_clients;
CREATE POLICY "Hub-scoped read corporate_clients" ON public.corporate_clients FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Super admin insert corporate_clients" ON public.corporate_clients FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'super_admin');
CREATE POLICY "Authenticated update corporate_clients" ON public.corporate_clients FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- CORPORATE_ROUTE_RATES — no hub_id column of its own; scoped via its
-- corporate_client_id FK. Writes only ever happen from PricingConfiguration.tsx
-- (super_admin-gated).
REVOKE ALL ON TABLE public.corporate_route_rates FROM anon;
ALTER TABLE public.corporate_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read corporate_route_rates"   ON public.corporate_route_rates;
DROP POLICY IF EXISTS "Super admin insert corporate_route_rates" ON public.corporate_route_rates;
DROP POLICY IF EXISTS "Super admin update corporate_route_rates" ON public.corporate_route_rates;
DROP POLICY IF EXISTS "Hub-scoped read corporate_route_rates" ON public.corporate_route_rates;
CREATE POLICY "Hub-scoped read corporate_route_rates" ON public.corporate_route_rates FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR corporate_client_id IN (
      SELECT id FROM public.corporate_clients WHERE hub_id = public.current_user_hub_id() OR hub_id IS NULL
    )
  );
CREATE POLICY "Super admin insert corporate_route_rates" ON public.corporate_route_rates FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'super_admin');
CREATE POLICY "Super admin update corporate_route_rates" ON public.corporate_route_rates FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin');

-- PRICING_CONFIG — genuinely global (airline commissions, VJ settings), read
-- broadly by every entry form. CargoForm.tsx writes a new entry here for any
-- cargo agent adding a custom "Other" airline, so writes stay broadly
-- authenticated too (RLS's job here is only to block anon, not to add a
-- role restriction the app doesn't already have).
REVOKE ALL ON TABLE public.pricing_config FROM anon;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read pricing_config"   ON public.pricing_config;
DROP POLICY IF EXISTS "Authenticated insert pricing_config" ON public.pricing_config;
DROP POLICY IF EXISTS "Authenticated update pricing_config" ON public.pricing_config;
CREATE POLICY "Authenticated read pricing_config"   ON public.pricing_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert pricing_config" ON public.pricing_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update pricing_config" ON public.pricing_config FOR UPDATE TO authenticated USING (true);

-- STANDARD_CARGO_RATES — read broadly (every cargo entry needs it for
-- pricing), but the only write path (PricingConfiguration.tsx) is gated to
-- super_admin client-side -- matched here.
REVOKE ALL ON TABLE public.standard_cargo_rates FROM anon;
ALTER TABLE public.standard_cargo_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read standard_cargo_rates"  ON public.standard_cargo_rates;
DROP POLICY IF EXISTS "Super admin insert standard_cargo_rates"  ON public.standard_cargo_rates;
DROP POLICY IF EXISTS "Super admin update standard_cargo_rates"  ON public.standard_cargo_rates;
DROP POLICY IF EXISTS "Authenticated read standard_cargo_rates" ON public.standard_cargo_rates;
CREATE POLICY "Authenticated read standard_cargo_rates" ON public.standard_cargo_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Super admin insert standard_cargo_rates" ON public.standard_cargo_rates;
CREATE POLICY "Super admin insert standard_cargo_rates" ON public.standard_cargo_rates FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'super_admin');
DROP POLICY IF EXISTS "Super admin update standard_cargo_rates" ON public.standard_cargo_rates;
CREATE POLICY "Super admin update standard_cargo_rates" ON public.standard_cargo_rates FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin');

-- DRIVER_TRIPS — hub-scoped, same pattern as cargo_entries. Any authenticated
-- driver creates/updates their own trips via MyTrips.tsx.
REVOKE ALL ON TABLE public.driver_trips FROM anon;
ALTER TABLE public.driver_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read driver_trips"   ON public.driver_trips;
DROP POLICY IF EXISTS "Hub-scoped insert driver_trips" ON public.driver_trips;
DROP POLICY IF EXISTS "Hub-scoped update driver_trips" ON public.driver_trips;
CREATE POLICY "Hub-scoped read driver_trips"   ON public.driver_trips FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert driver_trips" ON public.driver_trips FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped update driver_trips" ON public.driver_trips FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- TRIP_PINGS (live GPS) — no hub_id of its own; scoped via its trip_id FK
-- to driver_trips. Insert-only from the app (pings are never edited).
REVOKE ALL ON TABLE public.trip_pings FROM anon;
ALTER TABLE public.trip_pings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read trip_pings"   ON public.trip_pings;
DROP POLICY IF EXISTS "Hub-scoped insert trip_pings" ON public.trip_pings;
DROP POLICY IF EXISTS "Hub-scoped read trip_pings" ON public.trip_pings;
CREATE POLICY "Hub-scoped read trip_pings" ON public.trip_pings FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR trip_id IN (SELECT id FROM public.driver_trips WHERE hub_id = public.current_user_hub_id() OR hub_id IS NULL)
  );
CREATE POLICY "Hub-scoped insert trip_pings" ON public.trip_pings FOR INSERT TO authenticated
  WITH CHECK (
    public.is_hub_unrestricted()
    OR trip_id IN (SELECT id FROM public.driver_trips WHERE hub_id = public.current_user_hub_id() OR hub_id IS NULL)
  );

-- FLEET_VEHICLES / FUEL_LOGS — hub-scoped, same pattern. Fleet.tsx (the only
-- writer) is already admin-gated client-side; hub-scoping at the DB layer is
-- at least as tight and keeps this consistent with every other table here.
REVOKE ALL ON TABLE public.fleet_vehicles FROM anon;
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read fleet_vehicles"   ON public.fleet_vehicles;
DROP POLICY IF EXISTS "Hub-scoped insert fleet_vehicles" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "Hub-scoped update fleet_vehicles" ON public.fleet_vehicles;
CREATE POLICY "Hub-scoped read fleet_vehicles"   ON public.fleet_vehicles FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert fleet_vehicles" ON public.fleet_vehicles FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped update fleet_vehicles" ON public.fleet_vehicles FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

REVOKE ALL ON TABLE public.fuel_logs FROM anon;
ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read fuel_logs"   ON public.fuel_logs;
DROP POLICY IF EXISTS "Hub-scoped insert fuel_logs" ON public.fuel_logs;
DROP POLICY IF EXISTS "Hub-scoped update fuel_logs" ON public.fuel_logs;
CREATE POLICY "Hub-scoped read fuel_logs"   ON public.fuel_logs FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert fuel_logs" ON public.fuel_logs FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped update fuel_logs" ON public.fuel_logs FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- ROUTING_HUBS — non-sensitive reference data (valid transit-hub routes),
-- same treatment as the `hubs` table itself: readable by any authenticated
-- user. No client code path writes this table today, so no write policy is
-- added (locked to service_role / direct DB access only).
REVOKE ALL ON TABLE public.routing_hubs FROM anon;
ALTER TABLE public.routing_hubs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read routing_hubs" ON public.routing_hubs;
CREATE POLICY "Authenticated read routing_hubs" ON public.routing_hubs FOR SELECT TO authenticated USING (true);

-- ============================================================
-- PART 3 — hub/role-scope the two tables that were "any authenticated
-- user, any hub, USING (true)"
-- ============================================================

-- BANK_RECONCILIATIONS — no hub_id column (bank accounts are company-wide,
-- not per-hub), so the only meaningful restriction is by role. The app's
-- own nav gate (More.tsx: canAccessRecon) already limits this feature to
-- super_admin/accountant -- matched here so the restriction holds even
-- against a direct API call.
REVOKE ALL ON TABLE public.bank_reconciliations FROM anon;
DROP POLICY IF EXISTS "Authenticated read bank_reconciliations"   ON public.bank_reconciliations;
DROP POLICY IF EXISTS "Authenticated insert bank_reconciliations" ON public.bank_reconciliations;
DROP POLICY IF EXISTS "Recon-role read bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Recon-role read bank_reconciliations" ON public.bank_reconciliations FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'accountant'));
DROP POLICY IF EXISTS "Recon-role insert bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Recon-role insert bank_reconciliations" ON public.bank_reconciliations FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('super_admin', 'accountant'));

-- PROOF_OF_DELIVERY — has hub_name (text, no FK) instead of hub_id; scoped
-- by matching it against the current user's own hub name via the hubs
-- table. Insert stays open (WITH CHECK true) -- a driver capturing a
-- signature always writes their own current hub_name, and this only needed
-- to close the read-side cross-hub leak (any staffer could browse every
-- other hub's delivery signatures/photos/ID numbers).
REVOKE ALL ON TABLE public.proof_of_delivery FROM anon;
DROP POLICY IF EXISTS "Authenticated read proof_of_delivery"   ON public.proof_of_delivery;
DROP POLICY IF EXISTS "Authenticated insert proof_of_delivery" ON public.proof_of_delivery;
DROP POLICY IF EXISTS "Hub-scoped read proof_of_delivery" ON public.proof_of_delivery;
CREATE POLICY "Hub-scoped read proof_of_delivery" ON public.proof_of_delivery FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR hub_name = (SELECT name FROM public.hubs WHERE id = public.current_user_hub_id())
  );
CREATE POLICY "Authenticated insert proof_of_delivery" ON public.proof_of_delivery FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- PART 4 — explicit, column-restricted anon read access for the public
-- /track page (src/App.tsx PublicTrackingPage)
-- ============================================================
-- cargo_entries/manifests/marketing_entries/tracking_events already have
-- RLS enabled with authenticated-only policies (20260708_hub_isolation_rls.sql)
-- -- meaning anon currently gets ZERO rows from any of them as written. If
-- the live /track page is working today, a permissive anon policy exists
-- in the dashboard that was never captured in a migration; this section
-- makes that access explicit, in-repo, and -- critically -- restricted to
-- exactly the columns the app displays via column-level GRANTs, not just
-- the app's own .select() list. PostgREST resolves an unqualified
-- select=* into the full column list from its schema cache and Postgres
-- rejects any column beyond what's been granted, so a handcrafted request
-- against the REST API directly (bypassing the app's column choices
-- entirely) still can never retrieve amount, receipt_mode, bank,
-- entered_by, scanned_by_name, etc. RLS below only controls which ROWS
-- anon can see; the REVOKE/GRANT pair is what actually caps the columns.

REVOKE ALL ON TABLE public.cargo_entries FROM anon;
GRANT SELECT (entry_ref, awb_tag_number, consignee_name, route, content_type, total_kg, total_pcs, status)
  ON public.cargo_entries TO anon;
DROP POLICY IF EXISTS "Anon read cargo_entries for tracking" ON public.cargo_entries;
CREATE POLICY "Anon read cargo_entries for tracking" ON public.cargo_entries
  FOR SELECT TO anon USING (true);

REVOKE ALL ON TABLE public.marketing_entries FROM anon;
GRANT SELECT (entry_ref, customer_name, route, status)
  ON public.marketing_entries TO anon;
DROP POLICY IF EXISTS "Anon read marketing_entries for tracking" ON public.marketing_entries;
CREATE POLICY "Anon read marketing_entries for tracking" ON public.marketing_entries
  FOR SELECT TO anon USING (true);

REVOKE ALL ON TABLE public.manifests FROM anon;
GRANT SELECT (transaction_id, passenger_name, destination, excess_kg, total_kg, total_pcs, status)
  ON public.manifests TO anon;
DROP POLICY IF EXISTS "Anon read manifests for tracking" ON public.manifests;
CREATE POLICY "Anon read manifests for tracking" ON public.manifests
  FOR SELECT TO anon USING (true);

-- tracking_events additionally restricted at the ROW level, not just
-- columns: WRONG_DESTINATION_ALERT rows (internal ops-only -- who scanned
-- it, the wrong destination it was headed to, the alert reason) must never
-- be fetchable by anon, even via a handcrafted request that skips the
-- app's own .in('event_type', [...]) filter. cargo_ref is granted (but not
-- selected by the app) because PostgREST/Postgres requires column-level
-- SELECT privilege on anything referenced in a WHERE/eq filter, not only
-- the returned columns.
REVOKE ALL ON TABLE public.tracking_events FROM anon;
GRANT SELECT (cargo_ref, event_type, hub_name, created_at)
  ON public.tracking_events TO anon;
DROP POLICY IF EXISTS "Anon read tracking_events for delivery history" ON public.tracking_events;
CREATE POLICY "Anon read tracking_events for delivery history" ON public.tracking_events
  FOR SELECT TO anon
  USING (event_type IN ('DEPART', 'ARRIVE', 'DELIVER'));
