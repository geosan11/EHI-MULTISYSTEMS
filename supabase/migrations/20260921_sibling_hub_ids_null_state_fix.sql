-- =============================================================
-- Fix: a hub with no `state` set makes every one of its own non-admin
-- staff see ZERO transactions from their own hub.
--
-- sibling_hub_ids() (20260817_state_visibility.sql) groups hub visibility
-- by matching hubs.state via plain `=`. hubs.state is a nullable free-text
-- column (20260706_full_schema.sql) with no required-field validation on
-- the "Add Hub" form (Settings.tsx). In standard SQL, `NULL = NULL` is
-- never true -- so if a hub's state was left blank at creation,
-- sibling_hub_ids() returns NULL for every staff member assigned to that
-- hub, and `hub_id = ANY(NULL)` is always false in every RLS policy that
-- uses it (cargo_entries/manifests/marketing_entries/package_entries/
-- expenses SELECT policies). Every cargo_agent/baggage_agent/etc. at that
-- hub would see no transactions from their own hub at all -- silently,
-- invisible to admins/accountants/auditors/super_admins (who bypass this
-- via is_hub_unrestricted()), which is exactly why this class of gap
-- survives unnoticed.
--
-- Fix: change the state comparison from `=` to `IS NOT DISTINCT FROM`,
-- the standard SQL NULL-safe equality operator -- NULL-state hubs now
-- match each other (and, critically, match themselves), closing the
-- "sees nothing" failure mode. No behavior change for any hub that
-- already has a real state value set. Same signature, so CREATE OR
-- REPLACE is safe -- no DROP needed.
-- =============================================================

CREATE OR REPLACE FUNCTION public.sibling_hub_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT array_agg(id)
  FROM public.hubs
  WHERE state IS NOT DISTINCT FROM (
    SELECT state FROM public.hubs WHERE id = public.current_user_hub_id()
  );
$$;
