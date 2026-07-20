-- Renamed from 20260816 -- this file's SELECT policy below calls
-- public.sibling_hub_ids(), which is only defined in
-- 20260817_state_visibility.sql. Migrations apply in filename order, so
-- this file must sort after 20260817 or CREATE POLICY fails with
-- "function public.sibling_hub_ids() does not exist" on a clean/re-run apply.

CREATE TABLE IF NOT EXISTS public.hub_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  sales_summary jsonb,
  opened_by text,
  closed_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one open shift per hub at a time. handleStartShift (EHIApp.tsx) has
-- a client-side check too, but that's racy on its own (two devices can both
-- pass the check before either write lands) -- this is the real guard.
CREATE UNIQUE INDEX IF NOT EXISTS hub_shifts_one_open_per_hub
  ON public.hub_shifts (hub_id) WHERE status = 'open';

-- RLS
ALTER TABLE public.hub_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hub-scoped read hub_shifts" ON public.hub_shifts;
CREATE POLICY "Hub-scoped read hub_shifts" ON public.hub_shifts FOR SELECT TO authenticated
  USING (hub_id = ANY(public.sibling_hub_ids()) OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Hub-scoped insert hub_shifts" ON public.hub_shifts;
CREATE POLICY "Hub-scoped insert hub_shifts" ON public.hub_shifts FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Hub-scoped update hub_shifts" ON public.hub_shifts;
CREATE POLICY "Hub-scoped update hub_shifts" ON public.hub_shifts FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
