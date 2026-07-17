-- ============================================================
-- COMBINED MIGRATION RUNNER -- generated 2026-07-14T06:47:06Z
-- Every migration in supabase/migrations/, concatenated in
-- chronological (filename) order. Every statement in every file
-- uses IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP ... IF EXISTS
-- guards, so this is safe to run even if some of these already
-- applied -- already-applied statements are no-ops, not errors.
--
-- HOW TO USE: open this file, copy everything below this header,
-- paste into Supabase Dashboard -> SQL Editor -> New query, Run.
-- After it finishes, reload the PostgREST schema cache:
-- Dashboard -> Settings -> API -> "Reload schema" button
-- (or run: NOTIFY pgrst, 'reload schema';  as a separate query).
-- Safe to delete this file afterward -- it's a one-time bundle,
-- not itself a tracked migration.
-- ============================================================


-- ============================================================
-- FILE: supabase/migrations/20260623_corporate_billing.sql
-- ============================================================
-- ==========================================
-- EHI MULTISYSTEMS - B2B CORPORATE BILLING MIGRATION
-- ==========================================
-- NOTE: this originally included a BEFORE INSERT trigger on a "shipments"
-- table that was never the real table name (the actual cargo table is
-- cargo_entries -- see 20260706_full_schema.sql) and used column names
-- (amount_to_pay, destination_route, is_corporate_account, cargo_weight_kg)
-- that don't match cargo_entries' real columns (amount, route, is_corporate,
-- total_kg) either. That trigger was dead on arrival: corporate/B2B billing
-- has always actually run client-side in CargoForm.tsx's
-- handleFinalizeWeighing, which looks up corporate_clients/
-- corporate_route_rates directly and writes the computed Transaction itself.
-- Removed the trigger entirely rather than leaving unreachable, broken SQL
-- blocking this migration from ever completing.

-- 1. Corporate Directory Table
CREATE TABLE IF NOT EXISTS corporate_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL UNIQUE,
    contact_phone VARCHAR(50),
    accumulated_monthly_debt NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Backfill columns for a corporate_clients table that already existed
-- with an older/different shape before this migration ran -- CREATE TABLE
-- IF NOT EXISTS above is a no-op in that case and leaves old columns as-is.
ALTER TABLE corporate_clients ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE corporate_clients ADD COLUMN IF NOT EXISTS accumulated_monthly_debt NUMERIC(12, 2) DEFAULT 0.00 NOT NULL;
ALTER TABLE corporate_clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL;

-- The pre-existing table may predate the inline UNIQUE on company_name
-- too (CREATE TABLE IF NOT EXISTS above wouldn't have added it), and the
-- seed INSERT below needs an actual unique constraint/index to match
-- against for its ON CONFLICT (company_name) clause -- otherwise Postgres
-- errors with "no unique or exclusion constraint matching ON CONFLICT".
CREATE UNIQUE INDEX IF NOT EXISTS corporate_clients_company_name_key ON corporate_clients (company_name);

-- 2. Corporate Route Rates Table (Mapping Custom Contract Rates)
CREATE TABLE IF NOT EXISTS corporate_route_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corporate_client_id UUID NOT NULL REFERENCES corporate_clients(id) ON DELETE CASCADE,
    route_name VARCHAR(100) NOT NULL,
    rate_per_kg NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_corporate_route UNIQUE (corporate_client_id, route_name)
);

ALTER TABLE corporate_route_rates ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE corporate_route_rates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL;

-- Same reasoning as corporate_clients above -- guarantee a unique index
-- exists to match the seed INSERT's ON CONFLICT target, regardless of
-- whether the inline CONSTRAINT ran (table may have pre-existed).
CREATE UNIQUE INDEX IF NOT EXISTS corporate_route_rates_client_route_key ON corporate_route_rates (corporate_client_id, route_name);

-- ==========================================
-- SEED SAMPLE CORPORATE DATA FOR THE CLIENTS
-- ==========================================

INSERT INTO corporate_clients (id, company_name, contact_phone, accumulated_monthly_debt) VALUES
('a37bfa51-ef78-43f1-bdca-b96ab3201402', 'Aramex', '08011223344', 154300.00),
('f021adff-89d2-4fe0-94f7-33a59df74fa2', 'SAHCO', '08022334455', 84000.00),
('3be177df-9831-419b-a01f-0e86a0ffccca', 'GlobaCom', '09033445566', 220000.00),
('da09de12-f0ef-4f11-bc66-3d719e782ea2', 'ZeemMax', '08044556677', 0.00)
ON CONFLICT (company_name) DO NOTHING;

-- Seed custom route-specific rates. Looked up by company_name rather than
-- hardcoded id: if a client row already existed under a different id before
-- this migration ran, the ON CONFLICT (company_name) DO NOTHING above skips
-- inserting these literal ids, and a hardcoded corporate_client_id here would
-- then violate the FK against whatever id the pre-existing row actually has.
INSERT INTO corporate_route_rates (corporate_client_id, route_name, rate_per_kg)
SELECT c.id, r.route_name, r.rate_per_kg
FROM (VALUES
  ('Aramex', 'ABV/Abuja', 600.00),
  ('Aramex', 'BNI/Benin', 400.00),
  ('Aramex', 'Lagos', 350.00),
  ('SAHCO', 'ABV/Abuja', 500.00),
  ('SAHCO', 'BNI/Benin', 420.00),
  ('GlobaCom', 'ABV/Abuja', 650.00),
  ('GlobaCom', 'PHC/Port Harcourt', 750.00)
) AS r(company_name, route_name, rate_per_kg)
JOIN corporate_clients c ON c.company_name = r.company_name
ON CONFLICT (corporate_client_id, route_name) DO NOTHING;


-- ============================================================
-- FILE: supabase/migrations/20260702_rate_limiting.sql
-- ============================================================
-- Distributed rate limiting for serverless API routes.
--
-- WHY THIS EXISTS: the previous rate limiter (server/app.ts) used an
-- in-memory Map keyed by IP. On Vercel, each concurrent serverless
-- invocation can get its own process with its own empty Map, so a
-- client spreading requests across concurrent invocations effectively
-- resets the counter every time -- the limiter was not actually
-- enforcing a global cap. This table + function make the counter
-- shared and atomic across every invocation via a single INSERT ...
-- ON CONFLICT DO UPDATE, which Postgres guarantees is race-free even
-- when two concurrent calls try to create the same brand-new key at
-- once.
--
-- Cost tradeoff: each check is now a network round trip to Supabase
-- (EU West, ~120ms from Lagos). Only apply this to low-frequency,
-- deliberate actions (admin routes, notification/AI sends) -- not to
-- hot-path UI interactions.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 0,
  reset_at  TIMESTAMPTZ NOT NULL
);

-- RLS enabled with NO policies defined below -- this is intentional, not
-- an oversight. It means the table is reachable only via the service-role
-- key (which bypasses RLS), matching how server/app.ts calls it. No
-- anon/authenticated client should ever query this table directly.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key       TEXT,
  p_max       INTEGER,
  p_window_ms INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now   TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
