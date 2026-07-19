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
