-- ============================================================
-- FLIGHT RADAR -- flight_number capture + shared status cache
-- ============================================================
-- cargo_entries.flight_number: optional, captured at CargoForm intake or
-- added later from TransactionLedger's edit modal. manifests.flight_no
-- already exists (excess baggage) and is reused as-is -- Flight Radar reads
-- both columns, no schema change needed on manifests.
ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS flight_number text;

-- flight_status_cache: last known AeroDataBox lookup per (flight_number,
-- flight_date), shared across every hub/role -- not tenant-scoped, so RLS
-- here is deliberately simpler than the hub-isolation policies on the
-- transactional tables (current_user_hub_id()/is_hub_unrestricted(),
-- 20260708_hub_isolation_rls.sql). Reads are open to any authenticated
-- staff member; writes only ever come from server/flightRadar.ts's
-- service-role client (same posture as the admin-only writes in
-- server/app.ts), which is also where the AeroDataBox API key lives --
-- never exposed to the browser.
CREATE TABLE IF NOT EXISTS public.flight_status_cache (
  flight_number       text NOT NULL,
  flight_date         date NOT NULL,
  airline_name        text,
  status               text NOT NULL DEFAULT 'unknown',
  scheduled_departure  timestamptz,
  actual_departure     timestamptz,
  scheduled_arrival    timestamptz,
  actual_arrival       timestamptz,
  delay_minutes        integer,
  departure_airport    text,
  arrival_airport      text,
  diverted_airport     text,
  raw                  jsonb,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flight_number, flight_date)
);

ALTER TABLE public.flight_status_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY flight_status_cache_select ON public.flight_status_cache
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy for the authenticated role at all -- the
-- service-role client server/flightRadar.ts uses bypasses RLS entirely, so
-- the absence of a policy here is what keeps this table read-only from the
-- browser (matches the "no policy = no access" default Postgres RLS
-- posture used elsewhere for service-role-only writes in this codebase).
