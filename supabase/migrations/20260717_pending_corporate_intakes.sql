-- ============================================================
-- PENDING CORPORATE INTAKES — give Phase 1 gate intake a real server record
-- ============================================================
-- CargoForm.tsx's two-phase corporate workflow (Phase 1 "Log Field Intake"
-- at the gate, Phase 2 "Finalize Scale Weighing" once the verified weight
-- is known) stored Phase 1 records in localStorage ONLY -- despite the
-- app's own copy telling staff "Every pickup record entered here syncs
-- dynamically with our centralized database architecture." It didn't.
-- A cargo shipment physically received at the gate had zero server-side
-- record until Phase 2 finished on that SAME device/browser -- clearing
-- storage, or having a different staff member/device complete Phase 2,
-- silently lost the intake with no trace it ever existed.
--
-- Hub-scoped the same way as every other operational table (see
-- 20260708_hub_isolation_rls.sql) so a hub's pending gate intakes are
-- visible to any staff member at that hub, not just the device that
-- logged them.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_corporate_intakes (
  id                   text PRIMARY KEY,
  consignee            text NOT NULL,
  corporate_client_id  uuid REFERENCES public.corporate_clients(id) ON DELETE SET NULL,
  pieces               integer NOT NULL DEFAULT 1,
  route                text,
  content_type         text,
  airline              text,
  awb                  text NOT NULL,
  sender_phone         text,
  hub_id               uuid REFERENCES public.hubs(id),
  hub                  text,
  entered_by           text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_corporate_intakes_hub_created_idx
  ON public.pending_corporate_intakes(hub_id, created_at DESC);

REVOKE ALL ON TABLE public.pending_corporate_intakes FROM anon;
ALTER TABLE public.pending_corporate_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hub-scoped read pending_corporate_intakes"   ON public.pending_corporate_intakes;
DROP POLICY IF EXISTS "Hub-scoped insert pending_corporate_intakes" ON public.pending_corporate_intakes;
DROP POLICY IF EXISTS "Hub-scoped delete pending_corporate_intakes" ON public.pending_corporate_intakes;

DROP POLICY IF EXISTS "Hub-scoped read pending_corporate_intakes" ON public.pending_corporate_intakes;
CREATE POLICY "Hub-scoped read pending_corporate_intakes" ON public.pending_corporate_intakes FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert pending_corporate_intakes" ON public.pending_corporate_intakes FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
-- DELETE (not just insert/select) because Phase 2 finalization removes the
-- pending record once it's turned into a real cargo_entries row.
CREATE POLICY "Hub-scoped delete pending_corporate_intakes" ON public.pending_corporate_intakes FOR DELETE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
