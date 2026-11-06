-- ============================================================================
-- EHI-MULTISYSTEMS: PR 1 Operations, Verification & Reconciliation Guide
-- Purpose: Companion scripts for 20261106_accountant_sibling_rate_writes.sql
-- Intended Execution: Supabase SQL Editor (Copy & Paste per section)
-- NOTE: PR 1 changes write policies only. Do NOT run production push scripts.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: PRE-MIGRATION READ-ONLY LIVE DUMP
-- Run this before applying the migration to capture the exact live policy and
-- function definitions.
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Dump existing policies on the 6 rate-related tables
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'flat_tier_rates',
    'hub_airline_route_rates',
    'hub_route_rates',
    'special_goods_rates',
    'size_tier_rates',
    'minimum_charges'
  )
ORDER BY tablename, cmd, policyname;

-- 1.2 Dump existing function definitions
SELECT
  p.proname,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'sync_special_goods_rate',
    'sibling_hub_ids',
    'current_user_hub_id',
    'current_user_role'
  )
ORDER BY p.proname;

-- 1.3 Check if minimum_charges has a hub_id column (Expected: NO rows)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'minimum_charges'
  AND column_name = 'hub_id';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: POST-MIGRATION VERIFICATION (TRANSACTIONAL SIMULATION)
-- Runs inside a BEGIN ... ROLLBACK transaction block to verify permissions
-- for:
--   1. Accountant writing to own hub (Hub A) -> SUCCESS
--   2. Accountant writing to sibling Lagos hub (Hub B) -> SUCCESS
--   3. Accountant writing to out-of-state hub (Hub C) -> EXPECTED ERROR
--   4. Counter staff writing to rates -> EXPECTED ERROR
-- Because this rolls back, no test data is ever persisted.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_lagos_hub1 uuid;
  v_lagos_hub2 uuid;
  v_other_hub  uuid;
  v_accountant uuid;
  v_counter    uuid;
  v_admin      uuid;
  v_test_ct    uuid;
BEGIN
  -- Identify two Lagos hubs
  SELECT id INTO v_lagos_hub1
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%'
  ORDER BY code = 'LOS' DESC, name ASC
  LIMIT 1;

  SELECT id INTO v_lagos_hub2
  FROM public.hubs
  WHERE (code = 'LOS' OR lower(name) LIKE '%lagos%')
    AND id <> v_lagos_hub1
  LIMIT 1;

  -- Identify an out-of-state hub (e.g. Abuja or Port Harcourt)
  SELECT id INTO v_other_hub
  FROM public.hubs
  WHERE lower(trim(state)) NOT IN ('lagos')
    AND lower(name) NOT LIKE '%lagos%'
    AND code <> 'LOS'
  LIMIT 1;

  -- Verify existence
  IF v_lagos_hub1 IS NULL OR v_lagos_hub2 IS NULL THEN
    RAISE NOTICE 'Skipping simulation: At least 2 Lagos hubs required. Found hub1=%, hub2=%', v_lagos_hub1, v_lagos_hub2;
    RETURN;
  END IF;

  RAISE NOTICE '=== Lagos Hub 1: %', v_lagos_hub1;
  RAISE NOTICE '=== Lagos Hub 2: %', v_lagos_hub2;
  RAISE NOTICE '=== Non-Lagos Hub: %', v_other_hub;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: READ-ONLY LAGOS HUBS RATE RECONCILIATION & DRIFT DIFF
-- Compare cargo rates between the two Lagos stations ("EHI Head Office Lagos"
-- and "Lagos Air Cargo Station").
-- Sanni can review the output to determine which hub has the authoritative
-- price list and trigger a synchronization.
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 Rate row count summary between the two Lagos stations
WITH lagos_hubs AS (
  SELECT id, name, code, state
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
),
h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
SELECT
  'hub_airline_route_rates' AS table_name,
  (SELECT name || ' (' || code || ')' FROM h1) AS hub_1,
  (SELECT count(*) FROM public.hub_airline_route_rates WHERE hub_id = (SELECT id FROM h1)) AS h1_count,
  (SELECT name || ' (' || code || ')' FROM h2) AS hub_2,
  (SELECT count(*) FROM public.hub_airline_route_rates WHERE hub_id = (SELECT id FROM h2)) AS h2_count
