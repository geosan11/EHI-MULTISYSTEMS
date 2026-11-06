-- ============================================================================
-- Migration: 20261106_accountant_sibling_rate_writes.sql
-- Description: Allow accountant role to write cargo rates for own hub and sibling
--              hubs (via public.sibling_hub_ids()), eliminating Sentry RLS 403s
--              and sync_special_goods_rate 400s during Lagos cross-hub rate sync.
-- PR: PR 1 of Sentry Cargo-Rate Fixes
-- ============================================================================
--
-- CONTEXT & ROOT CAUSE:
-- EHI operates two Lagos stations: "EHI Head Office Lagos" and "Lagos Air Cargo Station".
-- Both hubs are handled by a single accountant. When editing cargo rates in the app,
-- syncLagosRates() in src/lib/lagosHubSync.ts copies rows from the active station
-- to the other Lagos station to keep pricing uniform across Lagos hubs.
--
-- Prior write policies restricted accountants to:
--   public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()
-- Because the destination Lagos station is not the accountant's primary assigned hub_id,
-- Postgres rejected rate writes with RLS 403s on:
--   - flat_tier_rates (~2,400 events)
--   - hub_airline_route_rates (~951 events)
--   - hub_route_rates
--   - special_goods_rates
--   - size_tier_rates
-- And HTTP 400 on RPC sync_special_goods_rate (~734 events):
--   "Not authorized to write special_goods_rates for this hub"
--
-- THE FIX:
-- Expand accountant write policies to allow writing to their own hub OR any sibling hub:
--   public.current_user_role() = 'accountant'
--   AND (hub_id = public.current_user_hub_id() OR hub_id = ANY(public.sibling_hub_ids()))
--
-- Use ANY(public.sibling_hub_ids()), not ANY((SELECT public.sibling_hub_ids())).
-- Extra parentheses make ANY use the subquery form (uuid = uuid[]) and fail with
-- ERROR: operator does not exist: uuid = uuid[].
--
-- WHAT REMAINS UNCHANGED:
-- - Read policies: company-wide authenticated read (USING true) remains intact.
-- - Admin / Super Admin: unrestricted access to all hubs remains intact.
-- - Counter staff and other roles: strictly blocked from writing rates.
-- - Out-of-state hubs: accountants cannot write rates for hubs outside their sibling group.
-- - minimum_charges: inspected; has no hub_id column (company-wide, super_admin/admin/accountant).
-- - sibling_hub_ids() and ledger visibility: completely untouched.
--
-- FUNCTION SECURITY NOTE:
-- public.current_user_hub_id() and public.current_user_role() evaluate auth.uid().
-- public.sibling_hub_ids() calls public.current_user_hub_id() which evaluates auth.uid().
-- In SECURITY DEFINER functions like sync_special_goods_rate (with SET search_path = public),
-- auth.uid() resolves to the authenticated caller's JWT ID (request.jwt.claims -> 'sub'),
-- so the authorization check correctly identifies the calling user and their assigned hub.
--
-- ============================================================================
-- ATTACHED OPERATIONS & RECONCILIATION SNIPPETS:
-- (Also available in supabase/PR1_ACCOUNTANT_SIBLING_RATE_WRITES_OPERATIONS.sql)
--
-- ── 1. READ-ONLY DUMP SNIPPET ───────────────────────────────────────────────
-- Run in Supabase SQL editor before applying this migration to inspect live state:
--
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'flat_tier_rates',
--     'hub_airline_route_rates',
--     'hub_route_rates',
--     'special_goods_rates',
--     'size_tier_rates',
--     'minimum_charges'
--   )
-- ORDER BY tablename, cmd, policyname;
--
-- SELECT p.proname, pg_get_functiondef(p.oid) AS definition
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'sync_special_goods_rate',
--     'sibling_hub_ids',
--     'current_user_hub_id',
--     'current_user_role'
--   )
-- ORDER BY p.proname;
--
-- ── 2. ROLLBACK SCRIPT ──────────────────────────────────────────────────────
-- Restores the previous own-hub-only policy text and RPC definition:
--
-- BEGIN;
-- DROP POLICY IF EXISTS "Hub rate editors insert flat_tier_rates" ON public.flat_tier_rates;
-- DROP POLICY IF EXISTS "Hub rate editors update flat_tier_rates" ON public.flat_tier_rates;
-- DROP POLICY IF EXISTS "Hub rate editors delete flat_tier_rates" ON public.flat_tier_rates;
-- CREATE POLICY "Hub rate editors insert flat_tier_rates" ON public.flat_tier_rates FOR INSERT TO authenticated
--   WITH CHECK (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Hub rate editors update flat_tier_rates" ON public.flat_tier_rates FOR UPDATE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Hub rate editors delete flat_tier_rates" ON public.flat_tier_rates FOR DELETE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
--
-- DROP POLICY IF EXISTS "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates;
-- DROP POLICY IF EXISTS "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates;
-- DROP POLICY IF EXISTS "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates;
-- CREATE POLICY "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates FOR INSERT TO authenticated
--   WITH CHECK (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates FOR UPDATE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates FOR DELETE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
--
-- DROP POLICY IF EXISTS "Hub rate editors insert hub_route_rates" ON public.hub_route_rates;
-- DROP POLICY IF EXISTS "Hub rate editors update hub_route_rates" ON public.hub_route_rates;
-- DROP POLICY IF EXISTS "Hub rate editors delete hub_route_rates" ON public.hub_route_rates;
-- CREATE POLICY "Hub rate editors insert hub_route_rates" ON public.hub_route_rates FOR INSERT TO authenticated
--   WITH CHECK (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Hub rate editors update hub_route_rates" ON public.hub_route_rates FOR UPDATE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Hub rate editors delete hub_route_rates" ON public.hub_route_rates FOR DELETE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
--
-- DROP POLICY IF EXISTS "Admins insert special_goods_rates" ON public.special_goods_rates;
-- DROP POLICY IF EXISTS "Admins update special_goods_rates" ON public.special_goods_rates;
-- DROP POLICY IF EXISTS "Admins delete special_goods_rates" ON public.special_goods_rates;
-- CREATE POLICY "Admins insert special_goods_rates" ON public.special_goods_rates FOR INSERT TO authenticated
--   WITH CHECK (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Admins update special_goods_rates" ON public.special_goods_rates FOR UPDATE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
-- CREATE POLICY "Admins delete special_goods_rates" ON public.special_goods_rates FOR DELETE TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
--
-- DROP POLICY IF EXISTS "Write size_tier_rates" ON public.size_tier_rates;
-- CREATE POLICY "Write size_tier_rates" ON public.size_tier_rates FOR ALL TO authenticated
--   USING (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()))
--   WITH CHECK (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id()));
--
-- CREATE OR REPLACE FUNCTION public.sync_special_goods_rate(
--   p_hub_id uuid, p_content_type_id uuid, p_airline text, p_route_name text,
--   p_min_kg numeric, p_max_kg numeric, p_rate_per_kg numeric, p_updated_by text DEFAULT 'Lagos Rate Sync'
-- ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF NOT (public.current_user_role() IN ('super_admin','admin') OR (public.current_user_role() = 'accountant' AND p_hub_id = public.current_user_hub_id())) THEN
--     RAISE EXCEPTION 'Not authorized to write special_goods_rates for this hub';
--   END IF;
--   INSERT INTO public.special_goods_rates (content_type_id, airline, hub_id, route_name, min_kg, max_kg, rate_per_kg, updated_by)
--   VALUES (p_content_type_id, p_airline, p_hub_id, p_route_name, p_min_kg, p_max_kg, p_rate_per_kg, p_updated_by)
--   ON CONFLICT (content_type_id, airline, coalesce(hub_id::text, ''), coalesce(route_name, ''), min_kg)
--   DO UPDATE SET rate_per_kg = EXCLUDED.rate_per_kg, max_kg = EXCLUDED.max_kg, updated_by = EXCLUDED.updated_by, updated_at = now();
-- END;
-- $$;
--
-- ── 3. READ-ONLY RECONCILIATION QUERY (LAGOS RATE DRIFT DIFF) ────────────────
-- Shows rates present in one Lagos station but missing or different in the other:
--
-- WITH lagos_hubs AS (
--   SELECT id, name, code, state
--   FROM public.hubs
--   WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
-- ),
-- h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
-- h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
-- SELECT
--   'hub_airline_route_rates' AS rate_table,
--   COALESCE(r1.airline, r2.airline) AS airline,
--   COALESCE(r1.route_name, r2.route_name) AS route_or_key,
--   r1.rate_per_kg AS h1_rate,
--   r2.rate_per_kg AS h2_rate,
--   CASE
--     WHEN r1.id IS NULL THEN 'Missing in Hub 1 (' || (SELECT name FROM h1) || ')'
--     WHEN r2.id IS NULL THEN 'Missing in Hub 2 (' || (SELECT name FROM h2) || ')'
--     WHEN r1.rate_per_kg <> r2.rate_per_kg THEN 'Rate mismatch'
--     ELSE 'Match'
--   END AS diff_status
-- FROM (SELECT * FROM public.hub_airline_route_rates WHERE hub_id = (SELECT id FROM h1)) r1
-- FULL OUTER JOIN (SELECT * FROM public.hub_airline_route_rates WHERE hub_id = (SELECT id FROM h2)) r2
--   ON r1.airline = r2.airline AND r1.route_name = r2.route_name
-- WHERE r1.id IS NULL OR r2.id IS NULL OR r1.rate_per_kg <> r2.rate_per_kg;
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. TABLE: flat_tier_rates
-- ────────────────────────────────────────────────────────────────────────────
BEGIN;

DROP POLICY IF EXISTS "Hub rate editors insert flat_tier_rates" ON public.flat_tier_rates;
DROP POLICY IF EXISTS "Hub rate editors update flat_tier_rates" ON public.flat_tier_rates;
DROP POLICY IF EXISTS "Hub rate editors delete flat_tier_rates" ON public.flat_tier_rates;

CREATE POLICY "Hub rate editors insert flat_tier_rates"
  ON public.flat_tier_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Hub rate editors update flat_tier_rates"
  ON public.flat_tier_rates
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Hub rate editors delete flat_tier_rates"
  ON public.flat_tier_rates
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 2. TABLE: hub_airline_route_rates
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates;

CREATE POLICY "Hub rate editors insert hub_airline_route_rates"
  ON public.hub_airline_route_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Hub rate editors update hub_airline_route_rates"
  ON public.hub_airline_route_rates
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Hub rate editors delete hub_airline_route_rates"
  ON public.hub_airline_route_rates
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 3. TABLE: hub_route_rates
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Hub rate editors insert hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_route_rates" ON public.hub_route_rates;

CREATE POLICY "Hub rate editors insert hub_route_rates"
  ON public.hub_route_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Hub rate editors update hub_route_rates"
  ON public.hub_route_rates
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Hub rate editors delete hub_route_rates"
  ON public.hub_route_rates
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 4. TABLE: special_goods_rates
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins insert special_goods_rates" ON public.special_goods_rates;
DROP POLICY IF EXISTS "Admins update special_goods_rates" ON public.special_goods_rates;
DROP POLICY IF EXISTS "Admins delete special_goods_rates" ON public.special_goods_rates;

CREATE POLICY "Admins insert special_goods_rates"
  ON public.special_goods_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Admins update special_goods_rates"
  ON public.special_goods_rates
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );

CREATE POLICY "Admins delete special_goods_rates"
  ON public.special_goods_rates
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 5. TABLE: size_tier_rates
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Write size_tier_rates" ON public.size_tier_rates;

CREATE POLICY "Write size_tier_rates"
  ON public.size_tier_rates
  FOR ALL
  TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        hub_id = public.current_user_hub_id()
        OR hub_id = ANY(public.sibling_hub_ids())
      )
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC: sync_special_goods_rate
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_special_goods_rate(
  p_hub_id uuid,
  p_content_type_id uuid,
  p_airline text,
  p_route_name text,
  p_min_kg numeric,
  p_max_kg numeric,
  p_rate_per_kg numeric,
  p_updated_by text DEFAULT 'Lagos Rate Sync'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (
      public.current_user_role() = 'accountant'
      AND (
        p_hub_id = public.current_user_hub_id()
        OR p_hub_id = ANY(public.sibling_hub_ids())
      )
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to write special_goods_rates for this hub';
  END IF;

  INSERT INTO public.special_goods_rates (
    content_type_id,
    airline,
    hub_id,
    route_name,
    min_kg,
    max_kg,
    rate_per_kg,
    updated_by
  )
  VALUES (
    p_content_type_id,
    p_airline,
    p_hub_id,
    p_route_name,
    p_min_kg,
    p_max_kg,
    p_rate_per_kg,
    p_updated_by
  )
  ON CONFLICT (content_type_id, airline, coalesce(hub_id::text, ''), coalesce(route_name, ''), min_kg)
  DO UPDATE SET
    rate_per_kg = EXCLUDED.rate_per_kg,
    max_kg      = EXCLUDED.max_kg,
    updated_by  = EXCLUDED.updated_by,
    updated_at  = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_special_goods_rate(uuid, uuid, text, text, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_special_goods_rate(uuid, uuid, text, text, numeric, numeric, numeric, text) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. NOTE ON minimum_charges
-- ────────────────────────────────────────────────────────────────────────────
-- Table public.minimum_charges was inspected. It is company-wide and does not
-- contain a hub_id column. Its write policies already allow:
--   WITH CHECK / USING (public.current_user_role() IN ('super_admin','admin','accountant'))
-- Accountants can already write any row in minimum_charges; no change required.


-- ────────────────────────────────────────────────────────────────────────────
-- 8. TRACK MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('20261106_accountant_sibling_rate_writes.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
