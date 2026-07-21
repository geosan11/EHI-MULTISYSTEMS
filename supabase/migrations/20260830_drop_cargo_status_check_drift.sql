-- ============================================================
-- Remove the hand-added cargo_entries_status_check that drifted out of sync
-- with the app's status vocabulary. The base schema (20260706) defines
-- cargo_entries.status as free-text (DEFAULT 'Intake', no CHECK); this restores
-- that intent and unblocks records stuck on statuses like 'Retrieved'.
-- Done defensively for the sibling entry tables too (no-op if absent).
-- ============================================================

ALTER TABLE public.cargo_entries      DROP CONSTRAINT IF EXISTS cargo_entries_status_check;
ALTER TABLE public.manifests          DROP CONSTRAINT IF EXISTS manifests_status_check;
ALTER TABLE public.marketing_entries  DROP CONSTRAINT IF EXISTS marketing_entries_status_check;
ALTER TABLE public.package_entries    DROP CONSTRAINT IF EXISTS package_entries_status_check;

-- OPTIONAL (do NOT include unless you want DB-level validation): instead of
-- dropping, you could re-add a COMPLETE check. Left out on purpose -- the app
-- validates status in code and its status set evolves, so a narrow DB list is
-- exactly what caused this drift. If you ever want it, add every status the
-- app writes: Intake, Arrived, Departed, Dispatched, Received, Delivered,
-- Retrieved, Cancelled, Completed, Unmatched, Available, Active.
