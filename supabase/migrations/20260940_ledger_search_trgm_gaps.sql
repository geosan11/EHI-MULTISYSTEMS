-- ============================================================
-- LEDGER SEARCH -- close the remaining trigram-index gaps
-- ============================================================
-- Follow-up to 20260939_ledger_search_page_perf.sql, which closed most
-- of the "one un-indexed OR branch forces a full scan for the whole
-- predicate" gap it identified, but not all of it. Comparing its new
-- indexes against ledger_search_page/ledger_search_totals' actual ILIKE
-- chains (20260938_ledger_search_and_totals_rpc.sql), these branches
-- were still left without a supporting index:
--   - cargo_entries.receipt_mode
--   - manifests.remark (cargo/marketing/package all got one; manifests
--     was the one table left out)
--   - manifests.payment_mode, marketing_entries.payment_mode,
--     package_entries.payment_mode
--   - every table's `amount::text` (marketing's `amount_paid::text`)
--     cast -- searching by amount substring is part of the same ILIKE
--     chain on all 5 tables, none of which had an expression index for it
-- Same reasoning as 20260939: since these are OR'd into one predicate
-- with p_query, missing coverage on any single one of them still forces
-- the whole ILIKE chain to fall back to a sequential scan, regardless of
-- how many of the OTHER branches already have an index. Closing these is
-- what actually makes the existing indexes pay off. IF NOT EXISTS
-- throughout -- safe to re-run.
--
-- Deliberately NOT indexed: none skipped here. receipt_mode/payment_mode
-- are low-cardinality (a handful of distinct values), so a real search
-- for e.g. "cash" will still cost-based fall back to a scan of just the
-- matching rows via the index rather than a cheap seek -- but the index's
-- existence is still what lets the planner treat the OR chain as
-- index-backed at all, which is what actually matters for the far more
-- common case of searching a name, tag number, or amount fragment
-- alongside it in the same query.
CREATE INDEX IF NOT EXISTS cargo_entries_receipt_mode_trgm_idx
  ON public.cargo_entries USING gin (receipt_mode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_amount_trgm_idx
  ON public.cargo_entries USING gin ((amount::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS manifests_remark_trgm_idx
  ON public.manifests USING gin (remark gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_payment_mode_trgm_idx
  ON public.manifests USING gin (payment_mode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_amount_trgm_idx
  ON public.manifests USING gin ((amount::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS marketing_entries_payment_mode_trgm_idx
  ON public.marketing_entries USING gin (payment_mode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_amount_paid_trgm_idx
  ON public.marketing_entries USING gin ((amount_paid::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS package_entries_payment_mode_trgm_idx
  ON public.package_entries USING gin (payment_mode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS package_entries_amount_trgm_idx
  ON public.package_entries USING gin ((amount::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS expenses_amount_trgm_idx
  ON public.expenses USING gin ((amount::text) gin_trgm_ops);
