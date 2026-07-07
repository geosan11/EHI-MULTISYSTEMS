-- cargo_entries and manifests use "amount" as their sale-amount column, so
-- adding "amount_paid" here is safe and unambiguous.
ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- marketing_entries ALREADY has an "amount_paid" column (see
-- 20260706_full_schema.sql), and per this app's convention that column
-- holds the transaction's actual sale amount (Transaction.amount is read
-- from amount_paid for marketing rows) -- "amount" itself sits unused.
-- Reusing amount_paid here for partial-debt-repayment tracking would
-- silently overwrite the real sale amount every time a debt payment is
-- recorded, so marketing debt repayments get their own column instead.
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS debt_amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;