BEGIN
  -- Single atomic upsert — Postgres guarantees INSERT ... ON CONFLICT is
  -- race-free even when two concurrent calls try to create the same brand
  -- new key at once (unlike a separate SELECT FOR UPDATE + INSERT, which
  -- has a window where both calls can miss the row and both attempt INSERT).
  INSERT INTO public.rate_limits AS rl (key, count, reset_at)
  VALUES (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                   WHEN rl.reset_at <= v_now THEN 1
                   ELSE rl.count + 1
                 END,
        reset_at = CASE
                     WHEN rl.reset_at <= v_now THEN v_now + (p_window_ms || ' milliseconds')::interval
                     ELSE rl.reset_at
                   END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

-- Periodic cleanup so this table doesn't grow unbounded. Safe to run
-- from a cron/scheduled job, or just call occasionally -- deleting
-- expired rows is not time-sensitive.
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limits WHERE reset_at < clock_timestamp() - interval '1 hour';
$$;


-- ============================================================
-- FILE: supabase/migrations/20260702_scale_indexes.sql
-- ============================================================
-- Indexes for the query patterns actually used across this codebase.
-- Every one of these is derived from a real .eq()/.gte()/.lte()/.order()
-- call found in the current source, not a generic guess -- see the
-- comment above each block for where that pattern lives.
--
-- Not CONCURRENTLY: whatever runs this (Supabase migration tooling / the
-- SQL-query tool) wraps execution in a transaction block, and
-- CREATE INDEX CONCURRENTLY cannot run inside one. These tables don't carry
-- enough production traffic yet for the brief lock during index build to
-- matter; revisit with CONCURRENTLY run statement-by-statement outside a
-- transaction if that changes.
--
-- IF NOT EXISTS makes this safe to re-run if some of these already exist
-- from manual dashboard work.

-- cargo_entries: EHIApp.tsx fetchInitial does
--   .eq('hub_id', ...).gte('created_at', ...).lte('created_at', ...).order('created_at', desc)
-- and App.tsx's public tracking page does
--   .or('entry_ref.eq...,awb_tag_number.eq...')
CREATE INDEX IF NOT EXISTS idx_cargo_entries_hub_created
  ON public.cargo_entries (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_entries_entry_ref
  ON public.cargo_entries (entry_ref);
CREATE INDEX IF NOT EXISTS idx_cargo_entries_awb_tag
  ON public.cargo_entries (awb_tag_number);

-- manifests: same hub+date pattern, plus tracking lookups by transaction_id
CREATE INDEX IF NOT EXISTS idx_manifests_hub_created
  ON public.manifests (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifests_transaction_id
  ON public.manifests (transaction_id);

-- marketing_entries: same hub+date pattern, plus tracking lookups by entry_ref
CREATE INDEX IF NOT EXISTS idx_marketing_entries_hub_created
  ON public.marketing_entries (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_entries_entry_ref
  ON public.marketing_entries (entry_ref);

-- expenses: same hub+date pattern (EHIApp.tsx fetchInitial)
CREATE INDEX IF NOT EXISTS idx_expenses_hub_created
  ON public.expenses (hub_id, created_at DESC);

-- support_tickets: SupportTickets.tsx scopes non-admin reads to
-- .eq('user_id', ...) -- this is the exact fix from the last security
-- audit; the query is only correct AND fast with this index in place.
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
  ON public.support_tickets (user_id);

-- driver_trips: MyTrips.tsx does .eq('driver_id', ...).order('created_at', desc);
-- Dispatch.tsx does .eq('gps_enabled', true) -- partial index since that's
-- always queried as true, never false, so indexing only the true rows
-- keeps the index small as trip history grows.
CREATE INDEX IF NOT EXISTS idx_driver_trips_driver_created
  ON public.driver_trips (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_trips_gps_enabled
  ON public.driver_trips (driver_id) WHERE gps_enabled = true;


-- ============================================================
-- FILE: supabase/migrations/20260706_full_schema.sql
-- ============================================================
-- ============================================================
-- EHI MULTISYSTEMS LOGISTICS PLATFORM — FULL SCHEMA MIGRATION
-- Run this in Supabase SQL Editor (safe to re-run, uses IF NOT EXISTS)
-- Generated: 2026-07-06
-- ============================================================

-- ── 1. HUBS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hubs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  code      text UNIQUE NOT NULL,
  state     text,
  type      text NOT NULL DEFAULT 'airport' CHECK (type IN ('airport','transit','depot')),
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. USER PROFILES ───────────────────────────────────────
-- Mirrors auth.users; hub_id links to hubs table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN (
                  'super_admin','admin','cargo_agent','marketing_agent',
                  'vj_agent','scanner','driver','accountant','auditor','office_work')),
  hub_id        uuid REFERENCES public.hubs(id),
  hub_type      text,
  phone         text,
  active        boolean NOT NULL DEFAULT true,
  can_print_ledger boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Backfill columns that may be missing if the table pre-existed this migration
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS hub_type        text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS phone           text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS can_print_ledger boolean NOT NULL DEFAULT false;

-- ── 3. CARGO ENTRIES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cargo_entries (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_ref          text PRIMARY KEY,
  awb_tag_number     text UNIQUE,
  consignee_name     text NOT NULL,
  consignee_phone    text,
  sender_phone       text,
  airline            text,
  route              text,
  content_type       text,
  total_pcs          integer NOT NULL DEFAULT 1,
  total_kg           numeric(10,2) NOT NULL DEFAULT 0,
  amount             numeric(12,2) NOT NULL DEFAULT 0,
  receipt_mode       text CHECK (receipt_mode IN ('Cash','POS','Transfer','Debt')),
  bank               text,
  payment_narration  text,
  status             text NOT NULL DEFAULT 'Intake',
  hub_id             uuid REFERENCES public.hubs(id),
  hub                text,
  pickup_pin         text,
  pin_used_at        timestamptz,
  released_by        text,
  logged_by          text,
  entered_by         text,
  confirmed_by       text,
  confirmed_at       timestamptz,
  remark             text,               -- notes (e.g. "Sent by Road")
  is_corporate       boolean DEFAULT false,
  corporate_client_id uuid REFERENCES public.corporate_clients(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── 4. MANIFESTS (Value Jet / Excess Baggage) ──────────────
CREATE TABLE IF NOT EXISTS public.manifests (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id   text PRIMARY KEY,
  passenger_name   text NOT NULL,
  passenger_phone  text,
  pnr              text,
  flight_no        text,
  destination      text,
  excess_kg        numeric(10,2) NOT NULL DEFAULT 0,
  total_kg         numeric(10,2) NOT NULL DEFAULT 0,
  total_pcs        integer NOT NULL DEFAULT 1,
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode     text CHECK (payment_mode IN ('Cash','POS','Transfer','Debt')),
  bank             text,
  payment_narration text,
  status           text NOT NULL DEFAULT 'Intake',
  hub_id           uuid REFERENCES public.hubs(id),
  hub              text,
  entered_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 5. MARKETING ENTRIES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_entries (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_ref        text PRIMARY KEY,
  customer_name    text NOT NULL,
  customer_phone   text,
  route            text,
  qty_big_bag      integer NOT NULL DEFAULT 0,
  qty_med_bag      integer NOT NULL DEFAULT 0,
  qty_small_bag    integer NOT NULL DEFAULT 0,
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid      numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode     text CHECK (payment_mode IN ('Cash','Transfer','TransferCash','POS','Debt')),
  bank             text,
  payment_narration text,
  detail           text,
  mode             text,   -- legacy alias for payment_mode
  status           text NOT NULL DEFAULT 'Intake',
  hub_id           uuid REFERENCES public.hubs(id),
  hub              text,
  entered_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 6. MARKETING DAY CLOSE ─────────────────────────────────
-- One record per hub per day — the daily Arena Sales Analysis summary
CREATE TABLE IF NOT EXISTS public.marketing_day_close (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id               uuid REFERENCES public.hubs(id),
  hub                  text,
  date                 date NOT NULL,
  total_sales          numeric(12,2) NOT NULL DEFAULT 0,
  cash_sales           numeric(12,2) NOT NULL DEFAULT 0,
  transfer_sales       numeric(12,2) NOT NULL DEFAULT 0,
  transfer_cash_sales  numeric(12,2) NOT NULL DEFAULT 0,
  less_transfer        numeric(12,2) NOT NULL DEFAULT 0,
  less_transfer_label  text,
  debt_sales           numeric(12,2) NOT NULL DEFAULT 0,
  total_expenses       numeric(12,2) NOT NULL DEFAULT 0,
  balance_cash         numeric(12,2) NOT NULL DEFAULT 0,
  entry_count          integer NOT NULL DEFAULT 0,
  route_counts         jsonb NOT NULL DEFAULT '{}',
  closed_by            text,
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, date)
);

-- ── 7. EXPENSES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  description  text,
  hub_id       uuid REFERENCES public.hubs(id),
  hub          text,
  entered_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 8. EOD RECORDS ─────────────────────────────────────────
-- Stores the final locked totals for each hub's end-of-day
CREATE TABLE IF NOT EXISTS public.eod_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub              text,
  hub_id           uuid REFERENCES public.hubs(id),
  date             date NOT NULL,
  locked_by        text,
  cargo_total      numeric(12,2) NOT NULL DEFAULT 0,
  vj_total         numeric(12,2) NOT NULL DEFAULT 0,
  marketing_total  numeric(12,2) NOT NULL DEFAULT 0,
  gross_total      numeric(12,2) NOT NULL DEFAULT 0,
  cash_total       numeric(12,2) NOT NULL DEFAULT 0,
  transfer_total   numeric(12,2) NOT NULL DEFAULT 0,
  pos_total        numeric(12,2) NOT NULL DEFAULT 0,
  debt_total       numeric(12,2) NOT NULL DEFAULT 0,
  expense_total    numeric(12,2) NOT NULL DEFAULT 0,
  net_cash         numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'locked',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, date)
);

-- ── 9. EOD LOCKS ───────────────────────────────────────────
-- Lightweight lock record; eod_records holds the numbers
CREATE TABLE IF NOT EXISTS public.eod_locks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id     uuid REFERENCES public.hubs(id),
  hub        text,
  date       date NOT NULL,
  closed_by  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, date)
);

-- ── 10. TRACKING EVENTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_ref         text NOT NULL,
  event_type        text NOT NULL CHECK (event_type IN (
                      'ARRIVE','DEPART','WRONG_DESTINATION_ALERT','DELIVER','INTAKE')),
  hub_name          text,
  hub_id            uuid REFERENCES public.hubs(id),
  scanned_by_name   text,
  cargo_destination text,
  alert_reason      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 11. ROUTING HUBS ───────────────────────────────────────
-- Defines valid transit stops between origin and destination
CREATE TABLE IF NOT EXISTS public.routing_hubs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_hub       text NOT NULL,
  destination_hub  text NOT NULL,
  transit_hub      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_hub, destination_hub, transit_hub)
);

-- ── 12. AUDIT LOG ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id),
  user_name   text,
  action      text,
  table_name  text,
  record_id   text,
  description text,
  hub         text,
  hub_id      uuid REFERENCES public.hubs(id),
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 13. TAG PRINT LOG ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tag_print_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_ref        text NOT NULL,
  awb_tag_number   text,
  printed_by       uuid REFERENCES auth.users(id),
  printed_by_name  text,
  hub_id           uuid REFERENCES public.hubs(id),
  hub_name         text,
  print_method     text NOT NULL DEFAULT 'pdf',
  pieces_printed   integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 14. SUPPORT TICKETS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id),
  user_name    text,
  hub          text,
  hub_id       uuid REFERENCES public.hubs(id),
  subject      text NOT NULL,
  description  text,
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  resolved_at  timestamptz,
  resolved_by  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 15. PRICING CONFIG ─────────────────────────────────────
-- Generic key/value store for airline commissions, carrier toggles, etc.
CREATE TABLE IF NOT EXISTS public.pricing_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   text UNIQUE NOT NULL,
  config_value jsonb,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 16. STANDARD CARGO RATES ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.standard_cargo_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_name  text UNIQUE NOT NULL,
  rate_per_kg numeric(10,2) NOT NULL DEFAULT 500,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 17. CORPORATE CLIENTS (already in 20260623 migration) ──
-- Safe to run again — IF NOT EXISTS
CREATE TABLE IF NOT EXISTS public.corporate_clients (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name            text UNIQUE NOT NULL,
  contact_phone           text,
  accumulated_monthly_debt numeric(12,2) NOT NULL DEFAULT 0,
  hub_id                  uuid REFERENCES public.hubs(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ── 18. CORPORATE ROUTE RATES (already in 20260623 migration) ──
CREATE TABLE IF NOT EXISTS public.corporate_route_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_client_id uuid NOT NULL REFERENCES public.corporate_clients(id) ON DELETE CASCADE,
  route_name          text NOT NULL,
  rate_per_kg         numeric(10,2) NOT NULL DEFAULT 0,
  minimum_amount      numeric(10,2) NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_client_id, route_name)
);

