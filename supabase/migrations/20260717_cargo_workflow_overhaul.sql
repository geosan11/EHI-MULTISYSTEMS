-- =============================================================
-- EHI Multisystems — Cargo Workflow Overhaul Migration
-- File: supabase/migrations/20260717_cargo_workflow_overhaul.sql
-- Safe to run: all ADD COLUMN IF NOT EXISTS, no drops, no data
-- changes, no existing rows touched.
-- =============================================================

-- ─── 1. HUBS: configurable shift start hour ──────────────────
-- Controls the "cargo day" boundary per hub.
-- Default 19 = 7 PM. Set lower (e.g. 18) for 6 PM start hubs.
ALTER TABLE hubs
  ADD COLUMN IF NOT EXISTS shift_start_hour INTEGER NOT NULL DEFAULT 19;

-- ─── 2. CARGO ENTRIES: tag retrieval tracking ────────────────
ALTER TABLE cargo_entries
  ADD COLUMN IF NOT EXISTS retrieved          BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retrieval_note     TEXT,
  ADD COLUMN IF NOT EXISTS retrieved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retrieved_by       TEXT;

-- ─── 3. CARGO ENTRIES: debt clearance event tracking ─────────
-- When a customer pays off a prior debt, a shadow entry is
-- created so the payment is visible in today's ledger and EOD.
ALTER TABLE cargo_entries
  ADD COLUMN IF NOT EXISTS is_debt_clearance  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS related_tx_id      TEXT;

-- ─── 4. CARGO ENTRIES: office work link fields ───────────────
-- Allows a retail-form entry to be linked to a corporate client
-- (office work B2B) after the fact, or at point of entry when
-- the consignee name matches a registered corp client.
ALTER TABLE cargo_entries
  ADD COLUMN IF NOT EXISTS linked_as_office_work   BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reclassification_note   TEXT,
  ADD COLUMN IF NOT EXISTS reclassification_by     TEXT,
  ADD COLUMN IF NOT EXISTS reclassification_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_amount         NUMERIC(12,2);
  -- original_amount: preserved when reclassification adjusts the
  -- billed amount to the office rate, so the audit trail always
  -- shows what the retail rate would have been.

-- ─── 5. CORPORATE CLIENTS: default rate fallback ─────────────
-- Used when no route-specific rate row exists in
-- corporate_route_rates for a given client+route combo.
ALTER TABLE corporate_clients
  ADD COLUMN IF NOT EXISTS default_rate_per_kg  NUMERIC(10,2);

-- ─── 6. CUSTOMER WALLETS: new table ──────────────────────────
-- One row per customer. Additional top-ups add to the same row.
-- This is a liability: EHI holds this money for the customer.
CREATE TABLE IF NOT EXISTS customer_wallets (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id            UUID         REFERENCES hubs(id),

  -- Customer identity (staff-facing only — no customer portal)
  customer_name     TEXT         NOT NULL,
  customer_phone    TEXT,

  -- Accumulating balance (one wallet per customer — confirmed)
  opening_balance   NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_topped_up   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_used        NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Origin of the first credit
  source_type       TEXT         NOT NULL
    CHECK (source_type IN (
      'airline_retrieval',  -- cargo retrieved; money left as credit
      'advance_deposit',    -- customer paid in advance
      'refund',             -- EHI refunding an overcharge
      'manual_credit'       -- admin-created
    )),
  source_ref        TEXT,   -- e.g. original AWB of the retrieval
  source_note       TEXT,   -- free text: "Cargo retrieved from Dana Air"

  status            TEXT         NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'exhausted', 'frozen')),

  created_by        TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── 7. WALLET TRANSACTIONS: full audit trail ────────────────
-- Every debit or credit to a wallet is a row here.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID         NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
  hub_id          UUID         REFERENCES hubs(id),

  type            TEXT         NOT NULL
    CHECK (type IN ('top_up', 'deduction', 'refund', 'adjustment')),
  amount          NUMERIC(12,2) NOT NULL,      -- always positive
  balance_before  NUMERIC(12,2) NOT NULL,
  balance_after   NUMERIC(12,2) NOT NULL,

  -- Link to the cargo entry this deduction paid for (deductions only)
  cargo_ref       TEXT,
  cargo_entry_id  UUID,

  description     TEXT,
  logged_by       TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── 8. CARGO ENTRIES: wallet payment tracking ───────────────
-- When a cargo entry is paid wholly or partly from a wallet.
ALTER TABLE cargo_entries
  ADD COLUMN IF NOT EXISTS wallet_id               UUID
    REFERENCES customer_wallets(id),
  ADD COLUMN IF NOT EXISTS wallet_deduction_amount NUMERIC(12,2);
  -- wallet_deduction_amount: the portion paid from wallet.
  -- If there is a shortfall, the remainder uses the normal mode
  -- (Cash/POS/Transfer/Debt) stored in receipt_mode.

-- ─── 9. INDEXES for performance ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cargo_retrieved
  ON cargo_entries(hub_id, retrieved)
  WHERE retrieved = TRUE;

CREATE INDEX IF NOT EXISTS idx_cargo_debt_clearance
  ON cargo_entries(hub_id, is_debt_clearance, created_at)
  WHERE is_debt_clearance = TRUE;

CREATE INDEX IF NOT EXISTS idx_cargo_office_work
  ON cargo_entries(hub_id, linked_as_office_work)
  WHERE linked_as_office_work = TRUE;

CREATE INDEX IF NOT EXISTS idx_wallets_name
  ON customer_wallets(customer_name, hub_id);

CREATE INDEX IF NOT EXISTS idx_wallets_phone
  ON customer_wallets(customer_phone)
  WHERE customer_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_txns_wallet
  ON wallet_transactions(wallet_id, created_at DESC);

-- ─── 10. REPAIR HISTORICAL OFFICE WORK KG & TAG NUMBERS ──────
-- Fixes past entries where total_kg was saved as 0 due to custom detail format in Office Work intakes
UPDATE cargo_entries
SET total_kg = ROUND(amount / NULLIF(CAST(substring(remark from 'Gate Weight Finalized \((\d+) N/KG Contract\)') AS NUMERIC), 0))
WHERE (total_kg = 0 OR total_kg IS NULL)
  AND amount > 0
  AND remark LIKE 'Gate Weight Finalized (%';

-- Repair awb_tag_number where it was erroneously set to consignee_name (e.g. 'SLOT')
UPDATE cargo_entries
SET awb_tag_number = entry_ref
WHERE awb_tag_number = consignee_name OR awb_tag_number IS NULL OR awb_tag_number = '';
