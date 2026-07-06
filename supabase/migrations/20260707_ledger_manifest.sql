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