-- ── 19. FLEET VEHICLES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate         text UNIQUE NOT NULL,
  make          text,
  model         text,
  vehicle_type  text,
  driver_name   text,
  capacity_kg   numeric(10,2),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  hub_id        uuid REFERENCES public.hubs(id),
  last_service  date,
  next_service  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 20. FUEL LOGS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_plate   text,
  litres          numeric(10,2),
  cost_per_litre  numeric(10,2),
  total_cost      numeric(12,2),
  station         text,
  logged_by       text,
  hub_id          uuid REFERENCES public.hubs(id),
  log_date        date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 21. DRIVER TRIPS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driver_trips (
  id              text PRIMARY KEY,
  driver_id       uuid REFERENCES auth.users(id),
  driver_name     text,
  hub             text,
  hub_id          uuid REFERENCES public.hubs(id),
  vehicle_plate   text,
  origin          text,
  destination     text,
  departure_time  timestamptz,
  arrival_time    timestamptz,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  cargo_refs      text[],
  gps_enabled     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 22. TRIP PINGS (GPS) ───────────────────────────────────
-- trip_id is text to match driver_trips.id (app uses string IDs for trips)
CREATE TABLE IF NOT EXISTS public.trip_pings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    text REFERENCES public.driver_trips(id) ON DELETE CASCADE,
  driver_id  uuid REFERENCES auth.users(id),
  lat        numeric(10,7),
  lng        numeric(10,7),
  accuracy   numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 23. RATE LIMITS (already in 20260702 migration) ────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key       text PRIMARY KEY,
  count     integer NOT NULL DEFAULT 0,
  reset_at  timestamptz NOT NULL
);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS cargo_entries_hub_created_idx   ON public.cargo_entries(hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cargo_entries_awb_idx           ON public.cargo_entries(awb_tag_number);
CREATE INDEX IF NOT EXISTS cargo_entries_status_idx        ON public.cargo_entries(status);
CREATE INDEX IF NOT EXISTS cargo_entries_entered_by_idx    ON public.cargo_entries(entered_by);

CREATE INDEX IF NOT EXISTS manifests_hub_created_idx       ON public.manifests(hub_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mkt_entries_hub_created_idx     ON public.marketing_entries(hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mkt_entries_mode_idx            ON public.marketing_entries(payment_mode);

CREATE INDEX IF NOT EXISTS tracking_events_cargo_ref_idx   ON public.tracking_events(cargo_ref);
CREATE INDEX IF NOT EXISTS tracking_events_created_idx     ON public.tracking_events(created_at DESC);

CREATE INDEX IF NOT EXISTS tag_print_log_cargo_ref_idx     ON public.tag_print_log(cargo_ref);
CREATE INDEX IF NOT EXISTS tag_print_log_hub_created_idx   ON public.tag_print_log(hub_id, created_at DESC);

CREATE INDEX IF NOT EXISTS expenses_hub_created_idx        ON public.expenses(hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_hub_created_idx       ON public.audit_log(hub_id, created_at DESC);

CREATE INDEX IF NOT EXISTS driver_trips_hub_idx            ON public.driver_trips(hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trip_pings_trip_id_idx          ON public.trip_pings(trip_id);

-- ============================================================
-- ROW LEVEL SECURITY — basic setup (customize per your policy)
-- ============================================================

ALTER TABLE public.cargo_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_day_close  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eod_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eod_locks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_print_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles        ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write their own hub data
-- (The app uses the Supabase anon key + service-role key for admin ops)
-- Note: DROP POLICY IF EXISTS used because CREATE POLICY has no IF NOT EXISTS in PostgreSQL

DROP POLICY IF EXISTS "Authenticated read cargo_entries"  ON public.cargo_entries;
DROP POLICY IF EXISTS "Authenticated insert cargo_entries" ON public.cargo_entries;
DROP POLICY IF EXISTS "Authenticated update cargo_entries" ON public.cargo_entries;
CREATE POLICY "Authenticated read cargo_entries"   ON public.cargo_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert cargo_entries" ON public.cargo_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update cargo_entries" ON public.cargo_entries FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read manifests"   ON public.manifests;
DROP POLICY IF EXISTS "Authenticated insert manifests" ON public.manifests;
DROP POLICY IF EXISTS "Authenticated update manifests" ON public.manifests;
CREATE POLICY "Authenticated read manifests"   ON public.manifests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert manifests" ON public.manifests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update manifests" ON public.manifests FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read marketing_entries"   ON public.marketing_entries;
DROP POLICY IF EXISTS "Authenticated insert marketing_entries" ON public.marketing_entries;
DROP POLICY IF EXISTS "Authenticated update marketing_entries" ON public.marketing_entries;
CREATE POLICY "Authenticated read marketing_entries"   ON public.marketing_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert marketing_entries" ON public.marketing_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update marketing_entries" ON public.marketing_entries FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read marketing_day_close"    ON public.marketing_day_close;
DROP POLICY IF EXISTS "Authenticated upsert marketing_day_close"  ON public.marketing_day_close;
DROP POLICY IF EXISTS "Authenticated update marketing_day_close"  ON public.marketing_day_close;
CREATE POLICY "Authenticated read marketing_day_close"   ON public.marketing_day_close FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated upsert marketing_day_close" ON public.marketing_day_close FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update marketing_day_close" ON public.marketing_day_close FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read expenses"   ON public.expenses;
DROP POLICY IF EXISTS "Authenticated insert expenses" ON public.expenses;
CREATE POLICY "Authenticated read expenses"   ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read eod_records"   ON public.eod_records;
DROP POLICY IF EXISTS "Authenticated upsert eod_records" ON public.eod_records;
DROP POLICY IF EXISTS "Authenticated update eod_records" ON public.eod_records;
CREATE POLICY "Authenticated read eod_records"   ON public.eod_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated upsert eod_records" ON public.eod_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update eod_records" ON public.eod_records FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read eod_locks"   ON public.eod_locks;
DROP POLICY IF EXISTS "Authenticated insert eod_locks" ON public.eod_locks;
CREATE POLICY "Authenticated read eod_locks"   ON public.eod_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert eod_locks" ON public.eod_locks FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read tracking_events"   ON public.tracking_events;
DROP POLICY IF EXISTS "Authenticated insert tracking_events" ON public.tracking_events;
CREATE POLICY "Authenticated read tracking_events"   ON public.tracking_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert tracking_events" ON public.tracking_events FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read tag_print_log"   ON public.tag_print_log;
DROP POLICY IF EXISTS "Authenticated insert tag_print_log" ON public.tag_print_log;
CREATE POLICY "Authenticated read tag_print_log"   ON public.tag_print_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert tag_print_log" ON public.tag_print_log FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read support_tickets"   ON public.support_tickets;
DROP POLICY IF EXISTS "Authenticated insert support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Authenticated update support_tickets" ON public.support_tickets;
CREATE POLICY "Authenticated read support_tickets"   ON public.support_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert support_tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update support_tickets" ON public.support_tickets FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read audit_log"   ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated insert audit_log" ON public.audit_log;
CREATE POLICY "Authenticated read audit_log"   ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert audit_log" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read hubs" ON public.hubs;
CREATE POLICY "Authenticated read hubs" ON public.hubs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users read own profile"    ON public.user_profiles;
DROP POLICY IF EXISTS "Service role all profiles" ON public.user_profiles;
CREATE POLICY "Users read own profile"    ON public.user_profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Service role all profiles" ON public.user_profiles FOR ALL USING (true);

-- ============================================================
-- SEED: Standard cargo rates (safe to run, ON CONFLICT ignores)
-- ============================================================

INSERT INTO public.standard_cargo_rates (route_name, rate_per_kg) VALUES
  ('LOS/Lagos',                    500),
  ('ABV/Abuja',                    700),
  ('PHC/Port Harcourt',            600),
  ('KAN/Kano',                     750),
  ('ENU/Enugu',                    550),
  ('ABB/Asaba',                    500),
  ('AKR/Akure',                    500),
  ('BCU/Bauchi',                   500),
  ('BNI/Benin City',               500),
  ('CBQ/Calabar',                  500),
  ('GMO/Gombe',                    500),
  ('IBA/Ibadan',                   500),
  ('ILR/Ilorin',                   500),
  ('KAD/Kaduna',                   650),
  ('MIU/Maiduguri',                500),
  ('QOW/Owerri',                   520),
  ('QUO/Uyo',                      500),
  ('QRW/Warri (Osubi Airstrip)',   520),
  ('YOL/Yola',                     500),
  ('Other',                        500)
ON CONFLICT (route_name) DO NOTHING;


-- ============================================================
-- FILE: supabase/migrations/20260707_ledger_manifest.sql
-- ============================================================
-- ============================================================
-- Airline Balance Ledger + Cargo Weight Manifest tables
-- Safe to re-run (IF NOT EXISTS everywhere)
-- ============================================================

-- ── 1. AIRLINE LEDGER ENTRIES ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.airline_ledger_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline     text NOT NULL,
  entry_type  text NOT NULL CHECK (entry_type IN ('Credit', 'Debit', 'Cheque Raise')),
  amount      numeric(14,2) NOT NULL DEFAULT 0,
  description text,
  reference   text,
  entry_date  date NOT NULL DEFAULT CURRENT_DATE,
  hub_id      uuid REFERENCES public.hubs(id),
  hub         text,
  entered_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS airline_ledger_airline_date_idx
  ON public.airline_ledger_entries(airline, entry_date);
CREATE INDEX IF NOT EXISTS airline_ledger_hub_idx
  ON public.airline_ledger_entries(hub_id);

-- ── 2. CARGO WEIGHT MANIFESTS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cargo_weight_manifests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_date  date NOT NULL DEFAULT CURRENT_DATE,
  airline        text NOT NULL,
  flight_number  text,
  route          text NOT NULL,
  total_pieces   integer NOT NULL DEFAULT 0,
  total_kg       numeric(10,2) NOT NULL DEFAULT 0,
  verified       boolean NOT NULL DEFAULT false,
  verified_by    text,
  verified_at    timestamptz,
  hub_id         uuid REFERENCES public.hubs(id),
  hub            text,
  notes          text,
  entered_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weight_manifest_date_hub_idx
  ON public.cargo_weight_manifests(manifest_date, hub_id);
CREATE INDEX IF NOT EXISTS weight_manifest_airline_idx
  ON public.cargo_weight_manifests(airline);

-- ── 3. RLS ────────────────────────────────────────────────────
ALTER TABLE public.airline_ledger_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_weight_manifests   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read airline_ledger"   ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Authenticated insert airline_ledger" ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Authenticated update airline_ledger" ON public.airline_ledger_entries;
CREATE POLICY "Authenticated read airline_ledger"   ON public.airline_ledger_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert airline_ledger" ON public.airline_ledger_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update airline_ledger" ON public.airline_ledger_entries FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read weight_manifest"   ON public.cargo_weight_manifests;
DROP POLICY IF EXISTS "Authenticated insert weight_manifest" ON public.cargo_weight_manifests;
DROP POLICY IF EXISTS "Authenticated update weight_manifest" ON public.cargo_weight_manifests;
DROP POLICY IF EXISTS "Authenticated delete weight_manifest" ON public.cargo_weight_manifests;
CREATE POLICY "Authenticated read weight_manifest"   ON public.cargo_weight_manifests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert weight_manifest" ON public.cargo_weight_manifests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update weight_manifest" ON public.cargo_weight_manifests FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete weight_manifest" ON public.cargo_weight_manifests FOR DELETE TO authenticated USING (true);


-- ============================================================
-- FILE: supabase/migrations/20260707_wrong_destination_resolution.sql
-- ============================================================
-- Wrong-destination alerts need a resolution trail (who cleared it, when) and
-- the hub the cargo was last legitimately seen at, so the alert view can show
-- "came from X, wrongly scanned at Y, belongs at Z" instead of destination only.
ALTER TABLE public.tracking_events
  ADD COLUMN IF NOT EXISTS previous_hub text,
  ADD COLUMN IF NOT EXISTS resolved      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by   text,
  ADD COLUMN IF NOT EXISTS resolved_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_tracking_events_wrong_destination_unresolved
  ON public.tracking_events (created_at DESC)
  WHERE event_type = 'WRONG_DESTINATION_ALERT' AND resolved = false;


-- ============================================================
-- FILE: supabase/migrations/20260708_cargo_commission_rate.sql
-- ============================================================
-- Airline commission % was being recomputed at report time using the
-- CURRENT pricing_config rate against historical cargo transactions, so
-- editing a commission rate today silently rewrote what was owed to the
-- airline on every past transaction. Lock the rate in at entry time.
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2);


-- ============================================================
-- FILE: supabase/migrations/20260708_expenses_approval_columns.sql
-- ============================================================
-- The app has been writing date/time/logged_by/logged_by_id/status/
-- requires_approval on every expense insert since it was built, but the
-- expenses table from 20260706_full_schema.sql never had those columns --
-- meaning those inserts have been failing against Supabase and silently
-- falling back to the offline queue. This also adds the approval audit
-- trail (approved_by/approved_at/rejected_by/rejected_at) needed to make
-- the Approve/Reject buttons in ExpensesTab actually do something.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS date              date,
  ADD COLUMN IF NOT EXISTS time              text,
  ADD COLUMN IF NOT EXISTS logged_by         text,
  ADD COLUMN IF NOT EXISTS logged_by_id      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'approved'
                                              CHECK (status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by       text,
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by       text,
  ADD COLUMN IF NOT EXISTS rejected_at       timestamptz;

CREATE INDEX IF NOT EXISTS expenses_status_idx ON public.expenses(status);


-- ============================================================
-- FILE: supabase/migrations/20260708_hub_isolation_rls.sql
-- ============================================================
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
DROP POLICY IF EXISTS "Hub-scoped read cargo_entries" ON public.cargo_entries;
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
DROP POLICY IF EXISTS "Hub-scoped read manifests" ON public.manifests;
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
DROP POLICY IF EXISTS "Hub-scoped read marketing_entries" ON public.marketing_entries;
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
DROP POLICY IF EXISTS "Hub-scoped read marketing_day_close" ON public.marketing_day_close;
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
DROP POLICY IF EXISTS "Hub-scoped read expenses" ON public.expenses;
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
DROP POLICY IF EXISTS "Hub-scoped read eod_records" ON public.eod_records;
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
DROP POLICY IF EXISTS "Hub-scoped read eod_locks" ON public.eod_locks;
CREATE POLICY "Hub-scoped read eod_locks"   ON public.eod_locks FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert eod_locks" ON public.eod_locks;
CREATE POLICY "Hub-scoped insert eod_locks" ON public.eod_locks FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- TAG_PRINT_LOG
DROP POLICY IF EXISTS "Authenticated read tag_print_log"   ON public.tag_print_log;
DROP POLICY IF EXISTS "Authenticated insert tag_print_log" ON public.tag_print_log;
DROP POLICY IF EXISTS "Hub-scoped read tag_print_log" ON public.tag_print_log;
CREATE POLICY "Hub-scoped read tag_print_log"   ON public.tag_print_log FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert tag_print_log" ON public.tag_print_log;
CREATE POLICY "Hub-scoped insert tag_print_log" ON public.tag_print_log FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- SUPPORT_TICKETS
DROP POLICY IF EXISTS "Authenticated read support_tickets"   ON public.support_tickets;
DROP POLICY IF EXISTS "Authenticated insert support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Authenticated update support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Hub-scoped read support_tickets" ON public.support_tickets;
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
DROP POLICY IF EXISTS "Hub-scoped read audit_log" ON public.audit_log;
CREATE POLICY "Hub-scoped read audit_log"   ON public.audit_log FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert audit_log" ON public.audit_log;
CREATE POLICY "Hub-scoped insert audit_log" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- AIRLINE_LEDGER_ENTRIES
DROP POLICY IF EXISTS "Authenticated read airline_ledger"   ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Authenticated insert airline_ledger" ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Authenticated update airline_ledger" ON public.airline_ledger_entries;
DROP POLICY IF EXISTS "Hub-scoped read airline_ledger" ON public.airline_ledger_entries;
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
DROP POLICY IF EXISTS "Hub-scoped read weight_manifest" ON public.cargo_weight_manifests;
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


-- ============================================================
-- FILE: supabase/migrations/20260709_package_desk.sql
-- ============================================================
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

DROP POLICY IF EXISTS "Hub-scoped read package_entries" ON public.package_entries;
CREATE POLICY "Hub-scoped read package_entries"   ON public.package_entries FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped insert package_entries" ON public.package_entries;
CREATE POLICY "Hub-scoped insert package_entries" ON public.package_entries FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update package_entries" ON public.package_entries;
CREATE POLICY "Hub-scoped update package_entries" ON public.package_entries FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Hub-scoped read package_day_close" ON public.package_day_close;
CREATE POLICY "Hub-scoped read package_day_close"   ON public.package_day_close FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped upsert package_day_close" ON public.package_day_close;
CREATE POLICY "Hub-scoped upsert package_day_close" ON public.package_day_close FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
DROP POLICY IF EXISTS "Hub-scoped update package_day_close" ON public.package_day_close;
CREATE POLICY "Hub-scoped update package_day_close" ON public.package_day_close FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());


-- ============================================================
-- FILE: supabase/migrations/20260710_bank_reconciliations.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_type     text NOT NULL,
  file_name     text,
  run_by        text,
  run_by_id     uuid REFERENCES auth.users(id),
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  total_credits numeric(12,2) NOT NULL DEFAULT 0,
  bank_tx_snapshot jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Authenticated read bank_reconciliations" ON public.bank_reconciliations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated insert bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Authenticated insert bank_reconciliations" ON public.bank_reconciliations FOR INSERT TO authenticated WITH CHECK (true);


-- ============================================================
-- FILE: supabase/migrations/20260710_client_type_column.sql
-- ============================================================
ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));


-- ============================================================
-- FILE: supabase/migrations/20260710_debt_payment_columns.sql
-- ============================================================
-- cargo_entries and manifests use "amount" as their sale-amount column, so
-- adding "amount_paid" here is safe and unambiguous.
ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- marketing_entries ALREADY has an "amount_paid" column (see
-- 20260706_full_schema.sql), and per this app's convention that column
-- holds the transaction's actual sale amount (Transaction.amount is read
-- from amount_paid for marketing rows) -- "amount" itself sits unused.
-- Reusing amount_paid here for partial-debt-repayment tracking would
-- silently overwrite the real sale amount every time a debt payment is
-- recorded, so marketing debt repayments get their own column instead.
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS debt_amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;


-- ============================================================
-- FILE: supabase/migrations/20260710_eod_cash_register_columns.sql
-- ============================================================
-- AccountingConsole's Cash Register tab kept its own opening-balance /
-- physical-count / lock state in localStorage, disconnected from
-- eod_records (the table EODReconciliation.tsx already reads/writes for
-- the real EOD lock). eod_records has no columns for these yet, so add
-- them here rather than introduce a second naming convention.
ALTER TABLE public.eod_records
  ADD COLUMN IF NOT EXISTS opening_balance numeric(12,2),
  ADD COLUMN IF NOT EXISTS physical_count  numeric(12,2);


-- ============================================================
-- FILE: supabase/migrations/20260710_expenses_id_text.sql
-- ============================================================
-- expenses.id was uuid, but the app always sends its own client-generated
-- id (format EX-YYMMDD-XXXXXX) via uid('EX'). Every insert has therefore
-- been rejected by Postgres with "invalid input syntax for type uuid",
-- silently swallowed by writeWithOfflineSupport as if it were an offline
-- write. Switching id to text so the app's own id is the real primary key.
ALTER TABLE public.expenses ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.expenses ALTER COLUMN id TYPE text USING id::text;


-- ============================================================
-- FILE: supabase/migrations/20260710_expenses_mode_column.sql
-- ============================================================
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS mode text,
  ADD COLUMN IF NOT EXISTS bank text;


-- ============================================================
-- FILE: supabase/migrations/20260710_hub_awb_counters.sql
-- ============================================================
-- Per-hub atomic AWB sequence generator. Previous AWB generation had no
-- hub identity embedded and no server-side uniqueness guarantee (a
-- client-random 6-digit number, only checked for collision after the
-- fact). This gives every hub its own independent, gap-free, race-safe
-- counter, starting at 1001 (so the first AWB reads 001001 once
-- formatted) -- existing entries' already-generated AWB numbers are
-- untouched; this only governs new entries going forward.
CREATE TABLE IF NOT EXISTS public.hub_awb_counters (
  hub_code TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 1000
);

ALTER TABLE public.hub_awb_counters ENABLE ROW LEVEL SECURITY;
-- RLS enabled with no policies is intentional -- accessed only via
-- the function below, never queried directly by client code.

CREATE OR REPLACE FUNCTION public.next_awb_number(p_hub_code TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO public.hub_awb_counters (hub_code, last_number)
  VALUES (p_hub_code, 1001)
  ON CONFLICT (hub_code) DO UPDATE
    SET last_number = hub_awb_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_awb_number(TEXT) TO authenticated;


-- ============================================================
-- FILE: supabase/migrations/20260711_marketing_pricing_and_vj_settings.sql
-- ============================================================
-- Two pieces of pricing config were 100% localStorage-only with zero
-- server sync: the VJ excess-baggage free-allowance/rate, and the
-- Marketing BB/MB/SB route pricing matrix (the latter was also being
-- edited from two separate screens -- PricingConfiguration.tsx and
-- Settings.tsx -- each writing the same localStorage key independently
-- with no shared source of truth). Neither ever crossed devices at all.

-- VJ settings piggyback on the existing pricing_config key/value store
-- (same pattern as airline_commissions) since it's just two numbers.
-- No schema change needed there -- just a new config_key row, written
-- by the app.

-- Marketing BB/MB/SB pricing is a real per-route table, not a flat
-- map, so it gets its own table (mirrors standard_cargo_rates' shape).
CREATE TABLE IF NOT EXISTS public.marketing_route_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_name  text UNIQUE NOT NULL,
  bb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  mb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  sb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_route_rates ENABLE ROW LEVEL SECURITY;
-- Not hub-scoped -- pricing is company-wide config, deliberately visible
-- and editable the same way from every hub, matching standard_cargo_rates
-- and pricing_config's existing (also non-hub-scoped) access pattern.
DROP POLICY IF EXISTS "Authenticated read marketing_route_rates"   ON public.marketing_route_rates;
DROP POLICY IF EXISTS "Authenticated upsert marketing_route_rates" ON public.marketing_route_rates;
DROP POLICY IF EXISTS "Authenticated update marketing_route_rates" ON public.marketing_route_rates;
CREATE POLICY "Authenticated read marketing_route_rates"   ON public.marketing_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated upsert marketing_route_rates" ON public.marketing_route_rates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update marketing_route_rates" ON public.marketing_route_rates FOR UPDATE TO authenticated USING (true);

-- Seed with the same defaults the app currently hardcodes client-side,
-- so switching over doesn't blank out existing configured-looking values.
INSERT INTO public.marketing_route_rates (route_name, bb_rate, mb_rate, sb_rate) VALUES
  ('LOS/Lagos - ABV/Abuja', 18000, 12000, 7500),
  ('LOS/Lagos - PHC/Port Harcourt', 22000, 15000, 9500),
  ('ABV/Abuja - LOS/Lagos', 18000, 12000, 7500),
  ('PHC/Port Harcourt - LOS/Lagos', 22000, 15000, 9500),
  ('LOS/Lagos - ENU/Enugu', 19500, 13000, 8000)
ON CONFLICT (route_name) DO NOTHING;


-- ============================================================
-- FILE: supabase/migrations/20260712_dedup_deliver_events.sql
-- ============================================================
-- A cargo_ref should never be marked DELIVER more than once — it's the
-- terminal state of the tracking lifecycle. This closes the race where two
-- staff release the same consignment (e.g. one via QR scan, one via the
-- Arrivals PIN-release screen) at nearly the same time and both writes pass
-- their app-level "already delivered?" check before either has committed.
--
-- ARRIVE/DEPART are intentionally left unconstrained here: cargo can
-- legitimately pass through the same hub more than once (transit loops,
-- returns), so a blanket unique index on those would reject valid scans.

-- Existing data can already contain duplicate DELIVER rows for the same
-- cargo_ref (this is the exact race the index below prevents going forward),
-- and the unique index creation fails outright if any duplicates remain.
-- Keep the earliest DELIVER per cargo_ref (the real delivery) and drop the
-- later duplicate(s) before adding the constraint. Safe to re-run — it's a
-- no-op once no duplicates remain.
DELETE FROM public.tracking_events t
USING (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY cargo_ref ORDER BY created_at ASC) AS rn
  FROM public.tracking_events
  WHERE event_type = 'DELIVER'
) dup
WHERE t.id = dup.id AND dup.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS tracking_events_one_deliver_per_cargo
  ON public.tracking_events (cargo_ref)
  WHERE event_type = 'DELIVER';


-- ============================================================
-- FILE: supabase/migrations/20260712_marketing_route_rates_unique_fix.sql
-- ============================================================
-- Standalone/idempotent re-run of 20260711_marketing_pricing_and_vj_settings.sql.
-- That migration apparently never completed against this database (the
-- table doesn't exist at all here), so this recreates it from scratch
-- rather than assuming it's already there in some shape. If the table
-- *does* already exist (e.g. created by 20260711 succeeding after all,
-- just without the route_name UNIQUE constraint sticking), the explicit
-- CREATE UNIQUE INDEX IF NOT EXISTS below still guarantees the ON CONFLICT
-- target exists either way.
CREATE TABLE IF NOT EXISTS public.marketing_route_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_name  text UNIQUE NOT NULL,
  bb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  mb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  sb_rate     numeric(10,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_route_rates_route_name_key
  ON public.marketing_route_rates (route_name);

ALTER TABLE public.marketing_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read marketing_route_rates"   ON public.marketing_route_rates;
DROP POLICY IF EXISTS "Authenticated upsert marketing_route_rates" ON public.marketing_route_rates;
DROP POLICY IF EXISTS "Authenticated update marketing_route_rates" ON public.marketing_route_rates;
CREATE POLICY "Authenticated read marketing_route_rates"   ON public.marketing_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated upsert marketing_route_rates" ON public.marketing_route_rates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update marketing_route_rates" ON public.marketing_route_rates FOR UPDATE TO authenticated USING (true);

INSERT INTO public.marketing_route_rates (route_name, bb_rate, mb_rate, sb_rate) VALUES
  ('LOS/Lagos - ABV/Abuja', 18000, 12000, 7500),
  ('LOS/Lagos - PHC/Port Harcourt', 22000, 15000, 9500),
  ('ABV/Abuja - LOS/Lagos', 18000, 12000, 7500),
  ('PHC/Port Harcourt - LOS/Lagos', 22000, 15000, 9500),
  ('LOS/Lagos - ENU/Enugu', 19500, 13000, 8000)
ON CONFLICT (route_name) DO NOTHING;


-- ============================================================
-- FILE: supabase/migrations/20260713_proof_of_delivery_table.sql
-- ============================================================
-- Proof of Delivery was previously local-device-only (IndexedDB via Dexie),
-- so a signature captured on one phone was invisible to every other device
-- and lost entirely if that device's browser storage was ever cleared. This
-- gives it a real home in Supabase, synced the same offline-first way as
-- cargo_entries/manifests/etc: write locally first (instant, works offline),
-- then upsert to Supabase immediately or via the background sync_queue retry
-- if the network isn't available at that moment.
CREATE TABLE IF NOT EXISTS public.proof_of_delivery (
  id                    text PRIMARY KEY,
  awb_number            text NOT NULL,
  consignee_name        text NOT NULL,
  delivered_by          text NOT NULL,
  received_by_name      text NOT NULL,
  received_by_phone     text,
  received_by_id_type   text,
  received_by_id_number text,
  signature_data        text NOT NULL,
  photo_data            text,
  delivered_at          timestamptz NOT NULL,
  hub_name              text NOT NULL,
  notes                 text,
  gps_latitude          double precision,
  gps_longitude         double precision,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proof_of_delivery_awb_idx ON public.proof_of_delivery(awb_number);
CREATE INDEX IF NOT EXISTS proof_of_delivery_delivered_at_idx ON public.proof_of_delivery(delivered_at DESC);

ALTER TABLE public.proof_of_delivery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read proof_of_delivery"   ON public.proof_of_delivery;
DROP POLICY IF EXISTS "Authenticated insert proof_of_delivery" ON public.proof_of_delivery;
CREATE POLICY "Authenticated read proof_of_delivery"   ON public.proof_of_delivery FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert proof_of_delivery" ON public.proof_of_delivery FOR INSERT TO authenticated WITH CHECK (true);


-- ============================================================
-- FILE: supabase/migrations/20260714_peek_awb_number.sql
-- ============================================================
-- Non-destructive "preview" of the next AWB/tag number for a given
-- per-hub counter key. Unlike next_awb_number(), this does NOT increment
-- the counter -- it only reads the current last_number and reports what
-- the next call to next_awb_number() would return right now. This lets
-- the UI show a real, accurate-looking tag to the agent before they
-- submit, without burning a real sequence number just because a form was
-- opened and then abandoned or reset. The actual number is only consumed
-- by next_awb_number() at submit time, so whichever agent actually
-- submits first gets it; a later submitter transparently gets the next
-- one after that -- no gaps from mere page loads, only from entries that
-- were genuinely never completed after already calling next_awb_number().
CREATE OR REPLACE FUNCTION public.peek_next_awb_number(p_hub_code TEXT)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT last_number FROM public.hub_awb_counters WHERE hub_code = p_hub_code),
    1000
  ) + 1;
$$;

GRANT EXECUTE ON FUNCTION public.peek_next_awb_number(TEXT) TO authenticated;


-- ============================================================
-- FILE: supabase/migrations/20260715_cargo_entries_corporate_client_id.sql
-- ============================================================
-- Corporate B2B gate-weighing transactions had no way to be reliably
-- attributed back to which corporate client they belonged to. The rate
-- calculation only ever matched by company_name (a mutable, editable
-- field) against the intake's freeform consignee text, and that match
-- was never persisted onto the finalized transaction at all -- meaning
-- there was no durable way to query "all transactions for Corporate
-- Client X" for billing summaries/reporting, and a client rename between
-- intake and finalize could silently break the rate lookup too.
--
-- The app now captures the corporate client's stable ID at intake time
-- and carries it through onto the finalized transaction. This column is
-- where that ID actually persists in Supabase.
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS corporate_client_id text;

CREATE INDEX IF NOT EXISTS idx_cargo_entries_corporate_client_id
  ON public.cargo_entries (corporate_client_id)
  WHERE corporate_client_id IS NOT NULL;


-- ============================================================
-- FILE: supabase/migrations/20260716_security_hardening.sql
-- ============================================================
-- ============================================================
-- SECURITY HARDENING — close every gap found in a full audit of
-- RLS coverage, the deactivated-user path, and cross-hub exposure.
-- Safe to re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout).
-- ============================================================
--
-- Three separate problems, fixed together because they compound:
--
-- 1. Nine tables were created with NO RLS enabled at all: corporate_clients,
--    corporate_route_rates, pricing_config, standard_cargo_rates,
--    driver_trips, trip_pings, fleet_vehicles, fuel_logs, routing_hubs.
--    The Supabase anon key is bundled client-side by design (same as any
--    anon key) -- on a table with RLS off, that key reads/writes every
--    row and column directly via the REST API, with zero regard for what
--    the app's own UI shows or restricts. corporate_clients/
--    corporate_route_rates is the worst of these: negotiated per-client
--    freight rates and running debt balances, fully exposed.
--
-- 2. Deactivating a staff member (user_profiles.active = false) was only
--    checked at signIn() -- an already-issued session/refresh token kept
--    working through every RLS policy indefinitely, since none of them
--    checked `active` either. Fixed once, centrally: current_user_hub_id()
--    and current_user_role() (the SECURITY DEFINER helpers every hub-scoped
--    policy in 20260708_hub_isolation_rls.sql calls) now both return NULL
--    for a deactivated user, which correctly fails every dependent policy
--    closed without having to touch each of those policies individually.
--    A deactivated user can still read their OWN user_profiles row (that
--    policy checks auth.uid() = id directly, unaffected by this change) --
--    intentional, since the client needs that read to detect `active:
--    false` and force a sign-out (see src/lib/auth.ts getSession()).
--
-- 3. bank_reconciliations and proof_of_delivery had RLS enabled but with
--    "USING (true) TO authenticated" -- any staff member at any hub could
--    read every other hub's bank reconciliation runs and delivery proofs
--    (signatures/photos/GPS/ID numbers). Tightened to match how the app
--    actually gates these features client-side.
--
-- Also included: the public /track page's anon-role access is made
-- explicit and column-restricted at the database level (see bottom
-- section) -- it was previously relying entirely on the app's own
-- .select() column list for column restriction, which a direct REST call
-- bypassing the app entirely could ignore completely.
-- ============================================================

-- ============================================================
-- PART 1 — deactivated users lose access everywhere, automatically
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_hub_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT hub_id FROM public.user_profiles WHERE id = auth.uid() AND active = true;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid() AND active = true;
$$;

-- is_hub_unrestricted() is unchanged (defined in 20260708_hub_isolation_rls.sql)
-- but automatically inherits this fix since it calls current_user_role().

-- ============================================================
-- PART 2 — RLS for the nine tables that had none
-- ============================================================

-- CORPORATE_CLIENTS
-- Read: hub-scoped (matches cargo_entries pattern). Insert: PricingConfiguration.tsx
-- is the only Supabase INSERT path and is gated to super_admin client-side --
-- matched here at the DB layer too. Update: CargoForm.tsx's gate-weighing flow
-- updates accumulated_monthly_debt for any authenticated agent finishing a
-- corporate transaction, so that stays broadly authenticated.
REVOKE ALL ON TABLE public.corporate_clients FROM anon;
ALTER TABLE public.corporate_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read corporate_clients"    ON public.corporate_clients;
DROP POLICY IF EXISTS "Super admin insert corporate_clients" ON public.corporate_clients;
DROP POLICY IF EXISTS "Authenticated update corporate_clients" ON public.corporate_clients;
CREATE POLICY "Hub-scoped read corporate_clients" ON public.corporate_clients FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Super admin insert corporate_clients" ON public.corporate_clients FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'super_admin');
CREATE POLICY "Authenticated update corporate_clients" ON public.corporate_clients FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- CORPORATE_ROUTE_RATES — no hub_id column of its own; scoped via its
-- corporate_client_id FK. Writes only ever happen from PricingConfiguration.tsx
-- (super_admin-gated).
REVOKE ALL ON TABLE public.corporate_route_rates FROM anon;
ALTER TABLE public.corporate_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read corporate_route_rates"   ON public.corporate_route_rates;
DROP POLICY IF EXISTS "Super admin insert corporate_route_rates" ON public.corporate_route_rates;
DROP POLICY IF EXISTS "Super admin update corporate_route_rates" ON public.corporate_route_rates;
CREATE POLICY "Hub-scoped read corporate_route_rates" ON public.corporate_route_rates FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR corporate_client_id IN (
      SELECT id FROM public.corporate_clients WHERE hub_id = public.current_user_hub_id() OR hub_id IS NULL
    )
  );
CREATE POLICY "Super admin insert corporate_route_rates" ON public.corporate_route_rates FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'super_admin');
CREATE POLICY "Super admin update corporate_route_rates" ON public.corporate_route_rates FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin');

