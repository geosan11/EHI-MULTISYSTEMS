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
--
-- NOTE: this originally declared the column as `text`, but
-- cargo_entries.corporate_client_id already existed as `uuid` (with a
-- FOREIGN KEY REFERENCES corporate_clients(id)) from the original
-- CREATE TABLE in 20260706_full_schema.sql -- ADD COLUMN IF NOT EXISTS is
-- a no-op when the column already exists, so this never actually changed
-- the type; the live column has been `uuid` the whole time. Corrected the
-- type below to match reality (the app has only ever written real
-- corporate_clients.id UUID values or NULL here anyway, via
-- CargoForm.tsx's matchedClient?.id/detectedOfficeClient.id, so this was
-- a stale/misleading comment, not a functional bug).
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS corporate_client_id uuid REFERENCES public.corporate_clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cargo_entries_corporate_client_id
  ON public.cargo_entries (corporate_client_id)
  WHERE corporate_client_id IS NOT NULL;