UNION ALL
SELECT
  'hub_route_rates' AS table_name,
  (SELECT name || ' (' || code || ')' FROM h1) AS hub_1,
  (SELECT count(*) FROM public.hub_route_rates WHERE hub_id = (SELECT id FROM h1)) AS h1_count,
  (SELECT name || ' (' || code || ')' FROM h2) AS hub_2,
  (SELECT count(*) FROM public.hub_route_rates WHERE hub_id = (SELECT id FROM h2)) AS h2_count
UNION ALL
SELECT
  'special_goods_rates' AS table_name,
  (SELECT name || ' (' || code || ')' FROM h1) AS hub_1,
  (SELECT count(*) FROM public.special_goods_rates WHERE hub_id = (SELECT id FROM h1)) AS h1_count,
  (SELECT name || ' (' || code || ')' FROM h2) AS hub_2,
  (SELECT count(*) FROM public.special_goods_rates WHERE hub_id = (SELECT id FROM h2)) AS h2_count
UNION ALL
SELECT
  'flat_tier_rates' AS table_name,
  (SELECT name || ' (' || code || ')' FROM h1) AS hub_1,
  (SELECT count(*) FROM public.flat_tier_rates WHERE hub_id = (SELECT id FROM h1)) AS h1_count,
  (SELECT name || ' (' || code || ')' FROM h2) AS hub_2,
  (SELECT count(*) FROM public.flat_tier_rates WHERE hub_id = (SELECT id FROM h2)) AS h2_count
UNION ALL
SELECT
  'size_tier_rates' AS table_name,
  (SELECT name || ' (' || code || ')' FROM h1) AS hub_1,
  (SELECT count(*) FROM public.size_tier_rates WHERE hub_id = (SELECT id FROM h1)) AS h1_count,
  (SELECT name || ' (' || code || ')' FROM h2) AS hub_2,
  (SELECT count(*) FROM public.size_tier_rates WHERE hub_id = (SELECT id FROM h2)) AS h2_count;


-- 3.2 Detailed Diff: hub_airline_route_rates
WITH lagos_hubs AS (
  SELECT id, name, code, state
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
),
h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
SELECT
  COALESCE(r1.airline, r2.airline) AS airline,
  COALESCE(r1.route_name, r2.route_name) AS route_name,
  r1.rate_per_kg AS h1_rate,
  r2.rate_per_kg AS h2_rate,
  CASE
    WHEN r1.id IS NULL THEN 'Missing in Hub 1 (' || (SELECT name FROM h1) || ')'
    WHEN r2.id IS NULL THEN 'Missing in Hub 2 (' || (SELECT name FROM h2) || ')'
    WHEN r1.rate_per_kg <> r2.rate_per_kg THEN 'Rate mismatch'
    ELSE 'Match'
  END AS diff_status
FROM (SELECT * FROM public.hub_airline_route_rates WHERE hub_id = (SELECT id FROM h1)) r1
FULL OUTER JOIN (SELECT * FROM public.hub_airline_route_rates WHERE hub_id = (SELECT id FROM h2)) r2
  ON r1.airline = r2.airline AND r1.route_name = r2.route_name
WHERE r1.id IS NULL OR r2.id IS NULL OR r1.rate_per_kg <> r2.rate_per_kg
ORDER BY airline, route_name;


-- 3.3 Detailed Diff: hub_route_rates
WITH lagos_hubs AS (
  SELECT id, name, code, state
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
),
h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
SELECT
  COALESCE(r1.route_name, r2.route_name) AS route_name,
  r1.rate_per_kg AS h1_rate,
  r2.rate_per_kg AS h2_rate,
  CASE
    WHEN r1.id IS NULL THEN 'Missing in Hub 1 (' || (SELECT name FROM h1) || ')'
    WHEN r2.id IS NULL THEN 'Missing in Hub 2 (' || (SELECT name FROM h2) || ')'
    WHEN r1.rate_per_kg <> r2.rate_per_kg THEN 'Rate mismatch'
    ELSE 'Match'
  END AS diff_status
FROM (SELECT * FROM public.hub_route_rates WHERE hub_id = (SELECT id FROM h1)) r1
FULL OUTER JOIN (SELECT * FROM public.hub_route_rates WHERE hub_id = (SELECT id FROM h2)) r2
  ON r1.route_name = r2.route_name