-- PRICING_CONFIG — genuinely global (airline commissions, VJ settings), read
-- broadly by every entry form. CargoForm.tsx writes a new entry here for any
-- cargo agent adding a custom "Other" airline, so writes stay broadly
-- authenticated too (RLS's job here is only to block anon, not to add a
-- role restriction the app doesn't already have).
REVOKE ALL ON TABLE public.pricing_config FROM anon;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read pricing_config"   ON public.pricing_config;
DROP POLICY IF EXISTS "Authenticated insert pricing_config" ON public.pricing_config;
DROP POLICY IF EXISTS "Authenticated update pricing_config" ON public.pricing_config;
CREATE POLICY "Authenticated read pricing_config"   ON public.pricing_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert pricing_config" ON public.pricing_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update pricing_config" ON public.pricing_config FOR UPDATE TO authenticated USING (true);

-- STANDARD_CARGO_RATES — read broadly (every cargo entry needs it for
-- pricing), but the only write path (PricingConfiguration.tsx) is gated to
-- super_admin client-side -- matched here.
REVOKE ALL ON TABLE public.standard_cargo_rates FROM anon;
ALTER TABLE public.standard_cargo_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read standard_cargo_rates"  ON public.standard_cargo_rates;
DROP POLICY IF EXISTS "Super admin insert standard_cargo_rates"  ON public.standard_cargo_rates;
DROP POLICY IF EXISTS "Super admin update standard_cargo_rates"  ON public.standard_cargo_rates;
CREATE POLICY "Authenticated read standard_cargo_rates" ON public.standard_cargo_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin insert standard_cargo_rates" ON public.standard_cargo_rates FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'super_admin');
CREATE POLICY "Super admin update standard_cargo_rates" ON public.standard_cargo_rates FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin');

-- DRIVER_TRIPS — hub-scoped, same pattern as cargo_entries. Any authenticated
-- driver creates/updates their own trips via MyTrips.tsx.
REVOKE ALL ON TABLE public.driver_trips FROM anon;
ALTER TABLE public.driver_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read driver_trips"   ON public.driver_trips;
DROP POLICY IF EXISTS "Hub-scoped insert driver_trips" ON public.driver_trips;
DROP POLICY IF EXISTS "Hub-scoped update driver_trips" ON public.driver_trips;
CREATE POLICY "Hub-scoped read driver_trips"   ON public.driver_trips FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert driver_trips" ON public.driver_trips FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped update driver_trips" ON public.driver_trips FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- TRIP_PINGS (live GPS) — no hub_id of its own; scoped via its trip_id FK
-- to driver_trips. Insert-only from the app (pings are never edited).
REVOKE ALL ON TABLE public.trip_pings FROM anon;
ALTER TABLE public.trip_pings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read trip_pings"   ON public.trip_pings;
DROP POLICY IF EXISTS "Hub-scoped insert trip_pings" ON public.trip_pings;
CREATE POLICY "Hub-scoped read trip_pings" ON public.trip_pings FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR trip_id IN (SELECT id FROM public.driver_trips WHERE hub_id = public.current_user_hub_id() OR hub_id IS NULL)
  );
