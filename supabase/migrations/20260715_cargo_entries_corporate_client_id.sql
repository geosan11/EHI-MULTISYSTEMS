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
-- NOTE: a previous version of this comment claimed the live column was
-- actually `uuid` (reasoning that the original CREATE TABLE in
-- 20260706_full_schema.sql already declared it that way, making this
-- ADD COLUMN IF NOT EXISTS a harmless no-op). A live migration run proved
-- that wrong: on the real database this column is `text`, confirmed by
-- `operator does not exist: text = uuid` when 20260823's dedupe migration
-- tried to compare it against a uuid variable. The actual sequence was:
-- cargo_entries pre-existed (created ad hoc, before 20260706_full_schema.sql
-- was ever written) without this column at all, so 20260706's
-- CREATE TABLE IF NOT EXISTS was a full no-op for the whole table -- this
-- ADD COLUMN IF NOT EXISTS (as originally written, `text`) is what actually
-- created the column for the first time. Restored to `text` to match
-- reality; every write is still a real corporate_clients.id UUID value or
-- NULL (CargoForm.tsx's matchedClient?.id/detectedOfficeClient.id), so
-- callers that need to join/compare against corporate_clients.id must cast
-- explicitly (see 20260823's dedupe migration and clear_cargo_debt in
-- 20260824_clear_cargo_debt_corporate_decrement.sql).
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS corporate_client_id text;

CREATE INDEX IF NOT EXISTS idx_cargo_entries_corporate_client_id
  ON public.cargo_entries (corporate_client_id)
  WHERE corporate_client_id IS NOT NULL;
