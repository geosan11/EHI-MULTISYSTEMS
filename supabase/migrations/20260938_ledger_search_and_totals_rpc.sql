-- ============================================================
-- LEDGER SEARCH / ALL-TIME PAGINATION -- server-side page + totals
-- ============================================================
-- Replaces TransactionLedger.tsx's eager "All Time" fetch (previously up
-- to 20,000 rows PER TABLE across 4 tables into memory before anything
-- was shown, via fetchAllTimeTransactions) with keyset-paginated pages
-- (500 rows at a time, more loaded on scroll) plus a separate,
-- always-correct aggregate query for the KPI tiles (Total/Cash/Transfer/
-- POS/Debt/Wallet/Office-Individual Debt split) so those numbers reflect
-- every matching row, not just whatever's currently loaded on screen.
--
-- Both functions are deliberately NOT SECURITY DEFINER -- they run as
-- the calling (authenticated) role, so the existing RLS SELECT policies
-- on cargo_entries/manifests/marketing_entries/package_entries/expenses
-- (sibling_hub_ids()/is_hub_unrestricted(), see
-- 20260708_hub_isolation_rls.sql, 20260709_package_desk.sql and
-- 20260817_state_visibility.sql) apply automatically and identically to
-- a direct client-side .select(). Do NOT add SECURITY DEFINER here
-- without also re-adding an explicit sibling_hub_ids()/
-- is_hub_unrestricted() check per branch -- that helper function's own
-- history (20260921_sibling_hub_ids_null_state_fix.sql,
-- 20260922_sibling_hub_ids_no_hub_guard.sql both had to patch it after
-- the fact) shows a private copy embedded in a new RPC would not have
-- received those fixes and would silently leak cross-hub data.
--
-- Pagination is keyset (created_at, entry_id), not LIMIT/OFFSET --
-- realtime writes continue landing in these tables from other active
-- sessions while a user scrolls All Time (see EHIApp.tsx's per-table
-- realtime channels), which would silently skip or duplicate rows at
-- OFFSET page boundaries whenever something new gets inserted mid-scroll.
--
-- p_office_work_only mirrors TransactionLedger.tsx's typeFilter ===
-- "Office Work" pseudo-type: it OVERRIDES p_types filtering (an
-- office-work cargo entry and an office-work marketing entry both
-- match), using the same OR-condition isOfficeWorkEntry() uses
-- client-side (src/lib/officeWork.ts) -- client_type='Corporate' OR
-- linked_as_office_work OR corporate_client_id IS NOT NULL OR
-- remark ~* 'office\s*work'. expenses has none of those columns and is
-- therefore excluded whenever p_office_work_only is true.
--
-- amount/amount_paid (or marketing's debt_amount_paid)/retrieved_amount
-- are all NOT NULL DEFAULT 0 on every table (confirmed against
-- 20260706_full_schema.sql, 20260710_debt_payment_columns.sql,
-- 20260719_package_payment_columns.sql, 20260810_wallet_atomicity_and_
-- isolation.sql, 20260902_multi_department_retrieval_and_wallet_
-- cashout.sql) -- COALESCE is still applied everywhere below to match
-- this codebase's own established convention in its debt-clearance RPCs
-- (see 20260937_delete_transaction_rpc.sql's COALESCE(v_entry.amount, 0)
-- pattern). wallet_deduction_amount is the one column that IS actually
-- nullable (ADD COLUMN IF NOT EXISTS wallet_deduction_amount NUMERIC
-- (12,2) with no NOT NULL/DEFAULT, 20260717_cargo_workflow_overhaul.sql)
-- -- COALESCE there is load-bearing, not just defensive style.
-- ============================================================

-- Optional but recommended: enables trigram-indexed ILIKE '%term%'
-- search. Substring search can't use a normal B-tree index (leading
-- wildcard); every one of these is IF NOT EXISTS / safe to skip or
-- re-run. Revisit via this app's own slow-query logging
-- (src/lib/supabase.ts's SUPABASE_API warning above 1500ms) if search
-- ever shows up slow without these.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS cargo_entries_consignee_name_trgm_idx
  ON public.cargo_entries USING gin (consignee_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_remark_trgm_idx
  ON public.cargo_entries USING gin (remark gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_passenger_name_trgm_idx
  ON public.manifests USING gin (passenger_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_customer_name_trgm_idx
  ON public.marketing_entries USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_remark_trgm_idx
  ON public.marketing_entries USING gin (remark gin_trgm_ops);
CREATE INDEX IF NOT EXISTS package_entries_customer_name_trgm_idx
  ON public.package_entries USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS package_entries_remark_trgm_idx
  ON public.package_entries USING gin (remark gin_trgm_ops);
CREATE INDEX IF NOT EXISTS expenses_description_trgm_idx
  ON public.expenses USING gin (description gin_trgm_ops);

-- ── ledger_search_page ─────────────────────────────────────
-- One page (default/max 500) of unified ledger rows, newest first.
CREATE OR REPLACE FUNCTION public.ledger_search_page(
  p_query             text DEFAULT NULL,       -- search string, NULL/'' = no search filter
  p_types             text[] DEFAULT NULL,      -- subset of {'cargo','baggage','marketing','package'}; NULL = all
  p_terminal          text DEFAULT NULL,        -- 'MMA2' | 'GAT'; NULL = both (cargo/package only, ignored by baggage/marketing/expenses)
  p_mode              text DEFAULT NULL,        -- 'Cash'|'Transfer'|'POS'|'Debt'|'Wallet'; NULL = all
  p_office_work_only  boolean DEFAULT false,
  p_debt_class        text DEFAULT NULL,        -- 'Office' | 'Individual'; implies mode = Debt
  p_include_expenses  boolean DEFAULT true,
  p_cursor_created_at timestamptz DEFAULT NULL, -- pass back the last row's created_at/entry_id for the next page
  p_cursor_entry_id   text DEFAULT NULL,
  p_limit             integer DEFAULT 500
)
RETURNS TABLE(entry_type text, entry_id text, created_at timestamptz, raw jsonb)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Whole-row to_jsonb(alias) rather than a hand-picked column list: this
  -- guarantees every column that actually exists on each table ends up in
  -- `raw` (so the client's existing per-type row mapper, which already
  -- reads a wide set of fields for full Transaction fidelity, never
  -- silently loses one this migration's author didn't think to name) and
  -- means this function can't fail from referencing a column that turns
  -- out not to exist on a given table -- only the columns actually used
  -- in WHERE/filter predicates below need to be named, and every one of
  -- those was directly confirmed against the migration history before
  -- this file was written.
  WITH unified AS (
    SELECT 'cargo'::text AS entry_type, c.entry_ref AS entry_id, c.created_at, to_jsonb(c) AS raw
    FROM public.cargo_entries c
    WHERE (p_types IS NULL OR 'cargo' = ANY(p_types) OR p_office_work_only)
      AND (p_terminal IS NULL OR c.terminal = p_terminal)
      AND (p_mode IS NULL OR c.receipt_mode = p_mode)
      AND (NOT p_office_work_only OR c.client_type = 'Corporate' OR c.linked_as_office_work
           OR c.corporate_client_id IS NOT NULL OR c.remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (
            c.receipt_mode = 'Debt' AND (
              (p_debt_class = 'Office' AND (c.client_type = 'Corporate' OR c.linked_as_office_work
                 OR c.corporate_client_id IS NOT NULL OR c.remark ~* 'office\s*work'))
              OR (p_debt_class = 'Individual' AND NOT (c.client_type = 'Corporate' OR c.linked_as_office_work
                 OR c.corporate_client_id IS NOT NULL OR c.remark ~* 'office\s*work'))
            )))
      AND (p_query IS NULL OR p_query = '' OR (
            c.entry_ref ILIKE '%'||p_query||'%' OR c.consignee_name ILIKE '%'||p_query||'%'
            OR c.awb_tag_number ILIKE '%'||p_query||'%' OR c.route ILIKE '%'||p_query||'%'
            OR c.remark ILIKE '%'||p_query||'%' OR c.related_tx_id ILIKE '%'||p_query||'%'
            OR c.consignee_phone ILIKE '%'||p_query||'%' OR c.pickup_pin ILIKE '%'||p_query||'%'
            OR c.receipt_mode ILIKE '%'||p_query||'%' OR c.amount::text ILIKE '%'||p_query||'%'
          ))

    UNION ALL

    SELECT 'baggage', m.transaction_id, m.created_at, to_jsonb(m)
    FROM public.manifests m
    WHERE (p_types IS NULL OR 'baggage' = ANY(p_types) OR p_office_work_only)
      AND p_terminal IS NULL  -- manifests has no terminal column
      AND (p_mode IS NULL OR m.payment_mode = p_mode)
      AND (NOT p_office_work_only OR m.client_type = 'Corporate' OR m.linked_as_office_work
           OR m.corporate_client_id IS NOT NULL OR m.remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (
            m.payment_mode = 'Debt' AND (
              (p_debt_class = 'Office' AND (m.client_type = 'Corporate' OR m.linked_as_office_work
                 OR m.corporate_client_id IS NOT NULL OR m.remark ~* 'office\s*work'))
              OR (p_debt_class = 'Individual' AND NOT (m.client_type = 'Corporate' OR m.linked_as_office_work
                 OR m.corporate_client_id IS NOT NULL OR m.remark ~* 'office\s*work'))
            )))
      AND (p_query IS NULL OR p_query = '' OR (
            m.transaction_id ILIKE '%'||p_query||'%' OR m.passenger_name ILIKE '%'||p_query||'%'
            OR m.pnr ILIKE '%'||p_query||'%' OR m.flight_no ILIKE '%'||p_query||'%'
            OR m.destination ILIKE '%'||p_query||'%' OR m.remark ILIKE '%'||p_query||'%'
            OR m.related_tx_id ILIKE '%'||p_query||'%' OR m.passenger_phone ILIKE '%'||p_query||'%'
            OR m.payment_mode ILIKE '%'||p_query||'%' OR m.amount::text ILIKE '%'||p_query||'%'
          ))

    UNION ALL

    SELECT 'marketing', k.entry_ref, k.created_at, to_jsonb(k)
    FROM public.marketing_entries k
    WHERE (p_types IS NULL OR 'marketing' = ANY(p_types) OR p_office_work_only)
      AND p_terminal IS NULL  -- marketing_entries has no terminal column
      AND (p_mode IS NULL OR k.payment_mode = p_mode)
      AND (NOT p_office_work_only OR k.client_type = 'Corporate' OR k.linked_as_office_work
           OR k.corporate_client_id IS NOT NULL OR k.remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (
            k.payment_mode = 'Debt' AND (
              (p_debt_class = 'Office' AND (k.client_type = 'Corporate' OR k.linked_as_office_work
                 OR k.corporate_client_id IS NOT NULL OR k.remark ~* 'office\s*work'))
              OR (p_debt_class = 'Individual' AND NOT (k.client_type = 'Corporate' OR k.linked_as_office_work
                 OR k.corporate_client_id IS NOT NULL OR k.remark ~* 'office\s*work'))
            )))
      AND (p_query IS NULL OR p_query = '' OR (
            k.entry_ref ILIKE '%'||p_query||'%' OR k.customer_name ILIKE '%'||p_query||'%'
            OR k.awb_tag_number ILIKE '%'||p_query||'%' OR k.route ILIKE '%'||p_query||'%'
            OR k.remark ILIKE '%'||p_query||'%' OR k.related_tx_id ILIKE '%'||p_query||'%'
            OR k.customer_phone ILIKE '%'||p_query||'%' OR k.payment_mode ILIKE '%'||p_query||'%'
            OR k.amount_paid::text ILIKE '%'||p_query||'%'
          ))

    UNION ALL

    SELECT 'package', p.entry_ref, p.created_at, to_jsonb(p)
    FROM public.package_entries p
    WHERE (p_types IS NULL OR 'package' = ANY(p_types) OR p_office_work_only)
      AND (p_terminal IS NULL OR p.terminal = p_terminal)
      AND (p_mode IS NULL OR p.payment_mode = p_mode)
      AND (NOT p_office_work_only OR p.client_type = 'Corporate' OR p.linked_as_office_work
           OR p.corporate_client_id IS NOT NULL OR p.remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (
            p.payment_mode = 'Debt' AND (
              (p_debt_class = 'Office' AND (p.client_type = 'Corporate' OR p.linked_as_office_work
                 OR p.corporate_client_id IS NOT NULL OR p.remark ~* 'office\s*work'))
              OR (p_debt_class = 'Individual' AND NOT (p.client_type = 'Corporate' OR p.linked_as_office_work
                 OR p.corporate_client_id IS NOT NULL OR p.remark ~* 'office\s*work'))
            )))
      AND (p_query IS NULL OR p_query = '' OR (
            p.entry_ref ILIKE '%'||p_query||'%' OR p.customer_name ILIKE '%'||p_query||'%'
            OR p.destination ILIKE '%'||p_query||'%' OR p.remark ILIKE '%'||p_query||'%'
            OR p.related_tx_id ILIKE '%'||p_query||'%' OR p.customer_phone ILIKE '%'||p_query||'%'
            OR p.payment_mode ILIKE '%'||p_query||'%' OR p.amount::text ILIKE '%'||p_query||'%'
          ))

    UNION ALL

    -- e.id::text, not bare e.id -- every other branch's entry_id
    -- (entry_ref/transaction_id) is text, and this column position must
    -- resolve to ONE common type across all 5 UNION ALL branches. uuid
    -- and text have no implicit cast between them (only assignment,
    -- which doesn't apply to UNION's own type resolution), so a bare
    -- e.id here would make the whole `unified` CTE fail to parse, not
    -- just the ILIKE predicate further down that already needed the
    -- explicit cast for its own reason.
    SELECT 'expense', e.id::text, e.created_at, to_jsonb(e)
    FROM public.expenses e
    WHERE p_include_expenses
      AND NOT p_office_work_only  -- expenses have no office-work columns
      -- NULL p_types = "All" typeFilter (expenses included alongside every
      -- other type); an EMPTY (non-null) p_types array is the client's
      -- explicit "Expense" typeFilter signal (see ledgerSearch.ts's
      -- allTimeFilterParams: types=[] when typeFilter==='Expense', which
      -- also correctly excludes cargo/baggage/marketing/package below via
      -- their own `'cargo' = ANY(p_types)`-style checks against an empty
      -- array). Any NON-empty p_types (a real type selected) excludes
      -- expenses, matching the original client-side typeFilter narrowing.
      AND (p_types IS NULL OR cardinality(p_types) = 0)
      AND p_terminal IS NULL AND p_debt_class IS NULL  -- expenses are never Debt-mode
      AND (p_mode IS NULL OR e.mode = p_mode)
      -- e.id is uuid, not text (see 20260706_full_schema.sql's expenses
      -- table) -- ILIKE's ~~* operator has no uuid overload and no
      -- implicit cast (unlike assignment contexts, e.g. the plain SELECT
      -- e.id above coercing into this function's `entry_id text` return
      -- column, which uuid->text DOES support), so this needs an explicit
      -- cast or CREATE FUNCTION fails to parse.
      AND (p_query IS NULL OR p_query = '' OR (
            e.id::text ILIKE '%'||p_query||'%' OR e.category ILIKE '%'||p_query||'%'
            OR e.description ILIKE '%'||p_query||'%' OR e.amount::text ILIKE '%'||p_query||'%'
          ))
  )
  SELECT entry_type, entry_id, created_at, raw
  FROM unified
  WHERE p_cursor_created_at IS NULL
     OR (created_at, entry_id) < (p_cursor_created_at, p_cursor_entry_id)
  ORDER BY created_at DESC, entry_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

GRANT EXECUTE ON FUNCTION public.ledger_search_page(
  text, text[], text, text, boolean, text, boolean, timestamptz, text, integer
) TO authenticated;

-- ── ledger_search_totals ───────────────────────────────────
-- Same filter surface as ledger_search_page (minus pagination), returns
-- ONE aggregate row across every matching row -- not just a loaded page.
-- Mirrors TransactionLedger.tsx's kpis useMemo exactly:
--  - total: sign * amount for every row EXCEPT one whose mode *displays*
--    as 'Debt Paid' client-side -- to avoid double-counting against its
--    DC- shadow debt-clearance entry. IMPORTANT: 'Debt Paid' is never a
--    literal DB column value (receipt_mode/payment_mode only ever store
--    'Debt' even once fully paid) -- it's computed client-side per
--    TransactionLedger.tsx's own row mapper as `receipt_mode === 'Debt'
--    && amount_paid >= amount`. Filtering on `mode <> 'Debt Paid'` in SQL
--    would therefore be a no-op (always true) and silently double-count
--    every cleared debt into total_amount -- rows CTE below computes a
--    real `is_debt_paid` boolean per branch, replicating each table's
--    exact client-side condition (package_entries also has a `debt_paid`
--    boolean column the client OR's in, per its own mapper), and total
--    filters on that instead. sign = -1 for expenses, +1
--    otherwise; expenses fall back to a mode value that never equals
--    Cash/Transfer/POS/Debt/Wallet when the DB column is null, mirroring
--    Entry.mode's "|| 'Expense'" fallback client-side, so a category-only
--    expense with no mode set reduces total but not cash/transfer/pos.
--  - cash/transfer/pos: sign * amount filtered by mode.
--  - debt / unpaid_debt_count / office-individual split: GREATEST(amount
--    - amount_paid - retrieved_amount, 0) for mode = 'Debt' rows,
--    classified via the same office-work OR-condition used throughout
--    this migration. marketing_entries' inverted columns (amount is
--    really amount_paid_db, amount_paid display field is really
--    debt_amount_paid_db) are respected here.
--  - wallet: COALESCE(wallet_deduction_amount, CASE WHEN mode='Wallet'
--    THEN amount ELSE 0 END), summed UNCONDITIONALLY (not filtered by
--    mode='Wallet') -- this also captures a non-Wallet-mode row that had
--    a partial wallet contribution (a split payment), matching
--    TransactionLedger.tsx's real client-side formula exactly rather
--    than the simpler (and wrong) "just sum amount where mode=Wallet".
CREATE OR REPLACE FUNCTION public.ledger_search_totals(
  p_query            text DEFAULT NULL,
  p_types            text[] DEFAULT NULL,
  p_terminal         text DEFAULT NULL,
  p_mode             text DEFAULT NULL,
  p_office_work_only boolean DEFAULT false,
  p_debt_class       text DEFAULT NULL,
  p_include_expenses boolean DEFAULT true
)
RETURNS TABLE(
  total_amount            numeric,
  cash_amount             numeric,
  transfer_amount         numeric,
  pos_amount              numeric,
  debt_amount             numeric,
  wallet_amount           numeric,
  unpaid_debt_count       bigint,
  office_debt_amount      numeric,
  individual_debt_amount  numeric,
  row_count               bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH agg_rows AS (
    -- cargo
    SELECT 1::int AS sign, receipt_mode AS mode,
           COALESCE(amount, 0) AS amount, COALESCE(amount_paid, 0) AS amount_paid,
           COALESCE(retrieved_amount, 0) AS retrieved_amount,
           COALESCE(wallet_deduction_amount, 0) AS wallet_deduction_amount,
           (client_type = 'Corporate' OR linked_as_office_work OR corporate_client_id IS NOT NULL
              OR remark ~* 'office\s*work') AS is_office,
           (receipt_mode = 'Debt' AND COALESCE(amount_paid, 0) >= COALESCE(amount, 0)) AS is_debt_paid
    FROM public.cargo_entries
    WHERE (p_types IS NULL OR 'cargo' = ANY(p_types) OR p_office_work_only)
      AND (p_terminal IS NULL OR terminal = p_terminal)
      AND (p_mode IS NULL OR receipt_mode = p_mode)
      AND (NOT p_office_work_only OR client_type = 'Corporate' OR linked_as_office_work
           OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (receipt_mode = 'Debt' AND (
            (p_debt_class = 'Office' AND (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work'))
            OR (p_debt_class = 'Individual' AND NOT (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')))))
      AND (p_query IS NULL OR p_query = '' OR (
            entry_ref ILIKE '%'||p_query||'%' OR consignee_name ILIKE '%'||p_query||'%'
            OR awb_tag_number ILIKE '%'||p_query||'%' OR route ILIKE '%'||p_query||'%'
            OR remark ILIKE '%'||p_query||'%' OR related_tx_id ILIKE '%'||p_query||'%'
            OR consignee_phone ILIKE '%'||p_query||'%' OR pickup_pin ILIKE '%'||p_query||'%'
            OR receipt_mode ILIKE '%'||p_query||'%' OR amount::text ILIKE '%'||p_query||'%'))

    UNION ALL
    -- baggage
    SELECT 1, payment_mode,
           COALESCE(amount, 0), COALESCE(amount_paid, 0), COALESCE(retrieved_amount, 0),
           COALESCE(wallet_deduction_amount, 0),
           (client_type = 'Corporate' OR linked_as_office_work OR corporate_client_id IS NOT NULL
              OR remark ~* 'office\s*work'),
           (payment_mode = 'Debt' AND COALESCE(amount_paid, 0) >= COALESCE(amount, 0))
    FROM public.manifests
    WHERE (p_types IS NULL OR 'baggage' = ANY(p_types) OR p_office_work_only)
      AND p_terminal IS NULL
      AND (p_mode IS NULL OR payment_mode = p_mode)
      AND (NOT p_office_work_only OR client_type = 'Corporate' OR linked_as_office_work
           OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (payment_mode = 'Debt' AND (
            (p_debt_class = 'Office' AND (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work'))
            OR (p_debt_class = 'Individual' AND NOT (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')))))
      AND (p_query IS NULL OR p_query = '' OR (
            transaction_id ILIKE '%'||p_query||'%' OR passenger_name ILIKE '%'||p_query||'%'
            OR pnr ILIKE '%'||p_query||'%' OR flight_no ILIKE '%'||p_query||'%'
            OR destination ILIKE '%'||p_query||'%' OR remark ILIKE '%'||p_query||'%'
            OR related_tx_id ILIKE '%'||p_query||'%' OR passenger_phone ILIKE '%'||p_query||'%'
            OR payment_mode ILIKE '%'||p_query||'%' OR amount::text ILIKE '%'||p_query||'%'))

    UNION ALL
    -- marketing (inverted columns: amount_paid is the real sale total,
    -- debt_amount_paid is running debt repayment)
    SELECT 1, payment_mode,
           COALESCE(amount_paid, 0) AS amount, COALESCE(debt_amount_paid, 0) AS amount_paid,
           COALESCE(retrieved_amount, 0), COALESCE(wallet_deduction_amount, 0),
           (client_type = 'Corporate' OR linked_as_office_work OR corporate_client_id IS NOT NULL
              OR remark ~* 'office\s*work'),
           (payment_mode = 'Debt' AND COALESCE(debt_amount_paid, 0) >= COALESCE(amount_paid, 0))
    FROM public.marketing_entries
    WHERE (p_types IS NULL OR 'marketing' = ANY(p_types) OR p_office_work_only)
      AND p_terminal IS NULL
      AND (p_mode IS NULL OR payment_mode = p_mode)
      AND (NOT p_office_work_only OR client_type = 'Corporate' OR linked_as_office_work
           OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (payment_mode = 'Debt' AND (
            (p_debt_class = 'Office' AND (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work'))
            OR (p_debt_class = 'Individual' AND NOT (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')))))
      AND (p_query IS NULL OR p_query = '' OR (
            entry_ref ILIKE '%'||p_query||'%' OR customer_name ILIKE '%'||p_query||'%'
            OR awb_tag_number ILIKE '%'||p_query||'%' OR route ILIKE '%'||p_query||'%'
            OR remark ILIKE '%'||p_query||'%' OR related_tx_id ILIKE '%'||p_query||'%'
            OR customer_phone ILIKE '%'||p_query||'%' OR payment_mode ILIKE '%'||p_query||'%'
            OR amount_paid::text ILIKE '%'||p_query||'%'))

    UNION ALL
    -- package
    SELECT 1, payment_mode,
           COALESCE(amount, 0), COALESCE(amount_paid, 0), COALESCE(retrieved_amount, 0),
           COALESCE(wallet_deduction_amount, 0),
           (client_type = 'Corporate' OR linked_as_office_work OR corporate_client_id IS NOT NULL
              OR remark ~* 'office\s*work'),
           (payment_mode = 'Debt' AND (debt_paid IS TRUE OR COALESCE(amount_paid, 0) >= COALESCE(amount, 0)))
    FROM public.package_entries
    WHERE (p_types IS NULL OR 'package' = ANY(p_types) OR p_office_work_only)
      AND (p_terminal IS NULL OR terminal = p_terminal)
      AND (p_mode IS NULL OR payment_mode = p_mode)
      AND (NOT p_office_work_only OR client_type = 'Corporate' OR linked_as_office_work
           OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')
      AND (p_debt_class IS NULL OR (payment_mode = 'Debt' AND (
            (p_debt_class = 'Office' AND (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work'))
            OR (p_debt_class = 'Individual' AND NOT (client_type = 'Corporate' OR linked_as_office_work
               OR corporate_client_id IS NOT NULL OR remark ~* 'office\s*work')))))
      AND (p_query IS NULL OR p_query = '' OR (
            entry_ref ILIKE '%'||p_query||'%' OR customer_name ILIKE '%'||p_query||'%'
            OR destination ILIKE '%'||p_query||'%' OR remark ILIKE '%'||p_query||'%'
            OR related_tx_id ILIKE '%'||p_query||'%' OR customer_phone ILIKE '%'||p_query||'%'
            OR payment_mode ILIKE '%'||p_query||'%' OR amount::text ILIKE '%'||p_query||'%'))

    UNION ALL
    -- expenses: sign flips to -1, mode falls back to a value that will
    -- never equal 'Cash'/'Transfer'/'POS'/'Debt'/'Wallet' when the DB
    -- column is null, amount_paid/retrieved_amount/wallet_deduction_
    -- amount/is_office/is_debt_paid are inapplicable so passed as
    -- 0/0/0/false/false.
    SELECT -1, COALESCE(mode, 'Expense'),
           COALESCE(amount, 0), 0::numeric, 0::numeric, 0::numeric, false, false
    FROM public.expenses
    WHERE p_include_expenses
      AND NOT p_office_work_only
      AND (p_types IS NULL OR cardinality(p_types) = 0)  -- see ledger_search_page's matching comment
      AND p_terminal IS NULL AND p_debt_class IS NULL
      AND (p_mode IS NULL OR mode = p_mode)
      -- id is uuid, not text (see 20260938's matching comment in
      -- ledger_search_page) -- needs an explicit cast for ILIKE.
      AND (p_query IS NULL OR p_query = '' OR (
            id::text ILIKE '%'||p_query||'%' OR category ILIKE '%'||p_query||'%'
            OR description ILIKE '%'||p_query||'%' OR amount::text ILIKE '%'||p_query||'%'))
  )
  SELECT
    COALESCE(SUM(sign * amount) FILTER (WHERE NOT is_debt_paid), 0) AS total_amount,
    COALESCE(SUM(sign * amount) FILTER (WHERE mode = 'Cash'), 0) AS cash_amount,
    COALESCE(SUM(sign * amount) FILTER (WHERE mode = 'Transfer'), 0) AS transfer_amount,
    COALESCE(SUM(sign * amount) FILTER (WHERE mode = 'POS'), 0) AS pos_amount,
    COALESCE(SUM(GREATEST(amount - amount_paid - retrieved_amount, 0)) FILTER (WHERE mode = 'Debt'), 0) AS debt_amount,
    COALESCE(SUM(CASE WHEN wallet_deduction_amount > 0 THEN wallet_deduction_amount
                       WHEN mode = 'Wallet' THEN amount ELSE 0 END), 0) AS wallet_amount,
    COUNT(*) FILTER (WHERE mode = 'Debt') AS unpaid_debt_count,
    COALESCE(SUM(GREATEST(amount - amount_paid - retrieved_amount, 0)) FILTER (WHERE mode = 'Debt' AND is_office), 0) AS office_debt_amount,
    COALESCE(SUM(GREATEST(amount - amount_paid - retrieved_amount, 0)) FILTER (WHERE mode = 'Debt' AND NOT is_office), 0) AS individual_debt_amount,
    COUNT(*) AS row_count
  FROM agg_rows;
$$;

GRANT EXECUTE ON FUNCTION public.ledger_search_totals(
  text, text[], text, text, boolean, text, boolean
) TO authenticated;
