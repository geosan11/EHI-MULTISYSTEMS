-- ============================================================
-- SCAN STATUS UPDATE RPC — fix cross-hub ARRIVE/DEPART/DELIVER no-op
-- ============================================================
-- cargo_entries/manifests/marketing_entries/package_entries.hub_id is set
-- once at intake to the ORIGIN hub and never reassigned as cargo physically
-- moves (confirmed: no UPDATE anywhere in the app ever touches hub_id).
-- The UPDATE RLS policy on these tables (20260708_hub_isolation_rls.sql)
-- only allows hub_id = current_user_hub_id() -- i.e. the row's *origin*
-- hub -- for ordinary operational roles (cargo_agent/baggage_agent/
-- marketing_agent aren't in is_hub_unrestricted()'s role list). SELECT was
-- already loosened to sibling_hub_ids() (20260817_state_visibility.sql) so
-- staff can see cross-hub cargo in their own state, but UPDATE was not.
--
-- scanLogic.ts's logScanEvent() never checked the {error} its raw
-- .update() calls returned, so the ARRIVE/DEPART/DELIVER scan of cargo at
-- any hub other than its origin hub -- the entire point of that workflow
-- -- silently matched zero rows: tracking_events still recorded the event
-- (its INSERT policy is permissive), the scan UI still showed success, but
-- cargo_entries.status (and everything downstream that reads it) never
-- moved. This RPC performs the status update with the same sibling-hub
-- authorization scope SELECT already grants, so the write succeeds
-- wherever the read already does, and raises a real, catchable error
-- instead of a silent RLS no-op when it doesn't.
-- ============================================================

CREATE OR REPLACE FUNCTION public.scan_update_entry_status(
  p_table text,             -- 'cargo_entries' | 'manifests' | 'marketing_entries' | 'package_entries'
  p_ref text,                -- entry_ref / transaction_id, OR awb_tag_number where that table supports it
  p_new_status text,
  p_set_pin_used boolean DEFAULT false   -- cargo_entries DELIVER only
)
RETURNS TABLE(
  found boolean,
  consignee_name text,
  consignee_phone text,
  sender_phone text,
  pickup_pin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id uuid;
  v_key text;
  v_name text;
  v_phone text;
  v_sender_phone text;
  v_pin text;
BEGIN
  IF p_table = 'cargo_entries' THEN
    SELECT hub_id, entry_ref, consignee_name, consignee_phone, sender_phone, pickup_pin
      INTO v_hub_id, v_key, v_name, v_phone, v_sender_phone, v_pin
      FROM public.cargo_entries
      WHERE entry_ref = p_ref OR awb_tag_number = p_ref
      LIMIT 1;
    IF v_key IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    IF NOT (v_hub_id IS NULL OR v_hub_id = ANY(public.sibling_hub_ids()) OR public.is_hub_unrestricted()) THEN
      RAISE EXCEPTION 'Not authorized to update this hub''s cargo';
    END IF;
    UPDATE public.cargo_entries
      SET status = p_new_status,
          pin_used_at = CASE WHEN p_set_pin_used THEN now() ELSE pin_used_at END
      WHERE entry_ref = v_key;

  ELSIF p_table = 'manifests' THEN
    SELECT hub_id, transaction_id, passenger_name, passenger_phone
      INTO v_hub_id, v_key, v_name, v_phone
      FROM public.manifests
      WHERE transaction_id = p_ref
      LIMIT 1;
    IF v_key IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    IF NOT (v_hub_id IS NULL OR v_hub_id = ANY(public.sibling_hub_ids()) OR public.is_hub_unrestricted()) THEN
      RAISE EXCEPTION 'Not authorized to update this hub''s manifest';
    END IF;
    UPDATE public.manifests SET status = p_new_status WHERE transaction_id = v_key;

  ELSIF p_table = 'marketing_entries' THEN
    SELECT hub_id, entry_ref, customer_name, customer_phone
      INTO v_hub_id, v_key, v_name, v_phone
      FROM public.marketing_entries
      WHERE entry_ref = p_ref OR awb_tag_number = p_ref
      LIMIT 1;
    IF v_key IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    IF NOT (v_hub_id IS NULL OR v_hub_id = ANY(public.sibling_hub_ids()) OR public.is_hub_unrestricted()) THEN
      RAISE EXCEPTION 'Not authorized to update this hub''s marketing entry';
    END IF;
    UPDATE public.marketing_entries SET status = p_new_status WHERE entry_ref = v_key;

  ELSIF p_table = 'package_entries' THEN
    SELECT hub_id, entry_ref, customer_name, customer_phone
      INTO v_hub_id, v_key, v_name, v_phone
      FROM public.package_entries
      WHERE entry_ref = p_ref
      LIMIT 1;
    IF v_key IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    IF NOT (v_hub_id IS NULL OR v_hub_id = ANY(public.sibling_hub_ids()) OR public.is_hub_unrestricted()) THEN
      RAISE EXCEPTION 'Not authorized to update this hub''s package entry';
    END IF;
    UPDATE public.package_entries SET status = p_new_status WHERE entry_ref = v_key;

  ELSE
    RAISE EXCEPTION 'Unknown table % for scan_update_entry_status', p_table;
  END IF;

  RETURN QUERY SELECT true, v_name, v_phone, v_sender_phone, v_pin;
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_update_entry_status(text, text, text, boolean) TO authenticated;
