-- More:GatPrintQueue is a new More-menu screen (src/lib/permissions.ts
-- STATIC_VIEWS) -- same backfill need as 20260805_backfill_view_overrides_content_types.sql.
-- Role list matches MORE_TAB_ROLES exactly (ledger access), since GAT has no
-- printers and any Lagos-hub agent who can see the ledger needs to be able
-- to batch-print for it at MMA2.

UPDATE public.user_profiles
SET view_overrides = (
  SELECT ARRAY(SELECT DISTINCT unnest(view_overrides || ARRAY['More:GatPrintQueue']))
)
WHERE view_overrides IS NOT NULL
  AND role IN ('super_admin', 'admin', 'accountant', 'auditor', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'office_work');
