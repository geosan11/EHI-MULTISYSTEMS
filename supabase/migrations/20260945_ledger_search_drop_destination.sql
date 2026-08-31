-- ============================================================
-- LEDGER SEARCH -- drop route/destination from free-text matching
-- ============================================================
-- Route/destination is moving to its own dedicated filter dropdown in
-- TransactionLedger.tsx (matching the existing vjDestFilter precedent,
-- generalized to every entry type) instead of being one more ILIKE branch
-- in the free-text search. Byte-identical to 20260941_debt_collection_
-- events.sql's ledger_search_page/ledger_search_totals otherwise -- the
-- ONLY change in each function is removing the `route`/`destination`
-- ILIKE term from the 4 real-row search predicates (cargo/baggage/
-- marketing/package); the 4 debt-collection synthetic-row legs never
-- searched route/destination in the first place, so nothing changes there.
--
-- Not a fix for the "search 'ab' hits a snag" bug on its own -- that's a
-- pg_trgm limitation (GIN trigram indexes are unusable below 3 characters,
-- so a short query forces a full table scan regardless of which columns
-- are ILIKE'd, and ledger_search_totals has no LIMIT at all) fixed
-- separately, client-side, by refusing to commit a 1-2 character search
-- in TransactionLedger.tsx. This migration is purely the "stop searching
-- by destination" UX change requested alongside it.
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
              OR c.awb_tag_number ILIKE '%'||p_query||'%'
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
        AND p_terminal IS NULL
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
              OR m.remark ILIKE '%'||p_query||'%'
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
        AND p_terminal IS NULL
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
              OR k.awb_tag_number ILIKE '%'||p_query||'%'
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
              OR p.remark ILIKE '%'||p_query||'%'
              OR p.related_tx_id ILIKE '%'||p_query||'%' OR p.customer_phone ILIKE '%'||p_query||'%'
              OR p.payment_mode ILIKE '%'||p_query||'%' OR p.amount::text ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (p.created_at, p.entry_ref) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY p.created_at DESC, p.entry_ref DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) package_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'expense'::text AS entry_type, e.id::text AS entry_id, e.created_at, to_jsonb(e) AS raw
      FROM public.expenses e
      WHERE p_include_expenses
        AND NOT p_office_work_only
        AND (p_types IS NULL OR cardinality(p_types) = 0)
        AND p_terminal IS NULL AND p_debt_class IS NULL
        AND (p_mode IS NULL OR e.mode = p_mode)
        AND (p_query IS NULL OR p_query = '' OR (
              e.id::text ILIKE '%'||p_query||'%' OR e.category ILIKE '%'||p_query||'%'
              OR e.description ILIKE '%'||p_query||'%' OR e.amount::text ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (e.created_at, e.id::text) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY e.created_at DESC, entry_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) expense_page

    UNION ALL

    -- Debt-collection events -- unchanged from 20260941; never searched
    -- route/destination in the first place.
    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'cargo'::text AS entry_type, x.entry_id, x.created_at, x.raw
      FROM public.cargo_debt_collection_rows(NULL, NULL, NULL) x
      WHERE p_debt_class IS NULL
        AND (p_types IS NULL OR 'cargo' = ANY(p_types) OR p_office_work_only)
        AND (p_terminal IS NULL OR x.raw->>'terminal' = p_terminal)
        AND (p_mode IS NULL OR x.raw->>'receipt_mode' = p_mode)
        AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
             OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
             OR x.raw->>'remark' ~* 'office\s*work')
        AND (p_query IS NULL OR p_query = '' OR (
              x.raw->>'entry_ref' ILIKE '%'||p_query||'%' OR x.raw->>'consignee_name' ILIKE '%'||p_query||'%'
              OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'receipt_mode' ILIKE '%'||p_query||'%'
              OR (x.raw->>'amount') ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (x.created_at, x.entry_id) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY x.created_at DESC, x.entry_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) cargo_dc_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'baggage'::text AS entry_type, x.entry_id, x.created_at, x.raw
      FROM public.baggage_debt_collection_rows(NULL, NULL, NULL) x
      WHERE p_debt_class IS NULL
        AND (p_types IS NULL OR 'baggage' = ANY(p_types) OR p_office_work_only)
        AND p_terminal IS NULL
        AND (p_mode IS NULL OR x.raw->>'payment_mode' = p_mode)
        AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
             OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
             OR x.raw->>'remark' ~* 'office\s*work')
        AND (p_query IS NULL OR p_query = '' OR (
              x.raw->>'transaction_id' ILIKE '%'||p_query||'%' OR x.raw->>'passenger_name' ILIKE '%'||p_query||'%'
              OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'payment_mode' ILIKE '%'||p_query||'%'
              OR (x.raw->>'amount') ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (x.created_at, x.entry_id) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY x.created_at DESC, x.entry_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) baggage_dc_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'marketing'::text AS entry_type, x.entry_id, x.created_at, x.raw
      FROM public.marketing_debt_collection_rows(NULL, NULL, NULL) x
      WHERE p_debt_class IS NULL
        AND (p_types IS NULL OR 'marketing' = ANY(p_types) OR p_office_work_only)
        AND p_terminal IS NULL
        AND (p_mode IS NULL OR x.raw->>'payment_mode' = p_mode)
        AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
             OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
             OR x.raw->>'remark' ~* 'office\s*work')
        AND (p_query IS NULL OR p_query = '' OR (
              x.raw->>'entry_ref' ILIKE '%'||p_query||'%' OR x.raw->>'customer_name' ILIKE '%'||p_query||'%'
              OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'payment_mode' ILIKE '%'||p_query||'%'
              OR (x.raw->>'amount_paid') ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (x.created_at, x.entry_id) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY x.created_at DESC, x.entry_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) marketing_dc_page

    UNION ALL

    SELECT entry_type, entry_id, created_at, raw FROM (
      SELECT 'package'::text AS entry_type, x.entry_id, x.created_at, x.raw
      FROM public.package_debt_collection_rows(NULL, NULL, NULL) x
      WHERE p_debt_class IS NULL
        AND (p_types IS NULL OR 'package' = ANY(p_types) OR p_office_work_only)
        AND (p_terminal IS NULL OR x.raw->>'terminal' = p_terminal)
        AND (p_mode IS NULL OR x.raw->>'payment_mode' = p_mode)
        AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
             OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
             OR x.raw->>'remark' ~* 'office\s*work')
        AND (p_query IS NULL OR p_query = '' OR (
              x.raw->>'entry_ref' ILIKE '%'||p_query||'%' OR x.raw->>'customer_name' ILIKE '%'||p_query||'%'
              OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'payment_mode' ILIKE '%'||p_query||'%'
              OR (x.raw->>'amount') ILIKE '%'||p_query||'%'
            ))
        AND (p_cursor_created_at IS NULL OR (x.created_at, x.entry_id) < (p_cursor_created_at, p_cursor_entry_id))
      ORDER BY x.created_at DESC, x.entry_id DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    ) package_dc_page
  )
  SELECT entry_type, entry_id, created_at, raw
  FROM unified
  ORDER BY created_at DESC, entry_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

