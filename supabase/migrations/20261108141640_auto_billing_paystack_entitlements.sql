-- Migration: 20261108141640_auto_billing_paystack_entitlements.sql
-- Description: Automated Paystack Entitlement Singleton and Durable Billing Transactions.
--
-- Security hardening per Supabase RLS and security-definer guidelines:
-- 1. Singleton company entitlement table 'ehi_entitlement' with RLS.
-- 2. Revoked default public/anon/authenticated mutation grants (server service-role writes only).
-- 3. Read access for active authenticated EHI staff only.
-- 4. Durable 'billing_transactions' recording pre-init state, amounts, currency, and verification data.
-- 5. Atomic security-definer RPC 'apply_billing_grant_atomic' with pinned search_path ('SET search_path = ''')
--    and exclusive row-level locking (SELECT FOR UPDATE) to guarantee idempotency across concurrent
--    webhook and callback confirmation races.
-- 6. Strict rules: Never downgrade permanent buyout, never shorten longer paid_until,
--    bridge exact paid_until 2026-11-30T23:59:59+01:00, monthly max(existing, now) + 30 days,
--    and late bridge confirmation recorded as expired grant needing manual billing resolution (no automatic refund).

-- ---------------------------------------------------------------------------
-- 1. Singleton Company Entitlement Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehi_entitlement (
  company_id text PRIMARY KEY DEFAULT 'EHI' CONSTRAINT ehi_entitlement_singleton_chk CHECK (company_id = 'EHI'),
  plan text NOT NULL DEFAULT 'bridge' CHECK (plan IN ('bridge', 'monthly', 'handover', 'november-bridge', 'monthly-licence', 'system-handover')),
  is_active boolean NOT NULL DEFAULT false,
  is_permanent boolean NOT NULL DEFAULT false,
  paid_until timestamptz,
  last_reference text,
  last_amount_kobo bigint,
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  status text NOT NULL DEFAULT 'expired' CHECK (status IN ('active', 'expired', 'manual_resolution_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed singleton initial row if not exists
INSERT INTO public.ehi_entitlement (company_id, plan, is_active, is_permanent, paid_until, mode, status)
VALUES ('EHI', 'november-bridge', false, false, NULL, 'test', 'expired')
ON CONFLICT (company_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Durable Billing Transactions Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  account_id text NOT NULL DEFAULT 'EHI',
  plan text NOT NULL CHECK (plan IN ('november-bridge', 'monthly-licence', 'system-handover')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo IN (6300000, 18000000, 70000000)),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  status text NOT NULL DEFAULT 'initialized' CHECK (status IN ('initialized', 'success', 'failed', 'expired_bridge_resolution_required')),
  paystack_id text,
  paystack_data jsonb,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  initiated_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  entitlement_granted boolean NOT NULL DEFAULT false,
  grant_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_reference ON public.billing_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_status ON public.billing_transactions(status);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_initiated_at ON public.billing_transactions(initiated_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security & Grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.ehi_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;

-- Revoke all default table grants from public, anon, and authenticated
REVOKE ALL ON public.ehi_entitlement FROM public, anon, authenticated;
REVOKE ALL ON public.billing_transactions FROM public, anon, authenticated;

-- Allow authenticated active staff to read current company entitlement
CREATE POLICY "Allow active staff read entitlement"
  ON public.ehi_entitlement
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM public.user_profiles WHERE active = true
    )
  );

-- Allow authenticated active staff to read their own initiated transactions or admins to read all
CREATE POLICY "Allow staff read own transactions"
  ON public.billing_transactions
  FOR SELECT
  TO authenticated
  USING (
    initiated_by = auth.uid()
    OR auth.uid() IN (
      SELECT id FROM public.user_profiles WHERE role IN ('super_admin', 'admin') AND active = true
    )
  );

-- Grant SELECT only to authenticated users (no direct client INSERT/UPDATE/DELETE)
GRANT SELECT ON public.ehi_entitlement TO authenticated;
GRANT SELECT ON public.billing_transactions TO authenticated;

-- Service role has full permissions for backend operations
GRANT ALL ON public.ehi_entitlement TO service_role;
GRANT ALL ON public.billing_transactions TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Atomic Security-Definer Entitlement Grant Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_billing_grant_atomic(
  p_reference text,
  p_paystack_data jsonb,
  p_verified_amount_kobo bigint,
  p_verified_currency text,
  p_paystack_status text,
  p_mode text,
  p_paystack_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx public.billing_transactions%ROWTYPE;
  v_ent public.ehi_entitlement%ROWTYPE;
  v_bridge_cutoff timestamptz := '2026-11-30T23:59:59+01:00'::timestamptz;
  v_target_paid_until timestamptz;
  v_is_permanent boolean := false;
  v_is_active boolean := true;
  v_status text := 'active';
  v_grant_notes text := NULL;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- 1. Fetch and row-lock the transaction by reference
  SELECT * INTO v_tx
  FROM public.billing_transactions
  WHERE reference = p_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TRANSACTION_NOT_FOUND',
      'message', format('Transaction reference %s was not initialized.', p_reference)
    );
  END IF;

  -- 2. Idempotency Check: if already granted, return current state without re-applying
  IF v_tx.entitlement_granted = true THEN
    SELECT * INTO v_ent FROM public.ehi_entitlement WHERE company_id = 'EHI';
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reference', v_tx.reference,
      'plan', v_tx.plan,
      'is_active', v_ent.is_active,
      'is_permanent', v_ent.is_permanent,
      'paid_until', v_ent.paid_until,
      'status', v_ent.status
    );
  END IF;

  -- 3. Strict Verification of Parameters
  IF p_paystack_status != 'success' THEN
    UPDATE public.billing_transactions
    SET status = 'failed',
        paystack_data = p_paystack_data,
        updated_at = v_now
    WHERE reference = p_reference;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_NOT_SUCCESSFUL',
      'message', format('Paystack status is %s', p_paystack_status)
    );
  END IF;

  IF p_verified_currency != 'NGN' OR v_tx.currency != 'NGN' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CURRENCY',
      'message', 'Only NGN transactions are authorized.'
    );
  END IF;

  IF p_verified_amount_kobo != v_tx.amount_kobo THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'AMOUNT_MISMATCH',
      'message', format('Verified amount %s kobo does not match expected %s kobo.', p_verified_amount_kobo, v_tx.amount_kobo)
    );
  END IF;

  IF p_mode != v_tx.mode THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'MODE_MISMATCH',
      'message', format('Mode mismatch: transaction mode is %s, verification mode is %s.', v_tx.mode, p_mode)
    );
  END IF;

  -- 4. Lock and fetch Singleton Entitlement Row
  SELECT * INTO v_ent
  FROM public.ehi_entitlement
  WHERE company_id = 'EHI'
  FOR UPDATE;

  -- 5. Plan-specific entitlement calculations
  IF v_tx.plan = 'system-handover' THEN
    -- Full System Handover / Permanent Buyout
    v_is_permanent := true;
    v_is_active := true;
    v_target_paid_until := NULL;
    v_status := 'active';

  ELSIF v_tx.plan = 'november-bridge' THEN
    -- Bridge plan exact cutoff: 2026-11-30T23:59:59+01:00
    -- If confirmed AFTER cutoff, must never grant valid unlock. Record as expired grant needing manual billing resolution.
    IF v_now > v_bridge_cutoff THEN
      v_grant_notes := 'Late bridge payment confirmed after 2026-11-30T23:59:59+01:00. Manual billing resolution required, no automatic refund.';
      UPDATE public.billing_transactions
      SET status = 'expired_bridge_resolution_required',
          verified_at = v_now,
          paystack_id = COALESCE(p_paystack_id, v_tx.paystack_id),
          paystack_data = p_paystack_data,
          entitlement_granted = false,
          grant_notes = v_grant_notes,
          updated_at = v_now
      WHERE reference = p_reference;

      RETURN jsonb_build_object(
        'success', false,
        'error', 'LATE_BRIDGE_CONFIRMATION',
        'requires_manual_resolution', true,
        'message', v_grant_notes
      );
    ELSE
      -- Preserved precedence: If already permanent, keep permanent. Never downgrade.
      IF v_ent.is_permanent = true THEN
        v_is_permanent := true;
        v_is_active := true;
        v_target_paid_until := NULL;
        v_status := 'active';
      -- Never shorten longer paid_until
      ELSIF v_ent.paid_until IS NOT NULL AND v_ent.paid_until > v_bridge_cutoff THEN
        v_is_permanent := false;
        v_is_active := true;
        v_target_paid_until := v_ent.paid_until;
        v_status := 'active';
      ELSE
        v_is_permanent := false;
        v_is_active := true;
        v_target_paid_until := v_bridge_cutoff;
        v_status := 'active';
      END IF;
    END IF;

  ELSIF v_tx.plan = 'monthly-licence' THEN
    -- Monthly plan: max(existing, now) + 30 days minimum
    IF v_ent.is_permanent = true THEN
      v_is_permanent := true;
      v_is_active := true;
      v_target_paid_until := NULL;
      v_status := 'active';
    ELSE
      DECLARE
        v_base_time timestamptz;
      BEGIN
        IF v_ent.paid_until IS NOT NULL AND v_ent.paid_until > v_now THEN
          v_base_time := v_ent.paid_until;
        ELSE
          v_base_time := v_now;
        END IF;
        v_target_paid_until := v_base_time + interval '30 days';

        -- Never shorten existing longer paid_until
        IF v_ent.paid_until IS NOT NULL AND v_ent.paid_until > v_target_paid_until THEN
          v_target_paid_until := v_ent.paid_until;
        END IF;

        v_is_permanent := false;
        v_is_active := true;
        v_status := 'active';
      END;
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNKNOWN_PLAN',
      'message', format('Unrecognized plan %s.', v_tx.plan)
    );
  END IF;

  -- 6. Update Transaction as successfully granted
  UPDATE public.billing_transactions
  SET status = 'success',
      verified_at = v_now,
      paystack_id = COALESCE(p_paystack_id, v_tx.paystack_id),
      paystack_data = p_paystack_data,
      entitlement_granted = true,
      grant_notes = v_grant_notes,
      updated_at = v_now
  WHERE reference = p_reference;

  -- 7. Update Singleton Entitlement
  UPDATE public.ehi_entitlement
  SET plan = v_tx.plan,
      is_active = v_is_active,
      is_permanent = v_is_permanent,
      paid_until = v_target_paid_until,
      last_reference = v_tx.reference,
      last_amount_kobo = v_tx.amount_kobo,
      mode = v_tx.mode,
      status = v_status,
      updated_at = v_now
  WHERE company_id = 'EHI';

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'reference', v_tx.reference,
    'plan', v_tx.plan,
    'is_active', v_is_active,
    'is_permanent', v_is_permanent,
    'paid_until', v_target_paid_until,
    'status', v_status
  );
END;
$$;

-- Revoke public execution and grant to service_role only
REVOKE ALL ON FUNCTION public.apply_billing_grant_atomic FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_grant_atomic TO service_role;
