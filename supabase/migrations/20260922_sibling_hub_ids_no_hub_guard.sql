-- =============================================================
-- Fix a regression introduced by 20260921_sibling_hub_ids_null_state_fix.sql
-- (same day, self-review before either had been applied live).
--
-- That migration correctly fixed a hub with a blank `state` making its own
-- staff see zero transactions, by switching the state comparison to
-- IS NOT DISTINCT FROM (NULL-safe equality). But it introduced a new edge
-- case: when the CALLING user has no valid hub at all (current_user_hub_id()
-- returns NULL -- a deactivated account per current_user_hub_id()'s own
-- `AND active = true` clause, or any profile with hub_id unset), the
-- subquery `(SELECT state FROM hubs WHERE id = current_user_hub_id())`
-- itself evaluates to NULL. Previously (`=`), `state = NULL` was never
-- true for any row, so that user correctly saw nothing (fail-closed).
-- With `IS NOT DISTINCT FROM`, `state IS NOT DISTINCT FROM NULL` now
-- matches every hub that ALSO has a blank state -- i.e. exactly the hubs
-- the previous migration was written to protect -- so a hub-less/
-- deactivated caller would see ALL of them, a fail-OPEN regression for a
-- caller who should see nothing.
--
-- Fix: explicitly require current_user_hub_id() IS NOT NULL before the
-- state match runs, so a caller with no valid hub still gets an empty
-- result (matching the pre-20260817 fail-closed default), while a caller
-- WITH a real hub_id (whose hub happens to have a blank state) still gets
-- the intended fix. Same signature, CREATE OR REPLACE is safe.
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
  WHERE public.current_user_hub_id() IS NOT NULL
    AND state IS NOT DISTINCT FROM (
      SELECT state FROM public.hubs WHERE id = public.current_user_hub_id()
    );
$$;
