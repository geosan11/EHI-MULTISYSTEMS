-- =============================================================
-- Normalize both Lagos hubs onto one canonical `state` value
-- =============================================================
-- hubs.state (supabase/migrations/20260706_full_schema.sql) is nullable
-- free text entered per-hub via Settings.tsx's Add Hub form, with no
-- validation. sibling_hub_ids() (20260817_state_visibility.sql, hardened
-- 20260921/20260922) already groups hubs sharing the SAME state value for
-- RLS visibility across cargo_entries/manifests/marketing_entries/
-- package_entries/expenses -- but its equality check is exact (NULL-safe,
-- not case/whitespace-safe), so "Lagos Air Cargo Station" and "EHI Head
-- Office Lagos" only actually get grouped together if their state columns
-- are byte-identical. Nothing has ever enforced that.
--
-- This retroactively fixes every past AND future transaction/entry tied to
-- either hub in one move -- grouping happens at the HUB level via
-- sibling_hub_ids(), not per-transaction, so normalizing these two rows is
-- sufficient; cargo_entries/manifests/marketing_entries/package_entries
-- themselves need no changes at all.
--
-- Same Lagos-identification heuristic already proven in
-- src/lib/lagosHubSync.ts:27 (a separate, pricing-sync-only mechanism --
-- reused here only for its battle-tested name/code matching, otherwise
-- unrelated). Intentionally broader than "exactly these 2 hubs today" so
-- it also catches a future Lagos hub added later.
UPDATE public.hubs
SET state = 'Lagos'
WHERE state IS DISTINCT FROM 'Lagos'
  AND (
    lower(name) LIKE '%lagos%'
    OR lower(code) IN ('los', 'hq')
    OR lower(name) LIKE '%head office%'
    OR lower(name) LIKE '%cargo station%'
  );