CREATE POLICY "Hub-scoped insert trip_pings" ON public.trip_pings FOR INSERT TO authenticated
  WITH CHECK (
    public.is_hub_unrestricted()
    OR trip_id IN (SELECT id FROM public.driver_trips WHERE hub_id = public.current_user_hub_id() OR hub_id IS NULL)
  );

-- FLEET_VEHICLES / FUEL_LOGS — hub-scoped, same pattern. Fleet.tsx (the only
-- writer) is already admin-gated client-side; hub-scoping at the DB layer is
-- at least as tight and keeps this consistent with every other table here.
REVOKE ALL ON TABLE public.fleet_vehicles FROM anon;
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read fleet_vehicles"   ON public.fleet_vehicles;
DROP POLICY IF EXISTS "Hub-scoped insert fleet_vehicles" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "Hub-scoped update fleet_vehicles" ON public.fleet_vehicles;
CREATE POLICY "Hub-scoped read fleet_vehicles"   ON public.fleet_vehicles FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert fleet_vehicles" ON public.fleet_vehicles FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped update fleet_vehicles" ON public.fleet_vehicles FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

REVOKE ALL ON TABLE public.fuel_logs FROM anon;
ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Hub-scoped read fuel_logs"   ON public.fuel_logs;
DROP POLICY IF EXISTS "Hub-scoped insert fuel_logs" ON public.fuel_logs;
DROP POLICY IF EXISTS "Hub-scoped update fuel_logs" ON public.fuel_logs;
CREATE POLICY "Hub-scoped read fuel_logs"   ON public.fuel_logs FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert fuel_logs" ON public.fuel_logs FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped update fuel_logs" ON public.fuel_logs FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

-- ROUTING_HUBS — non-sensitive reference data (valid transit-hub routes),
-- same treatment as the `hubs` table itself: readable by any authenticated
-- user. No client code path writes this table today, so no write policy is
-- added (locked to service_role / direct DB access only).
REVOKE ALL ON TABLE public.routing_hubs FROM anon;
ALTER TABLE public.routing_hubs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read routing_hubs" ON public.routing_hubs;
CREATE POLICY "Authenticated read routing_hubs" ON public.routing_hubs FOR SELECT TO authenticated USING (true);

