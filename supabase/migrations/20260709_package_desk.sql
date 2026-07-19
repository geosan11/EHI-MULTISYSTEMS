-- ============================================================
-- PACKAGE & PARCEL DESK -- new business line, same pattern as
-- Cargo/Marketing/ValueJet but flat-fee (no weight-based rate calc).
-- Built hub-scoped from day one (unlike the original tables, which
-- needed a later RLS retrofit in 20260708_hub_isolation_rls.sql).
-- Depends on public.current_user_hub_id()/is_hub_unrestricted() from
-- that migration -- must run after it.
-- ============================================================

-- Continuous, atomically-allocated tracking numbers -- avoids the
-- client-side-random-number race condition class of bug found in the
-- Cargo AWB fallback path.
CREATE SEQUENCE IF NOT EXISTS public.package_tracking_seq START 1;

CREATE TABLE IF NOT EXISTS public.package_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_ref         text UNIQUE NOT NULL,
  customer_name     text NOT NULL,
  destination       text,
  content_type      text NOT NULL CHECK (content_type IN ('Package', 'Parcel')),
  amount            numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode      text CHECK (payment_mode IN ('Cash', 'POS', 'Transfer', 'Debt')),
  bank              text,
  payment_narration text,
  -- Lightweight debt tracking -- free-text debtor name (customer_name),
  -- no registered-client requirement, matching how the paper ledger works.
  debt_paid         boolean NOT NULL DEFAULT false,
  debt_paid_at      timestamptz,
  hub_id            uuid REFERENCES public.hubs(id),
  hub               text,
  entered_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_entries_hub_created_idx ON public.package_entries(hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS package_entries_debt_idx ON public.package_entries(payment_mode, debt_paid) WHERE payment_mode = 'Debt';

-- Daily Sales Analysis close, mirroring marketing_day_close's shape.
CREATE TABLE IF NOT EXISTS public.package_day_close (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id             uuid REFERENCES public.hubs(id),
  hub                text,
  date               date NOT NULL,
  total_sales        numeric(12,2) NOT NULL DEFAULT 0,
  cash_sales         numeric(12,2) NOT NULL DEFAULT 0,
  pos_sales          numeric(12,2) NOT NULL DEFAULT 0,
  transfer_sales     numeric(12,2) NOT NULL DEFAULT 0,
  debt_sales         numeric(12,2) NOT NULL DEFAULT 0,
  total_expenses     numeric(12,2) NOT NULL DEFAULT 0,
  balance_cash       numeric(12,2) NOT NULL DEFAULT 0,
  entry_count        integer NOT NULL DEFAULT 0,
  destination_counts jsonb NOT NULL DEFAULT '{}',
  closed_by          text,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, date)
);

CREATE OR REPLACE FUNCTION public.allocate_package_tracking()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'PKG-' || LPAD(nextval('public.package_tracking_seq')::text, 6, '0');
$$;

GRANT USAGE ON SEQUENCE public.package_tracking_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_package_tracking() TO authenticated;

ALTER TABLE public.package_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_day_close ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hub-scoped read package_entries"   ON public.package_entries FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert package_entries" ON public.package_entries;
CREATE POLICY "Hub-scoped insert package_entries" ON public.package_entries FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update package_entries" ON public.package_entries;
CREATE POLICY "Hub-scoped update package_entries" ON public.package_entries FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

CREATE POLICY "Hub-scoped read package_day_close"   ON public.package_day_close FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped upsert package_day_close" ON public.package_day_close;
CREATE POLICY "Hub-scoped upsert package_day_close" ON public.package_day_close FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update package_day_close" ON public.package_day_close;
CREATE POLICY "Hub-scoped update package_day_close" ON public.package_day_close FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