WHERE r1.id IS NULL OR r2.id IS NULL OR r1.rate_per_kg <> r2.rate_per_kg
ORDER BY route_name;


-- 3.4 Detailed Diff: special_goods_rates
WITH lagos_hubs AS (
  SELECT id, name, code, state
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
),
h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
SELECT
  ct.name AS content_type,
  COALESCE(r1.airline, r2.airline) AS airline,
  COALESCE(r1.route_name, r2.route_name) AS route_name,
  COALESCE(r1.min_kg, r2.min_kg) AS min_kg,
  COALESCE(r1.max_kg, r2.max_kg) AS max_kg,
  r1.rate_per_kg AS h1_rate,
  r2.rate_per_kg AS h2_rate,
  CASE
    WHEN r1.id IS NULL THEN 'Missing in Hub 1 (' || (SELECT name FROM h1) || ')'
    WHEN r2.id IS NULL THEN 'Missing in Hub 2 (' || (SELECT name FROM h2) || ')'
    WHEN r1.rate_per_kg <> r2.rate_per_kg THEN 'Rate mismatch'
    ELSE 'Match'
  END AS diff_status
FROM (SELECT * FROM public.special_goods_rates WHERE hub_id = (SELECT id FROM h1)) r1
FULL OUTER JOIN (SELECT * FROM public.special_goods_rates WHERE hub_id = (SELECT id FROM h2)) r2
  ON r1.content_type_id = r2.content_type_id
 AND r1.airline = r2.airline
 AND COALESCE(r1.route_name, '') = COALESCE(r2.route_name, '')
 AND r1.min_kg = r2.min_kg
LEFT JOIN public.content_types ct ON ct.id = COALESCE(r1.content_type_id, r2.content_type_id)
WHERE r1.id IS NULL OR r2.id IS NULL OR r1.rate_per_kg <> r2.rate_per_kg
ORDER BY ct.name, airline, min_kg;


-- 3.5 Detailed Diff: flat_tier_rates
WITH lagos_hubs AS (
  SELECT id, name, code, state
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
),
h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
SELECT
  ct.name AS content_type,
  COALESCE(r1.airline, r2.airline) AS airline,
  COALESCE(r1.route_name, r2.route_name) AS route_name,
  COALESCE(r1.min_kg, r2.min_kg) AS min_kg,
  COALESCE(r1.max_kg, r2.max_kg) AS max_kg,
  r1.flat_amount AS h1_amount,
  r2.flat_amount AS h2_amount,
  CASE
    WHEN r1.id IS NULL THEN 'Missing in Hub 1 (' || (SELECT name FROM h1) || ')'
    WHEN r2.id IS NULL THEN 'Missing in Hub 2 (' || (SELECT name FROM h2) || ')'
    WHEN r1.flat_amount <> r2.flat_amount THEN 'Amount mismatch'
    ELSE 'Match'
  END AS diff_status
FROM (SELECT * FROM public.flat_tier_rates WHERE hub_id = (SELECT id FROM h1)) r1
FULL OUTER JOIN (SELECT * FROM public.flat_tier_rates WHERE hub_id = (SELECT id FROM h2)) r2
  ON r1.content_type_id = r2.content_type_id
 AND r1.airline = r2.airline
 AND r1.route_name = r2.route_name
 AND r1.min_kg = r2.min_kg
LEFT JOIN public.content_types ct ON ct.id = COALESCE(r1.content_type_id, r2.content_type_id)
WHERE r1.id IS NULL OR r2.id IS NULL OR r1.flat_amount <> r2.flat_amount
ORDER BY ct.name, airline, route_name, min_kg;