-- ============================================================
-- PART 3 — hub/role-scope the two tables that were "any authenticated
-- user, any hub, USING (true)"
-- ============================================================

-- BANK_RECONCILIATIONS — no hub_id column (bank accounts are company-wide,
-- not per-hub), so the only meaningful restriction is by role. The app's
-- own nav gate (More.tsx: canAccessRecon) already limits this feature to
-- super_admin/accountant -- matched here so the restriction holds even
-- against a direct API call.
REVOKE ALL ON TABLE public.bank_reconciliations FROM anon;
DROP POLICY IF EXISTS "Authenticated read bank_reconciliations"   ON public.bank_reconciliations;
DROP POLICY IF EXISTS "Authenticated insert bank_reconciliations" ON public.bank_reconciliations;
DROP POLICY IF EXISTS "Recon-role read bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Recon-role read bank_reconciliations" ON public.bank_reconciliations FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'accountant'));
DROP POLICY IF EXISTS "Recon-role insert bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Recon-role insert bank_reconciliations" ON public.bank_reconciliations FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('super_admin', 'accountant'));

-- PROOF_OF_DELIVERY — has hub_name (text, no FK) instead of hub_id; scoped
-- by matching it against the current user's own hub name via the hubs
-- table. Insert stays open (WITH CHECK true) -- a driver capturing a
-- signature always writes their own current hub_name, and this only needed
-- to close the read-side cross-hub leak (any staffer could browse every
-- other hub's delivery signatures/photos/ID numbers).
REVOKE ALL ON TABLE public.proof_of_delivery FROM anon;
DROP POLICY IF EXISTS "Authenticated read proof_of_delivery"   ON public.proof_of_delivery;
DROP POLICY IF EXISTS "Authenticated insert proof_of_delivery" ON public.proof_of_delivery;
DROP POLICY IF EXISTS "Hub-scoped read proof_of_delivery" ON public.proof_of_delivery;
CREATE POLICY "Hub-scoped read proof_of_delivery" ON public.proof_of_delivery FOR SELECT TO authenticated
  USING (
    public.is_hub_unrestricted()
    OR hub_name = (SELECT name FROM public.hubs WHERE id = public.current_user_hub_id())
  );
CREATE POLICY "Authenticated insert proof_of_delivery" ON public.proof_of_delivery FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- PART 4 — explicit, column-restricted anon read access for the public
-- /track page (src/App.tsx PublicTrackingPage)
-- ============================================================
-- cargo_entries/manifests/marketing_entries/tracking_events already have
-- RLS enabled with authenticated-only policies (20260708_hub_isolation_rls.sql)
-- -- meaning anon currently gets ZERO rows from any of them as written. If
-- the live /track page is working today, a permissive anon policy exists
-- in the dashboard that was never captured in a migration; this section
-- makes that access explicit, in-repo, and -- critically -- restricted to
-- exactly the columns the app displays via column-level GRANTs, not just
-- the app's own .select() list. PostgREST resolves an unqualified
-- select=* into the full column list from its schema cache and Postgres
-- rejects any column beyond what's been granted, so a handcrafted request
-- against the REST API directly (bypassing the app's column choices
-- entirely) still can never retrieve amount, receipt_mode, bank,
-- entered_by, scanned_by_name, etc. RLS below only controls which ROWS
-- anon can see; the REVOKE/GRANT pair is what actually caps the columns.

REVOKE ALL ON TABLE public.cargo_entries FROM anon;
GRANT SELECT (entry_ref, awb_tag_number, consignee_name, route, content_type, total_kg, total_pcs, status)
  ON public.cargo_entries TO anon;
DROP POLICY IF EXISTS "Anon read cargo_entries for tracking" ON public.cargo_entries;
CREATE POLICY "Anon read cargo_entries for tracking" ON public.cargo_entries
  FOR SELECT TO anon USING (true);

REVOKE ALL ON TABLE public.marketing_entries FROM anon;
GRANT SELECT (entry_ref, customer_name, route, status)
  ON public.marketing_entries TO anon;
DROP POLICY IF EXISTS "Anon read marketing_entries for tracking" ON public.marketing_entries;
CREATE POLICY "Anon read marketing_entries for tracking" ON public.marketing_entries
  FOR SELECT TO anon USING (true);

REVOKE ALL ON TABLE public.manifests FROM anon;
GRANT SELECT (transaction_id, passenger_name, destination, excess_kg, total_kg, total_pcs, status)
  ON public.manifests TO anon;
DROP POLICY IF EXISTS "Anon read manifests for tracking" ON public.manifests;
CREATE POLICY "Anon read manifests for tracking" ON public.manifests
  FOR SELECT TO anon USING (true);

-- tracking_events additionally restricted at the ROW level, not just
-- columns: WRONG_DESTINATION_ALERT rows (internal ops-only -- who scanned
-- it, the wrong destination it was headed to, the alert reason) must never
-- be fetchable by anon, even via a handcrafted request that skips the
-- app's own .in('event_type', [...]) filter. cargo_ref is granted (but not
-- selected by the app) because PostgREST/Postgres requires column-level
-- SELECT privilege on anything referenced in a WHERE/eq filter, not only
-- the returned columns.
REVOKE ALL ON TABLE public.tracking_events FROM anon;
GRANT SELECT (cargo_ref, event_type, hub_name, created_at)
  ON public.tracking_events TO anon;
DROP POLICY IF EXISTS "Anon read tracking_events for delivery history" ON public.tracking_events;
CREATE POLICY "Anon read tracking_events for delivery history" ON public.tracking_events
  FOR SELECT TO anon
  USING (event_type IN ('DEPART', 'ARRIVE', 'DELIVER'));


-- ============================================================
-- FILE: supabase/migrations/20260717_pending_corporate_intakes.sql
-- ============================================================
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

CREATE POLICY "Hub-scoped read pending_corporate_intakes" ON public.pending_corporate_intakes FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
CREATE POLICY "Hub-scoped insert pending_corporate_intakes" ON public.pending_corporate_intakes FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
-- DELETE (not just insert/select) because Phase 2 finalization removes the
-- pending record once it's turned into a real cargo_entries row.
CREATE POLICY "Hub-scoped delete pending_corporate_intakes" ON public.pending_corporate_intakes FOR DELETE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());


-- ============================================================
-- FILE: supabase/migrations/20260718_package_tracking.sql
-- ============================================================
-- Package/Parcel was built as a flat-fee walk-in service with no
-- status/transit tracking. Confirmed it should travel hub-to-hub like
-- Cargo, so bring it in line: add status, and grant anon the same
-- column-restricted public-tracking read the other three streams got
-- in 20260716_security_hardening.sql.

ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Intake';

-- Column-restricted anon read, matching the pattern for
-- cargo_entries/manifests/marketing_entries in 20260716_security_hardening.sql.
-- No separate awb_tag_number column exists here -- entry_ref IS the
-- unified tag number for this stream, so it's the only ref column granted.
REVOKE ALL ON TABLE public.package_entries FROM anon;
GRANT SELECT (entry_ref, customer_name, destination, content_type, status)
  ON public.package_entries TO anon;
DROP POLICY IF EXISTS "Anon read package_entries for tracking" ON public.package_entries;
CREATE POLICY "Anon read package_entries for tracking" ON public.package_entries
  FOR SELECT TO anon USING (true);


-- ============================================================
-- FILE: supabase/migrations/20260719_atomic_corporate_debt.sql
-- ============================================================
-- Atomic corporate debt balance increment. CargoForm.tsx's corporate
-- gate-weighing finalize previously read accumulated_monthly_debt from a
-- client-side cache, added the new charge in JS, and wrote back the
-- absolute total -- a classic read-modify-write race. Two staff finalizing
-- different shipments for the SAME corporate client near-simultaneously
-- both read the same stale balance, and whichever write landed second
-- silently overwrote the first's increment (the individual cargo/ledger
-- transactions themselves stayed correct -- only the running debt total
-- on corporate_clients drifted). A single UPDATE ... SET col = col + x is
-- atomic under Postgres row locking: concurrent calls serialize correctly,
-- the second always adds on top of the first's already-applied result,
-- the same pattern next_awb_number() already uses for AWB sequences.
--
-- SECURITY DEFINER bypasses RLS, so the hub-scoping the direct-UPDATE RLS
-- policy on corporate_clients already enforces (20260716_security_hardening.sql)
-- is re-checked explicitly inside the function instead of silently
-- becoming more permissive than the policy it replaces for this one path.
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
     AND v_client_hub <> public.current_user_hub_id()
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

GRANT EXECUTE ON FUNCTION public.increment_corporate_debt(uuid, numeric) TO authenticated;


-- ============================================================
-- FILE: supabase/migrations/20260719_package_payment_columns.sql
-- ============================================================
-- handleUpdateTx (src/components/EHIApp.tsx) resolves a Transaction's
-- target table generically and writes amount_paid/payment_history/
-- payment_confirmed/pos_approval_code/confirmed_by/confirmed_at
-- unconditionally, regardless of which table it resolved to. package_entries
-- was missing every one of these columns (it only ever had the simpler
-- debt_paid/debt_paid_at boolean from 20260709_package_desk.sql), which is
-- why editing a package transaction, recording a debt payment against it in
-- DebtorsTab, or confirming a package Transfer payment in PaymentValidation
-- all silently failed to persist once the 'package' type-routing bug in
-- handleUpdateTx was fixed to actually target this table. Mirrors
-- 20260710_debt_payment_columns.sql's treatment of cargo_entries/manifests
-- (amount_paid/payment_history) plus cargo_entries' confirmed_by/confirmed_at
-- (20260706_full_schema.sql) so package_entries reaches full column parity.

ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS payment_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS pos_approval_code text;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;


-- ============================================================
-- FILE: supabase/migrations/20260720_marketing_bag_weights.sql
-- ============================================================
-- Marketing entries only ever recorded bag *counts* (qty_big_bag/qty_med_bag/
-- qty_small_bag), never weight -- but airlines bill/fly cargo by kg, not bag
-- count, so there was no way to reconcile a marketing entry against what the
-- airline actually charged. Add a kg figure per bag category, same numeric
-- shape as cargo_entries.total_kg.
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS bb_kg numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS mb_kg numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS sb_kg numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS total_kg numeric(10,2) GENERATED ALWAYS AS (bb_kg + mb_kg + sb_kg) STORED;


-- ============================================================
-- FILE: supabase/migrations/20260721_marketing_awb_tag_number.sql
-- ============================================================
-- Marketing entries generate a sequential tag/AWB number (EHI-{HUB}-MK-{seq})
-- that gets printed on the physical bag tag and encoded in its QR code --
-- but marketing_entries never had a column to persist it, so the only
-- reference actually stored (entry_ref) is a different, internally-generated
-- random id the customer never sees. A customer scanning their tag's QR
-- code, or typing the AWB printed on it, into the public /track page always
-- got "No shipment found" because that value was never in the database at
-- all under any column.
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS awb_tag_number text;
CREATE INDEX IF NOT EXISTS idx_marketing_entries_awb_tag_number ON public.marketing_entries (awb_tag_number);

-- Extend the public-tracking anon grant from 20260716_security_hardening.sql
-- to include the new column, so /track can search and display it the same
-- way it already does for cargo_entries.awb_tag_number.
REVOKE ALL ON TABLE public.marketing_entries FROM anon;
GRANT SELECT (entry_ref, awb_tag_number, customer_name, route, status)
  ON public.marketing_entries TO anon;


-- ============================================================
-- FILE: supabase/migrations/20260722_package_weight_and_contents.sql
-- ============================================================
-- Package/Parcel was built flat-fee with no piece count, weight, or
-- contents description at all -- every other stream (Cargo, Marketing,
-- ValueJet) captures these, but Package never did, so staff had nowhere to
-- log them and the public tracking page always showed "-" for Weight/
-- Pieces on a package entry. content_type stays exactly as-is (it's a
-- CHECK-constrained 'Package'/'Parcel' service class, not a contents
-- description) -- these are new, separate columns.
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS total_pcs integer NOT NULL DEFAULT 1;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS total_kg  numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.package_entries ADD COLUMN IF NOT EXISTS contents  text;

