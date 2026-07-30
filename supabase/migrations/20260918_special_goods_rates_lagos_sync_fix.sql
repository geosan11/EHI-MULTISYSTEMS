-- =============================================================
-- Fix: special_goods_rates Lagos hub sync race (flagged, unfixed, in
-- 766beac "fix(pricing): stop 409s in Lagos hub rate sync under
-- concurrent sessions" -- that commit fixed the identical snapshot-then-
-- insert race for flat_tier_rates/size_tier_rates by switching to
-- .upsert(..., {onConflict}), but special_goods_rates couldn't use the
-- same fix: its uniqueness is an EXPRESSION index --
--   special_goods_rates_uniq ON (content_type_id, airline,
--     coalesce(hub_id::text, ''), coalesce(route_name, ''), min_kg)
-- (20260828_special_goods_route_and_perishable.sql) -- and PostgREST's
-- upsert `onConflict` option only accepts a bare column-name list, which
-- can't express the coalesce(...) wrapping. Two staff sessions loading
-- the app around the same time still race exactly like the other two
-- tables did before their fix: both snapshot before either syncs, both
-- decide the same row is missing, the losing insert 409s and silently
-- drops -- the losing session's target Lagos hub can be left without that
-- special-goods override until the next sync cycle.
--
-- Fix: a dedicated RPC wrapping a raw `INSERT ... ON CONFLICT (<same
-- expression list as the index>) DO UPDATE`, which Postgres CAN target at
-- an expression-based unique index (unlike PostgREST's upsert helper).
-- SECURITY DEFINER, so it bypasses RLS -- explicitly re-checks the same
-- role/hub rule the table's own INSERT/UPDATE policies already enforce
-- (super_admin/admin unrestricted; accountant scoped to their own hub_id)
-- so this RPC doesn't become a wider write path than direct table access
-- already was for the other 4 tables this same sync function touches.
-- =============================================================

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

  INSERT INTO public.special_goods_rates (content_type_id, airline, hub_id, route_name, min_kg, max_kg, rate_per_kg, updated_by)
  VALUES (p_content_type_id, p_airline, p_hub_id, p_route_name, p_min_kg, p_max_kg, p_rate_per_kg, p_updated_by)
  ON CONFLICT (content_type_id, airline, coalesce(hub_id::text, ''), coalesce(route_name, ''), min_kg)
  DO UPDATE SET
    rate_per_kg = EXCLUDED.rate_per_kg,
    max_kg      = EXCLUDED.max_kg,
    updated_by  = EXCLUDED.updated_by,
    updated_at  = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_special_goods_rate(uuid, uuid, text, text, numeric, numeric, numeric, text) TO authenticated;
