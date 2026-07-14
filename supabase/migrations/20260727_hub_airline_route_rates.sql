-- Standard (retail, non-B2B) cargo pricing was a single company-wide rate
-- per destination route (standard_cargo_rates, keyed only by route_name),
-- editable only by super_admin. The business wants rates to also vary by
-- which hub is quoting and which airline is carrying the cargo, and wants
-- each hub's own accountant able to set their hub's rates.
--
-- standard_cargo_rates itself is left completely untouched -- it becomes
-- the last-resort fallback tier (see CargoForm.tsx's resolveRate()), so
-- existing data/behavior for every hub that hasn't configured anything
-- new is unchanged.
--
-- Two new tables rather than adding nullable hub_id/airline columns to
-- standard_cargo_rates -- avoids relying on Postgres's NULL-is-never-equal
-- UNIQUE semantics (which would make a clean ON CONFLICT upsert target for
-- the "any airline" tier awkward) in favor of two small, fully NOT NULL
-- tables with straightforward composite UNIQUE constraints.
--
-- hub_route_rates: this hub's default rate for a route, regardless of
-- airline (fallback tier 2, between the exact match and the company-wide
-- default).
CREATE TABLE IF NOT EXISTS public.hub_route_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id       uuid NOT NULL REFERENCES public.hubs(id),
  route_name   text NOT NULL,
  rate_per_kg  numeric(10,2) NOT NULL,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, route_name)
);

-- hub_airline_route_rates: the exact hub + airline + route rate (fallback
-- tier 1, most specific -- checked first).
CREATE TABLE IF NOT EXISTS public.hub_airline_route_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id       uuid NOT NULL REFERENCES public.hubs(id),
  airline      text NOT NULL,
  route_name   text NOT NULL,
  rate_per_kg  numeric(10,2) NOT NULL,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, airline, route_name)
);

CREATE INDEX IF NOT EXISTS hub_route_rates_hub_idx ON public.hub_route_rates(hub_id);
CREATE INDEX IF NOT EXISTS hub_airline_route_rates_hub_idx ON public.hub_airline_route_rates(hub_id);

-- RLS: read broadly (every cargo agent needs these to auto-price a retail
-- entry, matches standard_cargo_rates' existing "Authenticated read ...
-- USING (true)" policy). Write is deliberately NOT public.is_hub_unrestricted()
-- -- that function also treats accountant as company-wide-unrestricted
-- (matching every other hub-scoped table), but here accountant must be
-- scoped to their own hub only, so this uses its own predicate instead:
-- super_admin/admin (already unrestricted everywhere else) get every hub,
-- accountant gets only hub_id = their own current_user_hub_id().
REVOKE ALL ON TABLE public.hub_route_rates FROM anon;
ALTER TABLE public.hub_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors insert hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_route_rates" ON public.hub_route_rates;
CREATE POLICY "Authenticated read hub_route_rates" ON public.hub_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Hub rate editors insert hub_route_rates" ON public.hub_route_rates FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors update hub_route_rates" ON public.hub_route_rates FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors delete hub_route_rates" ON public.hub_route_rates FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

REVOKE ALL ON TABLE public.hub_airline_route_rates FROM anon;
ALTER TABLE public.hub_airline_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates;
CREATE POLICY "Authenticated read hub_airline_route_rates" ON public.hub_airline_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
