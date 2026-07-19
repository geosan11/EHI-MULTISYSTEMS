-- ============================================================
-- HUB DATA ISOLATION — close the cross-hub data leak
-- ============================================================
-- Every operational table so far has been "USING (true)" for any
-- authenticated user — hub scoping only existed in application-level
-- .eq('hub_id', ...) filters, which anyone with devtools access can
-- bypass entirely. This migration enforces hub scoping at the database
-- level via RLS, so a staff member assigned to one hub can no longer
-- read or write another hub's cargo/financial records directly.
--
-- Roles that legitimately need cross-hub visibility (HQ oversight,
-- consolidated reporting, reconciliation) are exempted via
-- public.is_hub_unrestricted(), matching the same role set the React
-- app already uses client-side for admin-level views
-- (see EHIApp.tsx: ['super_admin','admin','accountant','auditor']).
--
-- tracking_events is intentionally left cross-hub-readable: it's the
-- shipment custody chain (ARRIVE/DEPART/DELIVER history), and a hub
-- receiving cargo legitimately needs to see events logged at the
-- cargo's *previous* hubs to know its full journey. Restricting SELECT
-- there by hub_id would break the "Track" lookup and wrong-destination
-- alert history features, which are explicitly cross-hub by design.
-- ============================================================

-- ── Helper functions (SECURITY DEFINER so they can read user_profiles
--    without recursing back into user_profiles' own RLS policies) ──
CREATE OR REPLACE FUNCTION public.current_user_hub_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT hub_id FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_hub_unrestricted()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.current_user_role() IN ('super_admin', 'admin', 'accountant', 'auditor');
$$;

-- ============================================================
-- USER_PROFILES — fix the self-privilege-escalation hole
-- ============================================================
-- The previous "Service role all profiles ... USING (true)" policy had
-- no `TO service_role` clause, so it silently applied to every
-- authenticated user -- letting any staff member update their own
-- role/hub_id via a direct client call. Role/hub_id changes must go
-- through the existing service-role server endpoints
-- (/api/admin/create-staff, /api/admin/update-staff); the policy below
-- only allows same-hub admins to edit non-sensitive fields (e.g.
-- toggling `active`) and explicitly blocks role/hub_id changing via
-- this path with a WITH CHECK guard.
DROP POLICY IF EXISTS "Service role all profiles" ON public.user_profiles;
CREATE POLICY "Service role all profiles" ON public.user_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users read own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users read own or same-hub profiles" ON public.user_profiles;
CREATE POLICY "Users read own or same-hub profiles" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR hub_id = public.current_user_hub_id()
    OR public.is_hub_unrestricted()
  );

DROP POLICY IF EXISTS "Admins update same-hub profiles" ON public.user_profiles;
CREATE POLICY "Admins update same-hub profiles" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (hub_id = public.current_user_hub_id() OR public.current_user_role() = 'super_admin')
  )
  WITH CHECK (
    role = (SELECT role FROM public.user_profiles p WHERE p.id = user_profiles.id)
    AND hub_id IS NOT DISTINCT FROM (SELECT hub_id FROM public.user_profiles p WHERE p.id = user_profiles.id)
  );

-- ============================================================
-- Hub-scoped operational tables
-- ============================================================