-- Extend the public-tracking anon grant from 20260718_package_tracking.sql
-- to include the new columns.
REVOKE ALL ON TABLE public.package_entries FROM anon;
GRANT SELECT (entry_ref, customer_name, destination, content_type, total_pcs, total_kg, contents, status)
  ON public.package_entries TO anon;


-- ============================================================
-- FILE: supabase/migrations/20260723_excess_baggage_airlines.sql
-- ============================================================
-- ValueJet's excess-baggage ticketing was a single hardcoded airline
-- (fixed VK flight prefix, fixed 23kg/₦1000 pricing, one 'vj_agent' role,
-- one 'VJ POS' tab). EHI is onboarding more airlines that bill excess
-- baggage the same way, so this generalizes the whole path: a real
-- registry table instead of a one-off config row, a plain `airline`
-- column on manifests so the table can hold every carrier's tickets
-- (mirrors how cargo_entries already holds Arik/Green Africa/United
-- Nigeria in one table via its own `airline` column), and a generic
-- `baggage_agent` role with a per-user assigned airline replacing the
-- single-purpose `vj_agent` role.

-- ── Excess-baggage airline registry ────────────────────────
CREATE TABLE IF NOT EXISTS public.excess_baggage_airlines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text UNIQUE NOT NULL,
  flight_prefix      text NOT NULL,
  tag_code           text UNIQUE NOT NULL,
  free_allowance_kg  numeric(10,2) NOT NULL DEFAULT 0,
  rate_per_kg        numeric(10,2) NOT NULL DEFAULT 0,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.excess_baggage_airlines ENABLE ROW LEVEL SECURITY;
-- Not hub-scoped -- company-wide config, same access pattern as
-- pricing_config/standard_cargo_rates/marketing_route_rates.
DROP POLICY IF EXISTS "Authenticated read excess_baggage_airlines"   ON public.excess_baggage_airlines;
DROP POLICY IF EXISTS "Authenticated insert excess_baggage_airlines" ON public.excess_baggage_airlines;
DROP POLICY IF EXISTS "Authenticated update excess_baggage_airlines" ON public.excess_baggage_airlines;
CREATE POLICY "Authenticated read excess_baggage_airlines"   ON public.excess_baggage_airlines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert excess_baggage_airlines" ON public.excess_baggage_airlines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update excess_baggage_airlines" ON public.excess_baggage_airlines FOR UPDATE TO authenticated USING (true);

-- Seed ValueJet as the first configured airline, carrying over its
-- existing free-allowance/rate from pricing_config.vj_settings so
-- switching over doesn't silently change anyone's live pricing.
INSERT INTO public.excess_baggage_airlines (name, flight_prefix, tag_code, free_allowance_kg, rate_per_kg)
SELECT
  'ValueJet',
  'VK',
  'VJ',
  COALESCE((SELECT (config_value->>'freeKg')::numeric FROM public.pricing_config WHERE config_key = 'vj_settings'), 23),
  COALESCE((SELECT (config_value->>'ratePerKg')::numeric FROM public.pricing_config WHERE config_key = 'vj_settings'), 1000)
ON CONFLICT (name) DO NOTHING;

-- ── manifests: support more than one carrier in the same table ─────
ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS airline text NOT NULL DEFAULT 'ValueJet';

-- ── Generalize the vj_agent role into baggage_agent + assigned_airline ─
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS assigned_airline text;

-- Ordering matters here: the constraint must be DROPPED before the data
-- migrates (the existing CHECK allows 'vj_agent' but not 'baggage_agent',
-- so writing the new role value first would violate it) and the new
-- constraint must be ADDED only after the data migrates (ADD CONSTRAINT
-- validates every existing row immediately, and the new list no longer
-- contains 'vj_agent' -- adding it first would fail against any row not
-- yet migrated off that value). Drop -> migrate data -> add is the only
-- ordering where neither step fails.
--
-- Looked up by querying the catalog rather than assuming Postgres's
-- default auto-generated name (`user_profiles_role_check`) -- if the
-- original migration ever named it explicitly or Postgres picked a
-- different name, a hardcoded DROP CONSTRAINT IF EXISTS would silently
-- no-op, leave the real constraint in place, and the UPDATE below would
-- then fail against it.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'user_profiles'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%role%vj_agent%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_profiles DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

UPDATE public.user_profiles SET assigned_airline = 'ValueJet' WHERE role = 'vj_agent';
UPDATE public.user_profiles SET role = 'baggage_agent' WHERE role = 'vj_agent';

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (role IN (
  'super_admin','admin','cargo_agent','marketing_agent',
  'baggage_agent','scanner','driver','accountant','auditor','office_work'));


-- ============================================================
-- FILE: supabase/migrations/20260724_staff_view_overrides.sql
-- ============================================================
-- Per-staff view access override. Until now, which nav tabs/views a staff
-- member can see was derived entirely from their `role` -- there was no way
-- to grant or restrict a specific person's access without changing their
-- role (which also changes everything else tied to that role: default tab,
-- realtime channels, etc). This adds an optional override: when set, it is
-- the exact, complete list of views that user can see, replacing the
-- role-derived default entirely (not additive). NULL (the default for every
-- existing account) means "no override -- use the normal role-based access,"
-- so this ships with zero behavior change for every staff member until an
-- admin explicitly sets one.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS view_overrides text[];


-- ============================================================
-- FILE: supabase/migrations/20260725_payment_confirmation_columns.sql
-- ============================================================
-- handleUpdateTx (src/components/EHIApp.tsx) resolves a Transaction's target
-- table generically and writes payment_confirmed/pos_approval_code/
-- confirmed_by/confirmed_at unconditionally, regardless of which table it
-- resolved to. 20260719_package_payment_columns.sql gave package_entries
-- these columns, but cargo_entries, manifests (baggage), and
-- marketing_entries never got them (cargo_entries got confirmed_by/
-- confirmed_at only, from 20260706_full_schema.sql -- it was still missing
-- payment_confirmed/pos_approval_code). That meant confirming a Cash/
-- Transfer payment for a Cargo, Baggage, or Marketing transaction either
-- failed against Supabase's schema cache or was silently dropped. This
-- brings all three tables to the same column parity as package_entries.
-- ADD COLUMN IF NOT EXISTS is used throughout (including for cargo_entries'
-- confirmed_by/confirmed_at) so this is safe to run regardless of exactly
-- which of these columns already exist on a given table.

ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS payment_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS pos_approval_code text;
ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS payment_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS pos_approval_code text;
ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS payment_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS pos_approval_code text;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;


-- ============================================================
-- FILE: supabase/migrations/20260726_outbound_arrivals_indexes.sql
-- ============================================================
-- New "Outbound Arrivals" view (src/components/views/OutboundArrivals.tsx)
-- lets a sending hub see which of its dispatched cargo_entries,
-- marketing_entries, and package_entries rows have status = 'Arrived' at
-- their destination, filtered by hub_id = the origin hub. None of the
-- three tables has an index that serves hub_id + status + recency together:
-- cargo_entries only has (hub_id, created_at) and a lone (status) index;
-- marketing_entries and package_entries only have (hub_id, created_at) with
-- no status index at all (marketing_entries.status predates this feature,
-- package_entries.status was added later in 20260718_package_tracking.sql
-- with no accompanying index). Add a composite index per table so this
-- query doesn't fall back to scanning every row for the hub.

CREATE INDEX IF NOT EXISTS idx_cargo_entries_hub_status_created ON public.cargo_entries(hub_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_entries_hub_status_created ON public.marketing_entries(hub_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_entries_hub_status_created ON public.package_entries(hub_id, status, created_at DESC);


-- ============================================================
-- FILE: supabase/migrations/20260727_hub_airline_route_rates.sql
-- ============================================================
-- Standard (retail, non-B2B) cargo pricing was a single company-wide rate
-- per destination route (standard_cargo_rates, keyed only by route_name),
-- editable only by super_admin. The business wants rates to also vary by
-- which hub is quoting and which airline is carrying the cargo, and wants
-- each hub's own accountant able to set their hub's rates.
--
-- standard_cargo_rates itself is left completely untouched -- it becomes
-- the last-resort fallback tier (see CargoForm.tsx's resolveRate()), so
-- existing data/behavior for every hub that hasn't configured anything
-- new is unchanged.
--
-- Two new tables rather than adding nullable hub_id/airline columns to
-- standard_cargo_rates -- avoids relying on Postgres's NULL-is-never-equal
-- UNIQUE semantics (which would make a clean ON CONFLICT upsert target for
-- the "any airline" tier awkward) in favor of two small, fully NOT NULL
-- tables with straightforward composite UNIQUE constraints.
--
-- hub_route_rates: this hub's default rate for a route, regardless of
-- airline (fallback tier 2, between the exact match and the company-wide
-- default).
CREATE TABLE IF NOT EXISTS public.hub_route_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id       uuid NOT NULL REFERENCES public.hubs(id),
  route_name   text NOT NULL,
  rate_per_kg  numeric(10,2) NOT NULL,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, route_name)
);

-- hub_airline_route_rates: the exact hub + airline + route rate (fallback
-- tier 1, most specific -- checked first).
CREATE TABLE IF NOT EXISTS public.hub_airline_route_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id       uuid NOT NULL REFERENCES public.hubs(id),
  airline      text NOT NULL,
  route_name   text NOT NULL,
  rate_per_kg  numeric(10,2) NOT NULL,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, airline, route_name)
);

CREATE INDEX IF NOT EXISTS hub_route_rates_hub_idx ON public.hub_route_rates(hub_id);
CREATE INDEX IF NOT EXISTS hub_airline_route_rates_hub_idx ON public.hub_airline_route_rates(hub_id);

-- RLS: read broadly (every cargo agent needs these to auto-price a retail
-- entry, matches standard_cargo_rates' existing "Authenticated read ...
-- USING (true)" policy). Write is deliberately NOT public.is_hub_unrestricted()
-- -- that function also treats accountant as company-wide-unrestricted
-- (matching every other hub-scoped table), but here accountant must be
-- scoped to their own hub only, so this uses its own predicate instead:
-- super_admin/admin (already unrestricted everywhere else) get every hub,
-- accountant gets only hub_id = their own current_user_hub_id().
REVOKE ALL ON TABLE public.hub_route_rates FROM anon;
ALTER TABLE public.hub_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors insert hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_route_rates" ON public.hub_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_route_rates" ON public.hub_route_rates;
CREATE POLICY "Authenticated read hub_route_rates" ON public.hub_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Hub rate editors insert hub_route_rates" ON public.hub_route_rates FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors update hub_route_rates" ON public.hub_route_rates FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors delete hub_route_rates" ON public.hub_route_rates FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );

REVOKE ALL ON TABLE public.hub_airline_route_rates FROM anon;
ALTER TABLE public.hub_airline_route_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates;
DROP POLICY IF EXISTS "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates;
CREATE POLICY "Authenticated read hub_airline_route_rates" ON public.hub_airline_route_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Hub rate editors insert hub_airline_route_rates" ON public.hub_airline_route_rates FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors update hub_airline_route_rates" ON public.hub_airline_route_rates FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
CREATE POLICY "Hub rate editors delete hub_airline_route_rates" ON public.hub_airline_route_rates FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );


-- ============================================================
-- FILE: supabase/migrations/20260728_reserve_awb_block.sql
-- ============================================================
-- next_awb_number() (20260710_hub_awb_counters.sql) is a hard, synchronous
-- network dependency that gates cargo/marketing/package/excess-baggage
-- submission: if the RPC call fails (e.g. no connectivity), the form
-- clears its tag field and blocks submission outright, even though the
-- rest of the save pipeline (src/lib/sync.ts's Dexie-backed offline queue)
-- already handles offline writes fine. A client-random tag was already
-- deliberately rejected elsewhere in this codebase (see next_awb_number's
-- own comment) because it can collide under concurrent submissions at a
-- busy hub, and entry_ref IS the literal tag number for cargo_entries/
-- package_entries (PRIMARY KEY / UNIQUE), with the physical tag printed
-- and stuck onto the cargo piece immediately -- no renumber-later scheme
-- is possible once that's happened.
--
-- reserve_awb_block lets the client pre-reserve a whole block of real,
-- atomically-allocated numbers while online, cache them locally (see
-- src/lib/tagPool.ts), and hand them out instantly offline or online --
-- same atomicity/uniqueness guarantee as next_awb_number (same table,
-- same upsert-and-increment pattern), just advancing the counter by
-- p_count in one statement instead of 1, so the whole returned range is
-- guaranteed never handed to any other caller.
CREATE OR REPLACE FUNCTION public.reserve_awb_block(p_hub_code TEXT, p_count INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last INTEGER;
BEGIN
  INSERT INTO public.hub_awb_counters (hub_code, last_number)
  VALUES (p_hub_code, 1000 + p_count)
  ON CONFLICT (hub_code) DO UPDATE
    SET last_number = hub_awb_counters.last_number + p_count
  RETURNING last_number INTO v_last;

  -- Block start is the first number in the newly-reserved range --
  -- v_last is now the LAST number in the range after advancing by p_count.
  RETURN v_last - p_count + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_awb_block(TEXT, INTEGER) TO authenticated;

-- Defense in depth: marketing_entries.awb_tag_number was only indexed, not
-- DB-unique-constrained (20260721_marketing_awb_tag_number.sql), unlike
-- cargo_entries.awb_tag_number. The block-reservation scheme above makes
-- collisions structurally impossible regardless, but this closes the gap
-- for consistency (existing data already comes from the same atomic
-- counter, so no pre-existing duplicates are expected -- NULLs are fine,
-- Postgres UNIQUE never treats multiple NULLs as a conflict).
-- DROP + re-ADD makes this safe to re-run, matching this file's convention
-- (e.g. user_profiles_role_check above).
ALTER TABLE public.marketing_entries DROP CONSTRAINT IF EXISTS marketing_entries_awb_tag_number_key;
ALTER TABLE public.marketing_entries ADD CONSTRAINT marketing_entries_awb_tag_number_key UNIQUE (awb_tag_number);



-- ============================================================
-- FILE: supabase/migrations/20260729_decrement_corporate_debt.sql
-- ============================================================
-- increment_corporate_debt (20260719_atomic_corporate_debt.sql) is the only
-- write path for corporate_clients.accumulated_monthly_debt -- nothing has
-- ever decremented it, even when a corporate client's shipment debt is
-- actually paid down via DebtorsTab.handleRecordPayment. That flow already
-- updates the transaction's own amountPaid/paymentHistory; it just never
-- reduced the client's aggregate monthly balance, so PricingConfiguration's
-- "₦X owed" display could only ever go up. This is the symmetric decrement,
-- mirroring increment_corporate_debt's exact locking/security pattern
-- (single atomic UPDATE for row-level serialization, SECURITY DEFINER with
-- an explicit hub-scoping re-check since SECURITY DEFINER bypasses RLS).
-- Clamped at zero (GREATEST) so no sequence of payments can push a client's
-- balance negative, e.g. from a rounding mismatch or a duplicate call.

CREATE OR REPLACE FUNCTION public.decrement_corporate_debt(p_client_id uuid, p_amount numeric)
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
     AND v_client_hub <> public.current_user_hub_id()
     AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Not authorized to update this corporate client''s debt balance';
  END IF;

  UPDATE public.corporate_clients
  SET accumulated_monthly_debt = GREATEST(accumulated_monthly_debt - p_amount, 0)
  WHERE id = p_client_id
  RETURNING accumulated_monthly_debt INTO v_new_total;

  RETURN v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_corporate_debt(uuid, numeric) TO authenticated;


-- ============================================================
-- FILE: supabase/migrations/20260730_bank_reference_columns.sql
-- ============================================================
-- PaymentValidation.tsx's bank-alert-paste-and-parse confirm flow has always
-- set bankReference/bankSender/bankAlertText on the in-memory Transaction,
-- but handleUpdateTx (src/components/EHIApp.tsx) never had columns to write
-- them to -- they only ever lived in optimistic local React state and were
-- silently discarded on the next fetch/reload. Adding these lets a matched
-- bank alert's details actually survive a refetch instead of vanishing.
-- Transfer debts/payments can occur on any of these three tables, so all
-- three get the columns (package_entries debt is Cash/POS-collected per its
-- own migration's comment, not Transfer, so it's not included here).

ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS bank_reference text;
ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS bank_sender text;
ALTER TABLE public.cargo_entries ADD COLUMN IF NOT EXISTS bank_alert_text text;

ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS bank_reference text;
ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS bank_sender text;
ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS bank_alert_text text;

ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS bank_reference text;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS bank_sender text;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS bank_alert_text text;


-- ============================================================
-- FILE: supabase/migrations/20260731_backfill_view_overrides_more_menu.sql
-- ============================================================
-- The Custom View Access checklist (StaffManagement.tsx) previously only
-- covered top-level nav tabs. This session folded ~22 More-menu screens
-- (Bank Reconciliation, Pricing Configuration, Staff Management, Corporate
-- Client Billing, etc.) into the same permission system, gated in More.tsx
-- via canAccessTab instead of hardcoded per-screen role checks.
--
-- getAllowedTabs() treats a non-null view_overrides as the *exact*,
-- non-additive list of what a user can see -- it does not fall back to
-- role defaults for ids missing from that list. Any staff member who
-- already had a custom view_overrides set BEFORE this change has an array
-- that predates every one of these new ids, since they didn't exist yet
-- when it was seeded/edited. Left alone, the next time More.tsx renders
-- for that person it would silently lock them out of every single
-- More-menu screen their role would otherwise grant -- e.g. an accountant
-- with a customized view list losing Bank Reconciliation, Central
-- Accounting ERP, Pricing Configuration, Corporate Billing, etc. all at
-- once, with no error and no obvious cause.
--
-- This is a one-time backfill: for every user with a non-null
-- view_overrides, union in exactly the new ids their role would already
-- get from getRoleDefaultTabs() today (mirrors src/lib/permissions.ts's
-- STATIC_VIEWS role lists exactly). Anything a super_admin deliberately
-- unchecked among the *pre-existing* ids is left untouched -- this only
-- adds the ids that couldn't have been either checked or unchecked yet
-- because they didn't exist.

CREATE OR REPLACE FUNCTION public._more_menu_defaults_for_role(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY(
    SELECT t.id FROM (VALUES
      ('More:EODClose',              ARRAY['super_admin','admin','accountant','auditor','cargo_agent','baggage_agent','marketing_agent','driver','office_work']),
      ('More:TransactionLedger',     ARRAY['super_admin','admin','accountant','auditor','cargo_agent','baggage_agent','marketing_agent','driver','office_work']),
      ('More:SupportTickets',        ARRAY['super_admin','admin','accountant','auditor','cargo_agent','baggage_agent','marketing_agent','driver','office_work']),
      ('More:BankReconciliation',    ARRAY['super_admin','accountant']),
      ('More:AccountingConsole',     ARRAY['super_admin','admin','accountant']),
      ('More:Reports',               ARRAY['super_admin','admin','accountant']),
      ('More:AirlineCommissions',    ARRAY['super_admin','admin','accountant']),
      ('More:CorporateBilling',      ARRAY['super_admin','admin','accountant']),
      ('More:Forecasting',           ARRAY['super_admin','admin']),
      ('More:FraudAlerts',           ARRAY['super_admin','admin','auditor','accountant']),
      ('More:AuditLog',              ARRAY['super_admin','auditor']),
      ('More:Fleet',                 ARRAY['super_admin','admin']),
      ('More:PODLog',                ARRAY['super_admin','admin','auditor','accountant']),
      ('More:Dispatch',              ARRAY['super_admin','admin']),
      ('AirlineLedger',              ARRAY['super_admin','admin','accountant']),
      ('WeightManifest',             ARRAY['super_admin','admin','cargo_agent','office_work']),
      ('DataImport',                 ARRAY['super_admin','admin']),
      ('AirlineLogos',               ARRAY['super_admin','admin']),
      ('More:PricingConfiguration',  ARRAY['super_admin','admin','accountant']),
      ('More:HubCargoRates',         ARRAY['super_admin','admin','accountant']),
      ('More:ExcessBaggageAirlines', ARRAY['super_admin','admin','accountant']),
      ('More:Settings',              ARRAY['super_admin']),
      ('More:StaffManagement',       ARRAY['super_admin','admin'])
    ) AS t(id, roles)
    WHERE p_role = ANY(t.roles)
  );
$$;

UPDATE public.user_profiles
SET view_overrides = (
  SELECT ARRAY(SELECT DISTINCT unnest(view_overrides || public._more_menu_defaults_for_role(role)))
)
WHERE view_overrides IS NOT NULL;

DROP FUNCTION public._more_menu_defaults_for_role(text);


-- ============================================================
-- FILE: supabase/migrations/20260801_cargo_day_close.sql
-- ============================================================
-- CARGO DESK DAY CLOSE -- a wholly separate close from
-- EODReconciliation.tsx's shared cargo+marketing+baggage+package
-- aggregate (eod_records/eod_locks). That screen is intentionally
-- left untouched; this is a new, Cargo-only close reachable from
-- CargoForm.tsx itself, mirroring package_day_close/marketing_day_close
-- in every column EXCEPT the boundary: cargo activity can span a
-- shift that starts one calendar day and ends the next (e.g. 10pm-6am),
-- so a bare `date` column can't represent what was actually closed.
-- period_start/period_end (both timestamptz) replace it.
--
-- Depends on public.current_user_hub_id()/is_hub_unrestricted() from
-- 20260708_hub_isolation_rls.sql -- must run after it, same as
-- package_day_close.

CREATE TABLE IF NOT EXISTS public.cargo_day_close (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id             uuid REFERENCES public.hubs(id),
  hub                text,
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  total_sales        numeric(12,2) NOT NULL DEFAULT 0,
  cash_sales         numeric(12,2) NOT NULL DEFAULT 0,
  pos_sales          numeric(12,2) NOT NULL DEFAULT 0,
  transfer_sales     numeric(12,2) NOT NULL DEFAULT 0,
  debt_sales         numeric(12,2) NOT NULL DEFAULT 0,
  total_expenses     numeric(12,2) NOT NULL DEFAULT 0,
  balance_cash       numeric(12,2) NOT NULL DEFAULT 0,
  entry_count        integer NOT NULL DEFAULT 0,
  route_counts       jsonb NOT NULL DEFAULT '{}',
  closed_by          text,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  -- Two closes for the same hub ending at the literal same instant are a
  -- duplicate submission by definition -- period_end is the boundary that
  -- "nothing after this point is included in this close," so it can't be
  -- claimed twice. UNIQUE(hub_id, date) (package/marketing's approach)
  -- would be wrong here on purpose: two legitimate closes on the same
  -- calendar day (an early-shift close at 14:00, then the evening shift
  -- closing at 23:00) must both be allowed -- that flexibility is the
  -- entire point of this table existing instead of reusing package_day_close's
  -- shape. UNIQUE(hub_id, period_start) was considered and rejected: two
  -- closes could legitimately share a start (e.g. a corrected re-close
  -- attempt with a different end), but never a shared end.
  UNIQUE (hub_id, period_end)
);

-- Used by CargoForm.tsx to default a new close's period_start to the
-- previous close's period_end for this hub (continuous, non-overlapping
-- periods without staff having to remember/type the last boundary).
CREATE INDEX IF NOT EXISTS cargo_day_close_hub_period_idx
  ON public.cargo_day_close(hub_id, period_end DESC);

ALTER TABLE public.cargo_day_close ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hub-scoped read cargo_day_close" ON public.cargo_day_close;
CREATE POLICY "Hub-scoped read cargo_day_close" ON public.cargo_day_close FOR SELECT TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Hub-scoped upsert cargo_day_close" ON public.cargo_day_close;
CREATE POLICY "Hub-scoped upsert cargo_day_close" ON public.cargo_day_close FOR INSERT TO authenticated
  WITH CHECK (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());

DROP POLICY IF EXISTS "Hub-scoped update cargo_day_close" ON public.cargo_day_close;
CREATE POLICY "Hub-scoped update cargo_day_close" ON public.cargo_day_close FOR UPDATE TO authenticated
  USING (hub_id = public.current_user_hub_id() OR hub_id IS NULL OR public.is_hub_unrestricted());