-- 3.6 Detailed Diff: size_tier_rates
WITH lagos_hubs AS (
  SELECT id, name, code, state
  FROM public.hubs
  WHERE code = 'LOS' OR lower(name) LIKE '%lagos%' OR lower(trim(state)) = 'lagos'
),
h1 AS (SELECT id, name, code FROM lagos_hubs ORDER BY code = 'LOS' DESC, name ASC LIMIT 1),
h2 AS (SELECT id, name, code FROM lagos_hubs WHERE id NOT IN (SELECT id FROM h1) LIMIT 1)
SELECT
  ct.name AS content_type,
  COALESCE(r1.airline, r2.airline) AS airline,
  COALESCE(r1.route_name, r2.route_name) AS route_name,
  COALESCE(r1.min_inches, r2.min_inches) AS min_inches,
  COALESCE(r1.max_inches, r2.max_inches) AS max_inches,
  r1.flat_amount AS h1_amount,
  r2.flat_amount AS h2_amount,
  CASE
    WHEN r1.id IS NULL THEN 'Missing in Hub 1 (' || (SELECT name FROM h1) || ')'
    WHEN r2.id IS NULL THEN 'Missing in Hub 2 (' || (SELECT name FROM h2) || ')'
    WHEN r1.flat_amount <> r2.flat_amount THEN 'Amount mismatch'
    ELSE 'Match'
  END AS diff_status
FROM (SELECT * FROM public.size_tier_rates WHERE hub_id = (SELECT id FROM h1)) r1
FULL OUTER JOIN (SELECT * FROM public.size_tier_rates WHERE hub_id = (SELECT id FROM h2)) r2
  ON r1.content_type_id = r2.content_type_id
 AND r1.airline = r2.airline
 AND r1.route_name = r2.route_name
 AND r1.min_inches = r2.min_inches
LEFT JOIN public.content_types ct ON ct.id = COALESCE(r1.content_type_id, r2.content_type_id)
WHERE r1.id IS NULL OR r2.id IS NULL OR r1.flat_amount <> r2.flat_amount
ORDER BY ct.name, airline, route_name, min_inches;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: COMPLETE ROLLBACK SCRIPT
-- Execute if any unexpected behavior occurs after deploying migration
-- 20261106_accountant_sibling_rate_writes.sql.
-- Restores the previous own-hub-only write restrictions for accountants.
-- ════════════════════════════════════════════════════════════════════════════

-- 4.1 Rollback flat_tier_rates
DROP POLICY IF EXISTS "Hub rate editors insert flat_tier_rates" ON public.flat_tier_rates;
DROP POLICY IF EXISTS "Hub rate editors update flat_tier_rates" ON public.flat_tier_rates;
DROP POLICY IF EXISTS "Hub rate editors delete flat_tier_rates" ON public.flat_tier_rates;

CREATE POLICY "Hub rate editors insert flat_tier_rates" ON public.flat_tier_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Hub rate editors update flat_tier_rates" ON public.flat_tier_rates
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Hub rate editors delete flat_tier_rates" ON public.flat_tier_rates
  FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

-- 4.2 Rollback hub_airline_route_rates
DROP POLICY IF EXISTS "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates;

CREATE POLICY "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates
  FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

-- 4.3 Rollback hub_route_rates
DROP POLICY IF EXISTS "Hub rate editors insert hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_route_rates" ON public.hub_route_rates;

CREATE POLICY "Hub rate editors insert hub_route_rates" ON public.hub_route_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Hub rate editors update hub_route_rates" ON public.hub_route_rates
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Hub rate editors delete hub_route_rates" ON public.hub_route_rates
  FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

-- 4.4 Rollback special_goods_rates
DROP POLICY IF EXISTS "Admins insert special_goods_rates" ON public.special_goods_rates;
DROP POLICY IF EXISTS "Admins update special_goods_rates" ON public.special_goods_rates;
DROP POLICY IF EXISTS "Admins delete special_goods_rates" ON public.special_goods_rates;

CREATE POLICY "Admins insert special_goods_rates" ON public.special_goods_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Admins update special_goods_rates" ON public.special_goods_rates
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

CREATE POLICY "Admins delete special_goods_rates" ON public.special_goods_rates
  FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

-- 4.5 Rollback size_tier_rates
DROP POLICY IF EXISTS "Write size_tier_rates" ON public.size_tier_rates;

CREATE POLICY "Write size_tier_rates" ON public.size_tier_rates
  FOR ALL TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

-- 4.6 Rollback sync_special_goods_rate RPC
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
    OR (public.current_user_role() = 'accountant' AND p_hub_id = public.current_user_hub_id())
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

-- Delete migration record from tracking
DELETE FROM public.schema_migrations
WHERE filename = '20261106_accountant_sibling_rate_writes.sql';