-- CARGO_ENTRIES
DROP POLICY IF EXISTS "Authenticated read cargo_entries"   ON public.cargo_entries;
DROP POLICY IF EXISTS "Authenticated insert cargo_entries" ON public.cargo_entries;
DROP POLICY IF EXISTS "Authenticated update cargo_entries" ON public.cargo_entries;
CREATE POLICY "Hub-scoped read cargo_entries"   ON public.cargo_entries FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert cargo_entries" ON public.cargo_entries;
CREATE POLICY "Hub-scoped insert cargo_entries" ON public.cargo_entries FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update cargo_entries" ON public.cargo_entries;
CREATE POLICY "Hub-scoped update cargo_entries" ON public.cargo_entries FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- MANIFESTS
DROP POLICY IF EXISTS "Authenticated read manifests"   ON public.manifests;
DROP POLICY IF EXISTS "Authenticated insert manifests" ON public.manifests;
DROP POLICY IF EXISTS "Authenticated update manifests" ON public.manifests;
CREATE POLICY "Hub-scoped read manifests"   ON public.manifests FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert manifests" ON public.manifests;
CREATE POLICY "Hub-scoped insert manifests" ON public.manifests FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update manifests" ON public.manifests;
CREATE POLICY "Hub-scoped update manifests" ON public.manifests FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- MARKETING_ENTRIES
DROP POLICY IF EXISTS "Authenticated read marketing_entries"   ON public.marketing_entries;
DROP POLICY IF EXISTS "Authenticated insert marketing_entries" ON public.marketing_entries;
DROP POLICY IF EXISTS "Authenticated update marketing_entries" ON public.marketing_entries;
CREATE POLICY "Hub-scoped read marketing_entries"   ON public.marketing_entries FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert marketing_entries" ON public.marketing_entries;
CREATE POLICY "Hub-scoped insert marketing_entries" ON public.marketing_entries FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update marketing_entries" ON public.marketing_entries;
CREATE POLICY "Hub-scoped update marketing_entries" ON public.marketing_entries FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- MARKETING_DAY_CLOSE
DROP POLICY IF EXISTS "Authenticated read marketing_day_close"   ON public.marketing_day_close;
DROP POLICY IF EXISTS "Authenticated upsert marketing_day_close" ON public.marketing_day_close;
DROP POLICY IF EXISTS "Authenticated update marketing_day_close" ON public.marketing_day_close;
CREATE POLICY "Hub-scoped read marketing_day_close"   ON public.marketing_day_close FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped upsert marketing_day_close" ON public.marketing_day_close;
CREATE POLICY "Hub-scoped upsert marketing_day_close" ON public.marketing_day_close FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update marketing_day_close" ON public.marketing_day_close;
CREATE POLICY "Hub-scoped update marketing_day_close" ON public.marketing_day_close FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- EXPENSES
DROP POLICY IF EXISTS "Authenticated read expenses"   ON public.expenses;
DROP POLICY IF EXISTS "Authenticated insert expenses" ON public.expenses;
CREATE POLICY "Hub-scoped read expenses"   ON public.expenses FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert expenses" ON public.expenses;
CREATE POLICY "Hub-scoped insert expenses" ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update expenses" ON public.expenses;
CREATE POLICY "Hub-scoped update expenses" ON public.expenses FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- EOD_RECORDS
DROP POLICY IF EXISTS "Authenticated read eod_records"   ON public.eod_records;
DROP POLICY IF EXISTS "Authenticated upsert eod_records" ON public.eod_records;
DROP POLICY IF EXISTS "Authenticated update eod_records" ON public.eod_records;
CREATE POLICY "Hub-scoped read eod_records"   ON public.eod_records FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped upsert eod_records" ON public.eod_records;
CREATE POLICY "Hub-scoped upsert eod_records" ON public.eod_records FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update eod_records" ON public.eod_records;
CREATE POLICY "Hub-scoped update eod_records" ON public.eod_records FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- EOD_LOCKS
DROP POLICY IF EXISTS "Authenticated read eod_locks"   ON public.eod_locks;
DROP POLICY IF EXISTS "Authenticated insert eod_locks" ON public.eod_locks;
CREATE POLICY "Hub-scoped read eod_locks"   ON public.eod_locks FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert eod_locks" ON public.eod_locks;
CREATE POLICY "Hub-scoped insert eod_locks" ON public.eod_locks FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- TAG_PRINT_LOG
DROP POLICY IF EXISTS "Authenticated read tag_print_log"   ON public.tag_print_log;
DROP POLICY IF EXISTS "Authenticated insert tag_print_log" ON public.tag_print_log;
CREATE POLICY "Hub-scoped read tag_print_log"   ON public.tag_print_log FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert tag_print_log" ON public.tag_print_log;
CREATE POLICY "Hub-scoped insert tag_print_log" ON public.tag_print_log FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- SUPPORT_TICKETS
DROP POLICY IF EXISTS "Authenticated read support_tickets"   ON public.support_tickets;
DROP POLICY IF EXISTS "Authenticated insert support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Authenticated update support_tickets" ON public.support_tickets;
CREATE POLICY "Hub-scoped read support_tickets"   ON public.support_tickets FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert support_tickets" ON public.support_tickets;
CREATE POLICY "Hub-scoped insert support_tickets" ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update support_tickets" ON public.support_tickets;
CREATE POLICY "Hub-scoped update support_tickets" ON public.support_tickets FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- AUDIT_LOG
DROP POLICY IF EXISTS "Authenticated read audit_log"   ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated insert audit_log" ON public.audit_log;
CREATE POLICY "Hub-scoped read audit_log"   ON public.audit_log FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert audit_log" ON public.audit_log;
CREATE POLICY "Hub-scoped insert audit_log" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- AIRLINE_LEDGER_ENTRIES
DROP POLICY IF EXISTS "Authenticated read airline_ledger"   ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Authenticated insert airline_ledger" ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Authenticated update airline_ledger" ON public.airline_ledger_entries;
CREATE POLICY "Hub-scoped read airline_ledger"   ON public.airline_ledger_entries FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert airline_ledger" ON public.airline_ledger_entries;
CREATE POLICY "Hub-scoped insert airline_ledger" ON public.airline_ledger_entries FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update airline_ledger" ON public.airline_ledger_entries;
CREATE POLICY "Hub-scoped update airline_ledger" ON public.airline_ledger_entries FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- CARGO_WEIGHT_MANIFESTS
DROP POLICY IF EXISTS "Authenticated read weight_manifest"   ON public.cargo_weight_manifests;
DROP POLICY IF EXISTS "Authenticated insert weight_manifest" ON public.cargo_weight_manifests;
DROP POLICY IF EXISTS "Authenticated update weight_manifest" ON public.cargo_weight_manifests;
DROP POLICY IF EXISTS "Authenticated delete weight_manifest" ON public.cargo_weight_manifests;
CREATE POLICY "Hub-scoped read weight_manifest"   ON public.cargo_weight_manifests FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert weight_manifest" ON public.cargo_weight_manifests;
CREATE POLICY "Hub-scoped insert weight_manifest" ON public.cargo_weight_manifests FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update weight_manifest" ON public.cargo_weight_manifests;
CREATE POLICY "Hub-scoped update weight_manifest" ON public.cargo_weight_manifests FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped delete weight_manifest" ON public.cargo_weight_manifests;
CREATE POLICY "Hub-scoped delete weight_manifest" ON public.cargo_weight_manifests FOR DELETE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
