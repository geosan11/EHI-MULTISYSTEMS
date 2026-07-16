-- ============================================================
-- EHI MULTISYSTEMS LOGISTICS PLATFORM — FULL SCHEMA MIGRATION
-- Run this in Supabase SQL Editor (safe to re-run, uses IF NOT EXISTS)
-- Generated: 2026-07-06
-- ============================================================

-- ── 1. HUBS ────────────────────────────────────────────────
-- IF NOT EXISTS is a no-op here in every environment where this migration
-- has actually run -- the hubs table predates this migration file and
-- already has its own real CHECK constraint ('Cargo Station' | 'Head
-- Office' | 'Field Office'), confirmed live via pg_get_constraintdef. The
-- clause below is corrected to match that reality (it originally read
-- 'airport'/'transit'/'depot', which never matched anything real and was
-- copied into Settings.tsx's Add Hub form, where it failed every insert
-- with a check-constraint violation until fixed there too).
CREATE TABLE IF NOT EXISTS public.hubs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  code      text UNIQUE NOT NULL,
  state     text,
  type      text NOT NULL DEFAULT 'Cargo Station' CHECK (type IN ('Cargo Station','Head Office','Field Office')),
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
