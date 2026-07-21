-- ============================================================
-- LAGOS (MMA2) HUB — airline per-kg rates + minimum charges
-- Source: AERO/ARIK/GREEN AFRICA and UNITED rate cards.
-- ============================================================

-- Resolve the Lagos hub once. Adjust the code if your Lagos hub isn't 'LOS'.
DO $$
DECLARE v_hub uuid;
BEGIN
  SELECT id INTO v_hub FROM public.hubs WHERE code = 'LOS' LIMIT 1;
  IF v_hub IS NULL THEN
    RAISE NOTICE 'No hub with code LOS — airline per-kg seed skipped. Set the correct code and re-run.';
    RETURN;
  END IF;

  -- ── Per-kg rates: hub_airline_route_rates (hub + airline + route) ──
  INSERT INTO public.hub_airline_route_rates (hub_id, airline, route_name, rate_per_kg, updated_by)
  SELECT v_hub, v.airline, h.code || '/' || h.name, v.rate, 'seed:rate-cards'
  FROM (VALUES
    -- AERO / ARIK / GREEN AFRICA share one card (three airlines, same rates)
    ('Aero Contractors','ABV',500),('Aero Contractors','PHC',500),('Aero Contractors','BNI',500),
    ('Aero Contractors','CBQ',600),('Aero Contractors','ABB',600),('Aero Contractors','KAN',650),
    ('Aero Contractors','YOL',650),('Aero Contractors','SKO',650),
    ('Arik Air','ABV',500),('Arik Air','PHC',500),('Arik Air','BNI',500),
    ('Arik Air','CBQ',600),('Arik Air','ABB',600),('Arik Air','KAN',650),
    ('Arik Air','YOL',650),('Arik Air','SKO',650),
    ('Green Africa Airways','ABV',500),('Green Africa Airways','PHC',500),('Green Africa Airways','BNI',500),
    ('Green Africa Airways','CBQ',600),('Green Africa Airways','ABB',600),('Green Africa Airways','KAN',650),
    ('Green Africa Airways','YOL',650),('Green Africa Airways','SKO',650),
    -- UNITED card
    ('United Nigeria Airlines','ABV',600),('United Nigeria Airlines','PHC',600),
    ('United Nigeria Airlines','QRW',700),('United Nigeria Airlines','QOW',700),
    ('United Nigeria Airlines','ABB',700),('United Nigeria Airlines','ENU',700),
    ('United Nigeria Airlines','KAN',700),('United Nigeria Airlines','SKO',700),
    ('United Nigeria Airlines','KAD',1000)   -- VERIFY: handwritten, reads ~1,000
  ) AS v(airline, code, rate)
  JOIN public.hubs h ON h.code = v.code
  ON CONFLICT (hub_id, airline, route_name)
  DO UPDATE SET rate_per_kg = EXCLUDED.rate_per_kg, updated_at = now(), updated_by = 'seed:rate-cards';

  RAISE NOTICE 'Airline per-kg rates seeded for hub %.', v_hub;
END $$;

-- ── Minimum charges: minimum_charges (airline + route + weight bracket) ──
-- Not hub-scoped in this table; keyed by airline + route + [min_kg,max_kg].
INSERT INTO public.minimum_charges (airline, route_name, min_kg, max_kg, minimum_amount)
SELECT v.airline, h.code || '/' || h.name, v.min_kg, v.max_kg, v.amount
FROM (VALUES
  -- AERO / ARIK / GREEN AFRICA
  ('Aero Contractors','ABV',1,16,8000),('Aero Contractors','PHC',1,16,8000),
  ('Aero Contractors','ABB',1,15,9000),('Aero Contractors','CBQ',1,15,9000),
  ('Aero Contractors','KAN',1,16,10000),
  ('Arik Air','ABV',1,16,8000),('Arik Air','PHC',1,16,8000),
  ('Arik Air','ABB',1,15,9000),('Arik Air','CBQ',1,15,9000),
  ('Arik Air','KAN',1,16,10000),
  ('Green Africa Airways','ABV',1,16,8000),('Green Africa Airways','PHC',1,16,8000),
  ('Green Africa Airways','ABB',1,15,9000),('Green Africa Airways','CBQ',1,15,9000),
  ('Green Africa Airways','KAN',1,16,10000),
  -- UNITED
  ('United Nigeria Airlines','ABV',1,13,8000),('United Nigeria Airlines','PHC',1,13,8000),
  ('United Nigeria Airlines','ABB',1,15,9000),('United Nigeria Airlines','QOW',1,15,9000),
  ('United Nigeria Airlines','ENU',1,15,9000)
) AS v(airline, code, min_kg, max_kg, amount)
JOIN public.hubs h ON h.code = v.code
ON CONFLICT DO NOTHING;
