-- ============================================================
-- LEDGER SEARCH PAGE -- bound each UNION branch's sort (perf fix)
-- ============================================================
-- Follow-up to 20260938_ledger_search_and_totals_rpc.sql. That migration's
-- ledger_search_page put its `ORDER BY created_at DESC, entry_id DESC
-- LIMIT p_limit` OUTSIDE the 5-way UNION ALL (over the whole `unified`
-- CTE) -- Postgres has no way to stop early per table with that shape, so
-- every page fetch forced gathering ALL matching rows from cargo_entries/
-- manifests/marketing_entries/package_entries/expenses before it could
-- sort and take the top N. No index in this schema leads with
-- created_at/entry_id (every relevant index is (hub_id, created_at DESC)
-- -- see 20260706_full_schema.sql, 20260709_package_desk.sql,
-- 20260702_scale_indexes.sql, 20260726_outbound_arrivals_indexes.sql), so
-- this was a real sort over the hub-scoped matching set every time, not
-- an index seek. Worse for admin/super_admin/accountant/auditor, whose
-- is_hub_unrestricted() (20260708_hub_isolation_rls.sql) exempts them
-- from hub filtering entirely -- for them this was a genuine
-- company-wide, all-history sort on every page.
--
-- Fix: give each UNION branch its own ORDER BY + LIMIT p_limit INSIDE the
-- branch, before the union. This is the standard, correct pattern for
-- "top-N over a union of independently-indexed tables": the true top-N of
-- the combined result can never include more than N rows from any single
-- branch, so each branch independently limiting to p_limit is provably
-- safe for correctness, while letting Postgres use the existing
-- (hub_id, created_at DESC) per-table indexes to drive a bounded index
-- scan instead of sorting the whole matching set. The outer query then
-- only needs to re-sort <= 5 * p_limit rows and take the real top
-- p_limit -- fixed, small cost regardless of total table size. The
-- keyset cursor predicate moves inside each branch too, referencing each
-- table's own native id column (entry_ref/transaction_id/id) before it
-- gets aliased to entry_id in the branch's own SELECT list.
--
-- Every filter predicate, security posture (SECURITY INVOKER, unchanged
-- deliberately -- see 20260938's header comment on why), and the
-- function's signature/return type are IDENTICAL to 20260938's version --
-- only the query's internal shape changes. ledger_search_totals is not
-- touched here: it computes true SUM/COUNT across every matching row by
-- design, so there's no LIMIT-pushdown equivalent for it.
CREATE OR REPLACE FUNCTION public.ledger_search_page(
  p_query             text DEFAULT NULL,
  p_types             text[] DEFAULT NULL,
  p_terminal          text DEFAULT NULL,
  p_mode              text DEFAULT NULL,
  p_office_work_only  boolean DEFAULT false,
  p_debt_class        text DEFAULT NULL,
  p_include_expenses  boolean DEFAULT true,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_entry_id   text DEFAULT NULL,
  p_limit             integer DEFAULT 500
)
RETURNS TABLE(entry_type text, entry_id text, created_at timestamptz, raw jsonb)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH unified AS (
    SELECT entry_type, entry_id, created_at, raw FROM (
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
        AND (p_cursor_created_at IS NULL OR (c.created_at, c.entry_ref) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY c.created_at DESC, c.entry_ref DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) cargo_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'baggage'::text AS entry_type, m.transaction_id AS entry_id, m.created_at, to_jsonb(m) AS raw
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
        AND (p_cursor_created_at IS NULL OR (m.created_at, m.transaction_id) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY m.created_at DESC, m.transaction_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) baggage_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'marketing'::text AS entry_type, k.entry_ref AS entry_id, k.created_at, to_jsonb(k) AS raw
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
        AND (p_cursor_created_at IS NULL OR (k.created_at, k.entry_ref) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY k.created_at DESC, k.entry_ref DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) marketing_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'package'::text AS entry_type, p.entry_ref AS entry_id, p.created_at, to_jsonb(p) AS raw
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
        AND (p_cursor_created_at IS NULL OR (p.created_at, p.entry_ref) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY p.created_at DESC, p.entry_ref DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) package_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      -- e.id::text, not bare e.id -- every other branch's entry_id
      -- (entry_ref/transaction_id) is text, and this column position
      -- must resolve to ONE common type across all 5 UNION ALL branches
      -- below; uuid and text have no implicit cast (only assignment,
      -- which doesn't cover UNION's type resolution), so a bare e.id
      -- here would fail the whole `unified` CTE to parse -- separately
      -- from the ILIKE/cursor casts further down, which need their own
      -- explicit ::text for the same underlying reason.
      SELECT 'expense'::text AS entry_type, e.id::text AS entry_id, e.created_at, to_jsonb(e) AS raw
      FROM public.expenses e
      WHERE p_include_expenses
        AND NOT p_office_work_only  -- expenses have no office-work columns
        -- NULL p_types = "All" typeFilter (expenses included alongside
        -- every other type); an EMPTY (non-null) p_types array is the
        -- client's explicit "Expense" typeFilter signal -- see
        -- 20260938's matching comment on this same condition.
        AND (p_types IS NULL OR cardinality(p_types) = 0)
        AND p_terminal IS NULL AND p_debt_class IS NULL  -- expenses are never Debt-mode
        AND (p_mode IS NULL OR e.mode = p_mode)
        AND (p_query IS NULL OR p_query = '' OR (
              e.id::text ILIKE '%'||p_query||'%' OR e.category ILIKE '%'||p_query||'%'
              OR e.description ILIKE '%'||p_query||'%' OR e.amount::text ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (e.created_at, e.id::text) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY e.created_at DESC, entry_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) expense_page
  )
  SELECT entry_type, entry_id, created_at, raw
  FROM unified
  ORDER BY created_at DESC, entry_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

GRANT EXECUTE ON FUNCTION public.ledger_search_page(
  text, text[], text, text, boolean, text, boolean, timestamptz, text, integer
) TO authenticated;

-- ============================================================
-- Missing search-column trigram indexes
-- ============================================================
-- 20260938 only indexed consignee_name/passenger_name/customer_name/
-- remark/description -- but ledger_search_page's p_query ILIKE chain
-- above also searches entry_ref/awb_tag_number/route/pickup_pin/
-- related_tx_id/consignee_phone (cargo), transaction_id/pnr/flight_no/
-- destination/passenger_phone/related_tx_id (baggage), entry_ref/
-- awb_tag_number/route/related_tx_id/customer_phone (marketing),
-- entry_ref/destination/related_tx_id/customer_phone (package), and id/
-- category (expenses), none of which had any index. Since these are all
-- OR'd into one predicate with p_query, missing coverage on any one of
-- them forces a scan-based OR evaluation regardless of the indexes that
-- do exist -- this only matters once a user actually searches while in
-- All Time (an empty p_query short-circuits the whole ILIKE chain), not
-- on the plain "click All Time" case the LIMIT pushdown above fixes, but
-- it's cheap and safe (IF NOT EXISTS throughout) to close the gap now
-- while this migration is already touching the same tables.
CREATE INDEX IF NOT EXISTS cargo_entries_entry_ref_trgm_idx
  ON public.cargo_entries USING gin (entry_ref gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_awb_tag_number_trgm_idx
  ON public.cargo_entries USING gin (awb_tag_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_route_trgm_idx
  ON public.cargo_entries USING gin (route gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_pickup_pin_trgm_idx
  ON public.cargo_entries USING gin (pickup_pin gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_related_tx_id_trgm_idx
  ON public.cargo_entries USING gin (related_tx_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cargo_entries_consignee_phone_trgm_idx
  ON public.cargo_entries USING gin (consignee_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS manifests_transaction_id_trgm_idx
  ON public.manifests USING gin (transaction_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_pnr_trgm_idx
  ON public.manifests USING gin (pnr gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_flight_no_trgm_idx
  ON public.manifests USING gin (flight_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_destination_trgm_idx
  ON public.manifests USING gin (destination gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_passenger_phone_trgm_idx
  ON public.manifests USING gin (passenger_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manifests_related_tx_id_trgm_idx
  ON public.manifests USING gin (related_tx_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS marketing_entries_entry_ref_trgm_idx
  ON public.marketing_entries USING gin (entry_ref gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_awb_tag_number_trgm_idx
  ON public.marketing_entries USING gin (awb_tag_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_route_trgm_idx
  ON public.marketing_entries USING gin (route gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_related_tx_id_trgm_idx
  ON public.marketing_entries USING gin (related_tx_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS marketing_entries_customer_phone_trgm_idx
  ON public.marketing_entries USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS package_entries_entry_ref_trgm_idx
  ON public.package_entries USING gin (entry_ref gin_trgm_ops);
CREATE INDEX IF NOT EXISTS package_entries_destination_trgm_idx
  ON public.package_entries USING gin (destination gin_trgm_ops);
CREATE INDEX IF NOT EXISTS package_entries_related_tx_id_trgm_idx
  ON public.package_entries USING gin (related_tx_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS package_entries_customer_phone_trgm_idx
  ON public.package_entries USING gin (customer_phone gin_trgm_ops);

-- id is uuid, not text -- an expression index over the cast, matching
-- the e.id::text ILIKE predicate above so the planner can actually use it.
CREATE INDEX IF NOT EXISTS expenses_id_trgm_idx
  ON public.expenses USING gin ((id::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS expenses_category_trgm_idx
  ON public.expenses USING gin (category gin_trgm_ops);
