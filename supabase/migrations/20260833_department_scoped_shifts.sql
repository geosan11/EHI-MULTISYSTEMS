-- hub_shifts previously allowed only ONE open shift per hub, hub-wide,
-- shared across every revenue stream. Each department (Cargo, Package,
-- Marketing, Baggage, GAT) now Starts/Ends its own Day independently --
-- 'all' preserves the original hub-wide shift used by the unfiltered
-- Master Ledger (More -> Ledger) as its own separate lifecycle, so that
-- existing screen keeps behaving exactly as before.
ALTER TABLE public.hub_shifts
  ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT 'all'
  CHECK (department IN ('cargo', 'package', 'marketing', 'baggage', 'gat', 'all'));

-- Replace the old hub-only uniqueness guard with a hub+department one --
-- multiple departments at the same hub can now each have their own open
-- shift simultaneously, but still only one open shift per department.
DROP INDEX IF EXISTS public.hub_shifts_one_open_per_hub;
CREATE UNIQUE INDEX IF NOT EXISTS hub_shifts_one_open_per_hub_department
  ON public.hub_shifts (hub_id, department) WHERE status = 'open';
