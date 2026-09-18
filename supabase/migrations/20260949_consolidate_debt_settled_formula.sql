-- =============================================================
-- ledger_search_totals: fix is_debt_paid drift (missing
-- retrieved_amount) and the unpaid_debt_count/debt_amount split that
-- let a cargo agent see "1 unpaid debt" alongside "₦0 outstanding"
-- for the same customer
-- =============================================================
-- Bug (confirmed by reading 20260938_ledger_search_and_totals_rpc.sql):
-- each department branch's is_debt_paid (lines ~318/344/371/397) was
-- `mode = 'Debt' AND amount_paid >= amount` -- missing "+ retrieved_amount",
-- unlike every client-side formula (src/lib/ledgerSearch.ts,
-- src/components/EHIApp.tsx) which has always included it. Separately,
-- debt_amount/office_debt_amount/individual_debt_amount (using
-- GREATEST(amount - amount_paid - retrieved_amount, 0)) DID already
-- account for retrieved_amount and for the arithmetic side of settlement,
-- but unpaid_debt_count counted ANY mode='Debt' row with no settlement
-- check at all -- so a debt settled entirely via retrieved_amount (netting
-- debt_amount to 0) still counted as 1 unpaid debt. Package's legacy
-- debt_paid boolean was also never factored into unpaid_debt_count/
-- debt_amount at all, only into is_debt_paid (and therefore only into
-- total_amount).
--
-- Fix: one small SQL function, is_debt_settled, mirrors
-- src/lib/debtStatus.ts's isDebtSettled() exactly (same 4 inputs, same
-- rule) so the client and this RPC can no longer independently drift the
-- way they already had. LANGUAGE sql (not plpgsql) so Postgres can inline
-- it into the surrounding query plan -- this RPC scans 4 tables via
-- UNION ALL per request, so a per-row plpgsql call would add real
-- overhead here that a single inlineable SQL expression does not.
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_debt_settled(
  p_paid         numeric,
  p_retrieved    numeric,
  p_total        numeric,
  p_legacy_flag  boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_legacy_flag, false)
      OR (COALESCE(p_paid, 0) + COALESCE(p_retrieved, 0)) >= COALESCE(p_total, 0);
$$;

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
           (receipt_mode = 'Debt' AND public.is_debt_settled(amount_paid, retrieved_amount, amount, false)) AS is_debt_paid
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
           (payment_mode = 'Debt' AND public.is_debt_settled(amount_paid, retrieved_amount, amount, false))
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
           (payment_mode = 'Debt' AND public.is_debt_settled(debt_amount_paid, retrieved_amount, amount_paid, false))
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
    -- package (also has the legacy debt_paid boolean -- passed through as
    -- is_debt_settled's 4th arg instead of OR'd in ad hoc as before)
    SELECT 1, payment_mode,
           COALESCE(amount, 0), COALESCE(amount_paid, 0), COALESCE(retrieved_amount, 0),
           COALESCE(wallet_deduction_amount, 0),
           (client_type = 'Corporate' OR linked_as_office_work OR corporate_client_id IS NOT NULL
              OR remark ~* 'office\s*work'),
           (payment_mode = 'Debt' AND public.is_debt_settled(amount_paid, retrieved_amount, amount, debt_paid))
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
    -- Now gated on the SAME is_debt_paid used by total_amount above, so a
    -- debt settled via retrieved_amount or (package) the legacy debt_paid
    -- flag correctly nets to 0 here too, instead of only in total_amount.
    COALESCE(SUM(GREATEST(amount - amount_paid - retrieved_amount, 0)) FILTER (WHERE mode = 'Debt' AND NOT is_debt_paid), 0) AS debt_amount,
    COALESCE(SUM(CASE WHEN wallet_deduction_amount > 0 THEN wallet_deduction_amount
                       WHEN mode = 'Wallet' THEN amount ELSE 0 END), 0) AS wallet_amount,
    -- Previously counted every literal mode='Debt' row regardless of
    -- settlement, so a customer could see "1 unpaid debt" next to "₦0
    -- outstanding" (debt_amount) for the very same row.
    COUNT(*) FILTER (WHERE mode = 'Debt' AND NOT is_debt_paid) AS unpaid_debt_count,
    COALESCE(SUM(GREATEST(amount - amount_paid - retrieved_amount, 0)) FILTER (WHERE mode = 'Debt' AND NOT is_debt_paid AND is_office), 0) AS office_debt_amount,
    COALESCE(SUM(GREATEST(amount - amount_paid - retrieved_amount, 0)) FILTER (WHERE mode = 'Debt' AND NOT is_debt_paid AND NOT is_office), 0) AS individual_debt_amount,
    COUNT(*) AS row_count
  FROM agg_rows;
$$;

GRANT EXECUTE ON FUNCTION public.is_debt_settled(numeric, numeric, numeric, boolean) TO authenticated;
