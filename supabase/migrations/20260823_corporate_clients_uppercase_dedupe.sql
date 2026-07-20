-- ============================================================
-- CORPORATE CLIENTS: normalize to UPPERCASE, de-duplicate, seed
-- ============================================================

-- 1. Canonical name normalizer: UPPERCASE, trimmed, internal runs of
--    whitespace collapsed to one space. Single source of truth used by
--    the merge below and the write-time trigger.
CREATE OR REPLACE FUNCTION public.normalize_company_name(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

-- 2. Merge duplicates that only differ by case/whitespace. For each group
--    of rows sharing a normalized name, keep the oldest row (min created_at,
--    tie-broken by id) and fold the rest into it.
DO $$
DECLARE
  g   RECORD;
  keeper uuid;
  loser  uuid;
BEGIN
  FOR g IN
    SELECT public.normalize_company_name(company_name) AS norm
    FROM public.corporate_clients
    GROUP BY 1
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper
    FROM public.corporate_clients
    WHERE public.normalize_company_name(company_name) = g.norm
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    FOR loser IN
      SELECT id FROM public.corporate_clients
      WHERE public.normalize_company_name(company_name) = g.norm
        AND id <> keeper
    LOOP
      -- Fold the loser's outstanding balance into the keeper.
      UPDATE public.corporate_clients k
      SET accumulated_monthly_debt = k.accumulated_monthly_debt
          + coalesce((SELECT l.accumulated_monthly_debt FROM public.corporate_clients l WHERE l.id = loser), 0)
      WHERE k.id = keeper;

      -- Repoint transactional FKs. cargo_entries.corporate_client_id is
      -- declared `uuid` in its original CREATE TABLE
      -- (20260706_full_schema.sql), but on at least one live database it's
      -- actually `text` -- that table predates the formal uuid+FK
      -- convention every other corporate_client_id column here follows, and
      -- CREATE TABLE IF NOT EXISTS is a no-op against a pre-existing table
      -- with a different column type. Explicit ::text casts make this work
      -- against the real live type instead of assuming the migration file's
      -- (here, wrong) declared one. pending_corporate_intakes is a much
      -- newer table with a real enforced uuid FK to corporate_clients(id)
      -- (20260717_pending_corporate_intakes.sql), so no cast is needed there.
      UPDATE public.cargo_entries          SET corporate_client_id = keeper::text WHERE corporate_client_id = loser::text;
      UPDATE public.pending_corporate_intakes SET corporate_client_id = keeper WHERE corporate_client_id = loser;

      -- Repoint route rates, but only where the keeper doesn't already
      -- have that route (the unique (client, route_name) constraint would
      -- reject a collision) — keep the keeper's rate, drop the loser's dupe.
      UPDATE public.corporate_route_rates r
      SET corporate_client_id = keeper
      WHERE r.corporate_client_id = loser
        AND NOT EXISTS (
          SELECT 1 FROM public.corporate_route_rates k
          WHERE k.corporate_client_id = keeper AND k.route_name = r.route_name
        );
      DELETE FROM public.corporate_route_rates WHERE corporate_client_id = loser;

      DELETE FROM public.corporate_clients WHERE id = loser;
    END LOOP;
  END LOOP;
END $$;

-- 3. Normalize the survivors in place.
UPDATE public.corporate_clients
SET company_name = public.normalize_company_name(company_name)
WHERE company_name <> public.normalize_company_name(company_name);

-- 4. Enforce it forever: every insert/update is normalized before write,
--    so the existing UNIQUE(company_name) index now behaves as a
--    case/whitespace-insensitive constraint.
CREATE OR REPLACE FUNCTION public.tg_normalize_company_name()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.company_name := public.normalize_company_name(NEW.company_name);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_normalize_company_name ON public.corporate_clients;
CREATE TRIGGER trg_normalize_company_name
  BEFORE INSERT OR UPDATE OF company_name ON public.corporate_clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_company_name();

-- 5. Seed the office B2B clients (idempotent). Names are already the
--    canonical form; the trigger would normalize them anyway.
INSERT INTO public.corporate_clients (company_name) VALUES
  ('SLOT'), ('A51'), ('CANDYPLUS'), ('GLOBACOM'), ('ZANON'),
  ('3C HUB'), ('FEDEX'), ('ARAMEX'), ('NIG ARMY'), ('SPECTRANET'),
  ('ROYAL-ARCH'), ('SMART MARK'), ('SAHCO'), ('SCHOOL KITS')
ON CONFLICT (company_name) DO NOTHING;

-- 6. Seed negotiated route rates, joined to the live hubs table on code so
--    route_name always matches CargoForm's `${code}/${name}`. Any
--    (client, hub_code) whose hub doesn't exist is silently skipped — add
--    those rates later in Pricing Configuration once the hub exists.
--    NOTE: these numbers are transcribed from the six rate letters, which
--    conflict across dates. Treat as a starting point and adjust in the
--    Pricing Configuration screen; nothing here is hardcoded in the app.
INSERT INTO public.corporate_route_rates (corporate_client_id, route_name, rate_per_kg, minimum_amount)
SELECT c.id, h.code || '/' || h.name, v.rate, v.min_charge
FROM (VALUES
  -- client,       hub_code, rate,  min_charge
  ('SLOT',        'ABV',  800,  15000),
  ('SLOT',        'PHC',  950,  18000),
  ('SLOT',        'ENU',  950,  18000),
  ('SLOT',        'BNI',  950,  18000),
  ('A51',         'ABV',  800,  8000),
  ('CANDYPLUS',   'ABV',  800,  8000),
  ('GLOBACOM',    'ABV',  850,  15000),
  ('GLOBACOM',    'PHC',  950,  15000),
  ('GLOBACOM',    'QOW',  950,  15000),
  ('GLOBACOM',    'ENU',  950,  15000),
  ('GLOBACOM',    'BNI',  950,  15000),
  ('GLOBACOM',    'CBQ',  950,  15000),
  ('GLOBACOM',    'KAN',  1300, 20000),
  ('GLOBACOM',    'KAD',  1300, 20000),
  ('GLOBACOM',    'MIU',  1300, 20000),
  ('ZANON',       'ABV',  750,  0),
  ('3C HUB',      'ABV',  800,  15000),
  ('3C HUB',      'PHC',  800,  15000),
  ('3C HUB',      'QOW',  950,  18000),
  ('3C HUB',      'ENU',  950,  18000),
  ('3C HUB',      'QRW',  950,  18000),
  ('3C HUB',      'QUO',  950,  18000),
  ('3C HUB',      'CBQ',  950,  18000),
  ('3C HUB',      'ABB',  950,  18000),
  ('3C HUB',      'BNI',  950,  18000),
  ('3C HUB',      'BCU',  1200, 20000),
  ('3C HUB',      'KAN',  1200, 20000),
  ('3C HUB',      'KAD',  1200, 20000),
  ('3C HUB',      'MIU',  1200, 20000),
  ('FEDEX',       'ABV',  750,  10000),
  ('FEDEX',       'PHC',  750,  10000),
  ('FEDEX',       'ENU',  950,  15000),
  ('FEDEX',       'BNI',  950,  15000),
  ('FEDEX',       'QOW',  950,  15000),
  ('FEDEX',       'KAN',  1000, 15000),
  ('FEDEX',       'YOL',  1000, 15000),
  ('ARAMEX',      'ABV',  750,  10000),
  ('ARAMEX',      'PHC',  750,  10000),
  ('ARAMEX',      'ENU',  950,  15000),
  ('ARAMEX',      'BNI',  950,  15000),
  ('ARAMEX',      'QOW',  950,  15000),
  ('NIG ARMY',    'ABV',  650,  10000),
  ('NIG ARMY',    'PHC',  650,  10000),
  ('NIG ARMY',    'ENU',  650,  10000),
  ('NIG ARMY',    'YOL',  850,  12000),
  ('NIG ARMY',    'KAD',  850,  12000),
  ('NIG ARMY',    'KAN',  850,  12000),
  ('SPECTRANET',    'ABV',  750,  0),
  ('SPECTRANET',    'PHC',  750,  0),
  ('ROYAL-ARCH',  'ABV',  700,  10000),
  ('SMART MARK',  'ABV',  850,  18000),
  ('SMART MARK',  'PHC',  850,  18000),
  ('SMART MARK',  'QRW',  950,  25000),
  ('SMART MARK',  'KAN',  950,  25000),
  ('SAHCO',       'ABV',  700,  10000),
  ('SAHCO',       'PHC',  900,  15000),
  ('SAHCO',       'QOW',  900,  15000),
  ('SAHCO',       'ENU',  900,  15000),
  ('SAHCO',       'QRW',  900,  15000),
  ('SAHCO',       'QUO',  900,  15000),
  ('SAHCO',       'CBQ',  900,  15000),
  ('SAHCO',       'ABB',  900,  15000),
  ('SAHCO',       'BNI',  900,  15000),
  ('SAHCO',       'IBA',  900,  15000),
  ('SAHCO',       'ILR',  900,  15000),
  ('SAHCO',       'BCU',  1100, 15000),
  ('SAHCO',       'YOL',  1100, 15000),
  ('SAHCO',       'KAN',  1100, 15000),
  ('SAHCO',       'KAD',  1100, 15000),
  ('SAHCO',       'MIU',  1100, 15000),
  ('SAHCO',       'GMO',  1100, 15000),
  ('SCHOOL KITS', 'ABV',  650,  10000),
  ('SCHOOL KITS', 'PHC',  650,  10000),
  ('SCHOOL KITS', 'KAN',  1000, 15000),
  ('SCHOOL KITS', 'YOL',  1000, 15000)
) AS v(company_name, hub_code, rate, min_charge)
JOIN public.corporate_clients c ON c.company_name = public.normalize_company_name(v.company_name)
JOIN public.hubs h ON h.code = v.hub_code
ON CONFLICT (corporate_client_id, route_name) DO NOTHING;
