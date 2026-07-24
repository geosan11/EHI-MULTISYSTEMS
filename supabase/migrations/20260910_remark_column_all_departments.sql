-- =============================================================
-- remark: extend to manifests, marketing_entries, package_entries
-- (Real authoring date: 2026-07-24. Filename prefixed 2026090x per
-- docs/MIGRATION_POLICY.md so it sorts after every migration already
-- applied to the live database.)
-- =============================================================
-- remark is the DB column behind Transaction.remarks -- used for BOTH the
-- debt-clearance shadow entry's "AWB: ... Orig: ... Paid: ... Bal: ..."
-- breakdown (TransactionLedger.tsx's confirmClearDebt / DebtorsTab.tsx's
-- handleRecordPayment) AND the general-purpose free-text Remarks field
-- editable from the ledger's own Edit modal (canEditRemarks). Like
-- is_debt_clearance/related_tx_id before this same review pass, it only
-- ever existed on cargo_entries -- so for baggage/marketing/package: (a)
-- a cleared debt's Orig/Paid/Bal breakdown never survives past the
-- in-memory optimistic update (silently discarded at insert, since there
-- was no column to write it to), and (b) editing an entry's Remarks field
-- was completely non-functional, and (c) EHIApp.tsx's buildTxUpdatePayload
-- unconditionally includes `remark` in every type's update payload once
-- `t.remarks` is set, which would have thrown a real Postgres "column
-- does not exist" error on the next edit of any baggage/marketing/package
-- entry that had picked up a remarks value via any path.
-- =============================================================

ALTER TABLE public.manifests
  ADD COLUMN IF NOT EXISTS remark text;

ALTER TABLE public.marketing_entries
  ADD COLUMN IF NOT EXISTS remark text;

ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS remark text;

INSERT INTO public.schema_migrations (filename) VALUES ('20260910_remark_column_all_departments.sql')
ON CONFLICT (filename) DO NOTHING;
