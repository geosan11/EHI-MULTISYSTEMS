-- Standalone/idempotent re-run of 20260711_marketing_pricing_and_vj_settings.sql.
-- That migration apparently never completed against this database (the
-- table doesn't exist at all here), so this recreates it from scratch
-- rather than assuming it's already there in some shape. If the table
-- *does* already exist (e.g. created by 20260711 succeeding after all,
-- just without the route_name UNIQUE constraint sticking), the explicit
-- CREATE UNIQUE INDEX IF NOT EXISTS below still guarantees the ON CONFLICT
-- target exists either way.
CREATE TABLE IF NOT EXISTS public.marketing_route_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_name  text UNIQUE NOT NULL,
  bb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  mb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  sb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_route_rates_route_name_key
  ON public.marketing_route_rates (route_name);

ALTER TABLE public.marketing_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read marketing_route_rates"   ON public.marketing_route_rates;
DROP POLICY IF EXISTS "Authenticated upsert marketing_route_rates" ON public.marketing_route_rates;
DROP POLICY IF EXISTS "Authenticated update marketing_route_rates" ON public.marketing_route_rates;
CREATE POLICY "Authenticated read marketing_route_rates"   ON public.marketing_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated upsert marketing_route_rates" ON public.marketing_route_rates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update marketing_route_rates" ON public.marketing_route_rates FOR UPDATE TO authenticated USING (true);

INSERT INTO public.marketing_route_rates (route_name, bb_rate, mb_rate, sb_rate) VALUES
  ('LOS/Lagos - ABV/Abuja', 18000, 12000, 7500),
  ('LOS/Lagos - PHC/Port Harcourt', 22000, 15000, 9500),
  ('ABV/Abuja - LOS/Lagos', 18000, 12000, 7500),
  ('PHC/Port Harcourt - LOS/Lagos', 22000, 15000, 9500),
  ('LOS/Lagos - ENU/Enugu', 19500, 13000, 8000)
ON CONFLICT (route_name) DO NOTHING;
