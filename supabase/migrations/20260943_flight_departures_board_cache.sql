-- ============================================================
-- FLIGHT DEPARTURES BOARD CACHE -- powers CargoForm's flight-number
-- auto-fill (see server/flightRadar.ts's GET /departures route).
-- ============================================================
-- One row per (origin airport, day): the whole day's departures board for
-- that airport, fetched from AeroDataBox once and cached for ~20 minutes
-- (server-enforced TTL, not here) so every agent at a hub typing cargo
-- entries shares a single board fetch instead of one AeroDataBox call per
-- form fill -- see flight_status_cache's own header comment in
-- 20260942_flight_radar.sql for the same free-tier-budget reasoning.
CREATE TABLE IF NOT EXISTS public.flight_departures_board_cache (
  origin_iata  text NOT NULL,
  board_date   date NOT NULL,
  flights      jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origin_iata, board_date)
);

ALTER TABLE public.flight_departures_board_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY flight_departures_board_cache_select ON public.flight_departures_board_cache
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy -- same service-role-only write posture as
-- flight_status_cache (20260942_flight_radar.sql).
