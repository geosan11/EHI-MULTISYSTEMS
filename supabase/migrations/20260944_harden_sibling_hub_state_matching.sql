-- =============================================================
-- Harden sibling-hub grouping: case/whitespace-safe matching, plus a
-- server-side backstop so the two Lagos hubs can't drift apart again.
-- =============================================================
-- Cargo agents at either Lagos hub (EHI Head Office Lagos / Lagos Air
-- Cargo Station) can already SEE each other's entries (sibling_hub_ids(),
-- 20260817_state_visibility.sql onward) and the process_*_retrieval RPC
-- family already authorizes cross-hub retrieval the same way (see
-- 20260925_top_up_and_retrieval_refund_approval.sql). But every one of
-- those checks hinges on both hub rows sharing the exact same `hubs.state`
-- string. sibling_hub_ids() was only ever made NULL-safe
-- (20260921_sibling_hub_ids_null_state_fix.sql,
-- 20260922_sibling_hub_ids_no_hub_guard.sql) -- never case/whitespace-safe,
-- a gap 20260930_normalize_lagos_hub_state.sql's own comment explicitly
-- called out and left unresolved. That migration is also a ONE-TIME
-- UPDATE with no self-healing: if it was never deployed, or a Lagos hub
-- row was created before Settings.tsx's client-side normalizeStateName()
-- fix (Settings.tsx:296-302) existed, "Lagos" vs "lagos" vs "Lagos " will
-- silently fall outside the grouping and every cross-hub retrieval on
-- that hub's entries gets rejected with "Not authorized to process a
-- retrieval for this entry's hub".
--
-- This migration closes the gap at the DB layer, which is authoritative
-- regardless of which UI/path wrote the hub row:
--   1. sibling_hub_ids() now compares lower(trim(state)) instead of the
--      raw column, for every table that uses it (retrieval RPCs, RLS on
--      cargo_entries/manifests/marketing_entries/package_entries/
--      expenses/corporate_clients, ledger search).
--   2. A BEFORE INSERT OR UPDATE trigger on hubs force-normalizes state to
--      'Lagos' for any row matching the same heuristic already
--      battle-tested in src/lib/lagosHubSync.ts and reused by
--      20260930_normalize_lagos_hub_state.sql -- so this pairing can't
--      drift again no matter how the row gets written.
--   3. Re-runs that same one-time UPDATE (idempotent, safe to repeat) so
--      current data is corrected immediately on deploy, without depending
--      on 20260930 having been applied correctly before.
-- =============================================================

-- ── 1. Case/whitespace-insensitive sibling_hub_ids() ──────────────────
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
    AND lower(trim(state)) IS NOT DISTINCT FROM (
      SELECT lower(trim(state)) FROM public.hubs WHERE id = public.current_user_hub_id()
    );
$$;

-- ── 2. Server-side backstop: hubs can't drift once written ────────────
CREATE OR REPLACE FUNCTION public.normalize_lagos_hub_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(NEW.name) LIKE '%lagos%'
     OR lower(NEW.code) IN ('los', 'hq')
     OR lower(NEW.name) LIKE '%head office%'
     OR lower(NEW.name) LIKE '%cargo station%'
  THEN
    NEW.state := 'Lagos';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_lagos_hub_state_trigger ON public.hubs;
CREATE TRIGGER normalize_lagos_hub_state_trigger
  BEFORE INSERT OR UPDATE ON public.hubs
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_lagos_hub_state();

-- ── 3. Fix any current drift immediately ───────────────────────────────
UPDATE public.hubs
SET state = 'Lagos'
WHERE state IS DISTINCT FROM 'Lagos'
  AND (
    lower(name) LIKE '%lagos%'
    OR lower(code) IN ('los', 'hq')
    OR lower(name) LIKE '%head office%'
    OR lower(name) LIKE '%cargo station%'
  );
