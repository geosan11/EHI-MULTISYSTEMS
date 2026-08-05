-- =============================================================
-- Split "edit ledger" out of can_print_ledger into its own permission
-- =============================================================
-- can_print_ledger has done double duty: it gates the Printing & Documents
-- section for ANY role (TransactionLedger.tsx's reprint buttons), AND --
-- for accountant/admin specifically -- it also unlocks canEdit (editing a
-- transaction). A super_admin wanting to let an accountant reprint
-- receipts without also letting them edit live financial entries (or vice
-- versa) had no way to do that; toggling Staff Management's single
-- "Ledger Edit Permission" switch granted both at once. Its own UI copy
-- even said as much -- the toggle was titled "Ledger Edit Permission" but
-- its confirmation text read "This user can print receipts/tags from the
-- ledger", visible evidence of the same conflation.
--
-- can_print_ledger keeps its existing name/meaning (reprint/print) and is
-- untouched here. can_edit_ledger is the new, independent permission for
-- editing transaction entries.
--
-- Backfill can_edit_ledger = true for every profile that currently has
-- can_print_ledger = true: that's the only way today's staff could edit
-- at all (see TransactionLedger.tsx's current canEdit check), so without
-- this backfill everyone who can edit today would silently lose edit
-- access the moment this ships, even though nothing about their actual
-- authorization changed. Going forward the two permissions are
-- independently toggleable per profile.
-- =============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_edit_ledger boolean NOT NULL DEFAULT false;

UPDATE public.user_profiles
SET can_edit_ledger = true
WHERE can_print_ledger = true AND can_edit_ledger = false;
