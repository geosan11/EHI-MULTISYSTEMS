-- =============================================================
-- corporate_clients / corporate_route_rates / increment_corporate_debt:
-- upgrade from exact-hub matching to sibling_hub_ids() state-grouping
-- =============================================================
-- Every OTHER hub-scoped table (cargo_entries, manifests, marketing_
-- entries, package_entries, expenses) already uses sibling_hub_ids() so
-- staff at one hub can see records from any hub sharing the same `state`
-- (20260817_state_visibility.sql onward). corporate_clients/corporate_
-- route_rates/increment_corporate_debt were never upgraded to this pattern
-- -- they still do exact hub_id matching (20260716_security_hardening.sql,
-- 20260719_atomic_corporate_debt.sql). Concretely, with Lagos Air Cargo
-- Station and EHI Head Office Lagos both now tagged state='Lagos'
-- (20260930_normalize_lagos_hub_state.sql), a corporate client created
-- under one was still invisible to non-admin staff at the other -- so
-- OfficeWorkReconciliation.tsx's client-name matching (which needs the
-- full visible client roster) silently couldn't match that client's
-- entries at the sibling hub, and B2B gate-weighing billing
-- (increment_corporate_debt) would outright reject it. This is very
-- likely the concrete mechanism behind office-work revenue going unnoticed
-- at whichever Lagos station didn't originally create the client record.
-- =============================================================

DROP POLICY IF EXISTS "Hub-scoped read corporate_clients" ON public.corporate_clients;
CREATE POLICY "Hub-scoped read corporate_clients" ON public.corporate_clients FOR SELECT TO authenticated
  USING (hub_id = ANY(public.sibling_hub_ids()) OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Authenticated update corporate_clients" ON public.corporate_clients;
CREATE POLICY "Authenticated update corporate_clients" ON public.corporate_clients FOR UPDATE TO authenticated
  USING (hub_id = ANY(public.sibling_hub_ids()) OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Hub-scoped read corporate_route_rates" ON public.corporate_route_rates;
CREATE POLICY "Hub-scoped read corporate_route_rates" ON public.corporate_route_rates FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR corporate_client_id IN (
      SELECT id FROM public.corporate_clients WHERE hub_id = ANY(public.sibling_hub_ids()) OR hub_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.increment_corporate_debt(p_client_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_total numeric;
  v_client_hub uuid;
BEGIN
  SELECT hub_id INTO v_client_hub FROM public.corporate_clients WHERE id = p_client_id;
  IF v_client_hub IS NOT NULL
     AND v_client_hub <> ALL(public.sibling_hub_ids())
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to update this corporate client''s debt balance';
  END IF;

  UPDATE public.corporate_clients
  SET accumulated_monthly_debt = accumulated_monthly_debt + p_amount
  WHERE id = p_client_id
  RETURNING accumulated_monthly_debt INTO v_new_total;

  RETURN v_new_total;
END;
$$;
