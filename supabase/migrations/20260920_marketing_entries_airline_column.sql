-- =============================================================
-- Fix: Marketing entries have an Airline picker at intake
-- (MarketingWorkspace.tsx, sourced from useAirlines()) but marketing_
-- entries never had an airline column -- confirmed by checking every
-- migration, the table was never given one. The selected value was
-- captured into local component state and then silently discarded: not
-- included in the insert payload (EHIApp.tsx's handleAddTx marketing
-- branch), not selected on fetch, not mapped onto the Transaction object,
-- not included in the edit-save payload, and absent from the Transaction
-- Ledger's edit view entirely.
--
-- Adds the column so the rest of the stack (client changes in this same
-- commit) has somewhere to actually persist and read the value back.
-- =============================================================

ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS airline text;