GRANT EXECUTE ON FUNCTION public.ledger_search_page(
  text, text[], text, text, boolean, text, boolean, timestamptz, text, integer
) TO authenticated;

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
           (receipt_mode = 'Debt') AS is_debt_mode
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
            OR awb_tag_number ILIKE '%'||p_query||'%'
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
           (payment_mode = 'Debt')
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
            OR remark ILIKE '%'||p_query||'%'
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
           (payment_mode = 'Debt')
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
            OR awb_tag_number ILIKE '%'||p_query||'%'
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
           (payment_mode = 'Debt')
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
            OR remark ILIKE '%'||p_query||'%'
            OR related_tx_id ILIKE '%'||p_query||'%' OR customer_phone ILIKE '%'||p_query||'%'
            OR payment_mode ILIKE '%'||p_query||'%' OR amount::text ILIKE '%'||p_query||'%'))

    UNION ALL
    -- expenses
    SELECT -1, COALESCE(mode, 'Expense'),
           COALESCE(amount, 0), 0::numeric, 0::numeric, 0::numeric, false, false
    FROM public.expenses
    WHERE p_include_expenses
      AND NOT p_office_work_only
      AND (p_types IS NULL OR cardinality(p_types) = 0)
      AND p_terminal IS NULL AND p_debt_class IS NULL
      AND (p_mode IS NULL OR mode = p_mode)
      AND (p_query IS NULL OR p_query = '' OR (
            id::text ILIKE '%'||p_query||'%' OR category ILIKE '%'||p_query||'%'
            OR description ILIKE '%'||p_query||'%' OR amount::text ILIKE '%'||p_query||'%'))

    UNION ALL
    -- debt-collection events -- unchanged from 20260941; always sign=1,
    -- never is_debt_mode, never searched route/destination.
    SELECT 1, x.raw->>'receipt_mode',
           COALESCE((x.raw->>'amount')::numeric, 0), COALESCE((x.raw->>'amount')::numeric, 0), 0::numeric,
           COALESCE((x.raw->>'wallet_deduction_amount')::numeric, 0),
           (x.raw->>'client_type' = 'Corporate' OR (x.raw->>'linked_as_office_work')::boolean
              OR x.raw->>'corporate_client_id' IS NOT NULL OR x.raw->>'remark' ~* 'office\s*work'),
           false
    FROM public.cargo_debt_collection_rows(NULL, NULL, NULL) x
    WHERE p_debt_class IS NULL
      AND (p_types IS NULL OR 'cargo' = ANY(p_types) OR p_office_work_only)
      AND (p_terminal IS NULL OR x.raw->>'terminal' = p_terminal)
      AND (p_mode IS NULL OR x.raw->>'receipt_mode' = p_mode)
      AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
           OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
           OR x.raw->>'remark' ~* 'office\s*work')
      AND (p_query IS NULL OR p_query = '' OR (
            x.raw->>'entry_ref' ILIKE '%'||p_query||'%' OR x.raw->>'consignee_name' ILIKE '%'||p_query||'%'
            OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'receipt_mode' ILIKE '%'||p_query||'%'
            OR (x.raw->>'amount') ILIKE '%'||p_query||'%'))

    UNION ALL
    SELECT 1, x.raw->>'payment_mode',
           COALESCE((x.raw->>'amount')::numeric, 0), COALESCE((x.raw->>'amount')::numeric, 0), 0::numeric,
           COALESCE((x.raw->>'wallet_deduction_amount')::numeric, 0),
           (x.raw->>'client_type' = 'Corporate' OR (x.raw->>'linked_as_office_work')::boolean
              OR x.raw->>'corporate_client_id' IS NOT NULL OR x.raw->>'remark' ~* 'office\s*work'),
           false
    FROM public.baggage_debt_collection_rows(NULL, NULL, NULL) x
    WHERE p_debt_class IS NULL
      AND (p_types IS NULL OR 'baggage' = ANY(p_types) OR p_office_work_only)
      AND p_terminal IS NULL
      AND (p_mode IS NULL OR x.raw->>'payment_mode' = p_mode)
      AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
           OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
           OR x.raw->>'remark' ~* 'office\s*work')
      AND (p_query IS NULL OR p_query = '' OR (
            x.raw->>'transaction_id' ILIKE '%'||p_query||'%' OR x.raw->>'passenger_name' ILIKE '%'||p_query||'%'
            OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'payment_mode' ILIKE '%'||p_query||'%'
            OR (x.raw->>'amount') ILIKE '%'||p_query||'%'))

    UNION ALL
    SELECT 1, x.raw->>'payment_mode',
           COALESCE((x.raw->>'amount_paid')::numeric, 0), COALESCE((x.raw->>'amount_paid')::numeric, 0), 0::numeric,
           COALESCE((x.raw->>'wallet_deduction_amount')::numeric, 0),
           (x.raw->>'client_type' = 'Corporate' OR (x.raw->>'linked_as_office_work')::boolean
              OR x.raw->>'corporate_client_id' IS NOT NULL OR x.raw->>'remark' ~* 'office\s*work'),
           false
    FROM public.marketing_debt_collection_rows(NULL, NULL, NULL) x
    WHERE p_debt_class IS NULL
      AND (p_types IS NULL OR 'marketing' = ANY(p_types) OR p_office_work_only)
      AND p_terminal IS NULL
      AND (p_mode IS NULL OR x.raw->>'payment_mode' = p_mode)
      AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
           OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
           OR x.raw->>'remark' ~* 'office\s*work')
      AND (p_query IS NULL OR p_query = '' OR (
            x.raw->>'entry_ref' ILIKE '%'||p_query||'%' OR x.raw->>'customer_name' ILIKE '%'||p_query||'%'
            OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'payment_mode' ILIKE '%'||p_query||'%'
            OR (x.raw->>'amount_paid') ILIKE '%'||p_query||'%'))

    UNION ALL
    SELECT 1, x.raw->>'payment_mode',
           COALESCE((x.raw->>'amount')::numeric, 0), COALESCE((x.raw->>'amount')::numeric, 0), 0::numeric,
           COALESCE((x.raw->>'wallet_deduction_amount')::numeric, 0),
           (x.raw->>'client_type' = 'Corporate' OR (x.raw->>'linked_as_office_work')::boolean
              OR x.raw->>'corporate_client_id' IS NOT NULL OR x.raw->>'remark' ~* 'office\s*work'),
           false
    FROM public.package_debt_collection_rows(NULL, NULL, NULL) x
    WHERE p_debt_class IS NULL
      AND (p_types IS NULL OR 'package' = ANY(p_types) OR p_office_work_only)
      AND (p_terminal IS NULL OR x.raw->>'terminal' = p_terminal)
      AND (p_mode IS NULL OR x.raw->>'payment_mode' = p_mode)
      AND (NOT p_office_work_only OR x.raw->>'client_type' = 'Corporate'
           OR (x.raw->>'linked_as_office_work')::boolean OR x.raw->>'corporate_client_id' IS NOT NULL
           OR x.raw->>'remark' ~* 'office\s*work')
      AND (p_query IS NULL OR p_query = '' OR (
            x.raw->>'entry_ref' ILIKE '%'||p_query||'%' OR x.raw->>'customer_name' ILIKE '%'||p_query||'%'
            OR x.raw->>'related_tx_id' ILIKE '%'||p_query||'%' OR x.raw->>'payment_mode' ILIKE '%'||p_query||'%'
            OR (x.raw->>'amount') ILIKE '%'||p_query||'%'))
  )
  SELECT
    COALESCE(SUM(sign * amount) FILTER (WHERE NOT is_debt_mode), 0) AS total_amount,
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
