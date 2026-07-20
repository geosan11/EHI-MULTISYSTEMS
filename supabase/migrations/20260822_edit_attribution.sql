-- Edits to an existing entry left zero trace of who made them: TransactionLedger.tsx's
-- handleSaveEdit sets `finalTx.editedBy` client-side, but buildTxUpdatePayload
-- (src/components/EHIApp.tsx) never read it, so it was dropped before ever
-- reaching Supabase -- and no audit_log entry was written for a plain field
-- edit either (only CREATE and PAYMENT_CONFIRM wrote to audit_log). This
-- matters specifically because a hub's "Current Shift" ledger view pools
-- every staff member's activity together (by design -- one shift per hub,
-- shared by whoever is on duty), so without this, there was no way to tell
-- which agent on a shared shift actually edited a given entry.
--
-- last_edited_by/last_edited_at give a fast, denormalized "who touched this
-- last" for the ledger row list; the accompanying UPDATE audit_log entry
-- (written from handleUpdateTx) gives the full before/after trail.
ALTER TABLE public.cargo_entries     ADD COLUMN IF NOT EXISTS last_edited_by text, ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;
ALTER TABLE public.manifests         ADD COLUMN IF NOT EXISTS last_edited_by text, ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;
ALTER TABLE public.marketing_entries ADD COLUMN IF NOT EXISTS last_edited_by text, ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;
ALTER TABLE public.package_entries   ADD COLUMN IF NOT EXISTS last_edited_by text, ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;
