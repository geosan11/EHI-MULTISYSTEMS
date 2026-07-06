-- Airline commission % was being recomputed at report time using the
-- CURRENT pricing_config rate against historical cargo transactions, so
-- editing a commission rate today silently rewrote what was owed to the
-- airline on every past transaction. Lock the rate in at entry time.
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2);
