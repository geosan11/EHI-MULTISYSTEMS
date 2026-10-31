-- Migration: 20260953_device_sync_status.sql
-- Description: Create device_sync_status table and report_device_sync_status RPC for counter device visibility

CREATE TABLE IF NOT EXISTS public.device_sync_status (
  device_id               text PRIMARY KEY,
  hub_id                  uuid REFERENCES public.hubs(id) ON DELETE SET NULL,
  last_staff_id           uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  pending_total           integer NOT NULL DEFAULT 0,
  pending_by_table        jsonb NOT NULL DEFAULT '{}'::jsonb,
  quarantined_count       integer NOT NULL DEFAULT 0,
  oldest_pending_at       timestamptz,
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_successful_sync_at timestamptz
);

-- Index for admin dashboard querying
CREATE INDEX IF NOT EXISTS idx_device_sync_status_last_seen ON public.device_sync_status(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_sync_status_hub_id ON public.device_sync_status(hub_id);

-- Enable RLS
REVOKE ALL ON TABLE public.device_sync_status FROM anon;
ALTER TABLE public.device_sync_status ENABLE ROW LEVEL SECURITY;

-- Only admin, super admin, and auditor roles can SELECT
DROP POLICY IF EXISTS "Admin and auditor can select device_sync_status" ON public.device_sync_status;
CREATE POLICY "Admin and auditor can select device_sync_status"
  ON public.device_sync_status
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() IN ('admin', 'super_admin', 'auditor')
  );

-- No INSERT/UPDATE/DELETE policies for authenticated users directly;
-- all writes must flow through the report_device_sync_status RPC below.

-- RPC report_device_sync_status
-- SECURITY DEFINER: Sets last_staff_id = auth.uid() securely; prevents any user from writing on behalf of another staff identity.
CREATE OR REPLACE FUNCTION public.report_device_sync_status(
  p_device_id text,
  p_hub_id uuid DEFAULT NULL,
  p_pending_total integer DEFAULT 0,
  p_pending_by_table jsonb DEFAULT '{}'::jsonb,
  p_quarantined_count integer DEFAULT 0,
  p_oldest_pending_at timestamptz DEFAULT NULL,
  p_last_successful_sync_at timestamptz DEFAULT NULL
)
RETURNS public.device_sync_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid := auth.uid();
  v_hub_id uuid := p_hub_id;
  v_result public.device_sync_status;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_device_id IS NULL OR trim(p_device_id) = '' THEN
    RAISE EXCEPTION 'device_id is required';
  END IF;

  -- If hub_id was not explicitly supplied, fallback to staff member's assigned hub
  IF v_hub_id IS NULL THEN
    SELECT hub_id INTO v_hub_id FROM public.user_profiles WHERE id = v_staff_id;
  END IF;

  INSERT INTO public.device_sync_status (
    device_id,
    hub_id,
    last_staff_id,
    pending_total,
    pending_by_table,
    quarantined_count,
    oldest_pending_at,
    last_seen_at,
    last_successful_sync_at
  )
  VALUES (
    p_device_id,
    v_hub_id,
    v_staff_id,
    COALESCE(p_pending_total, 0),
    COALESCE(p_pending_by_table, '{}'::jsonb),
    COALESCE(p_quarantined_count, 0),
    p_oldest_pending_at,
    now(),
    p_last_successful_sync_at
  )
  ON CONFLICT (device_id) DO UPDATE SET
    hub_id = COALESCE(EXCLUDED.hub_id, device_sync_status.hub_id),
    last_staff_id = v_staff_id,
    pending_total = EXCLUDED.pending_total,
    pending_by_table = EXCLUDED.pending_by_table,
    quarantined_count = EXCLUDED.quarantined_count,
    oldest_pending_at = EXCLUDED.oldest_pending_at,
    last_seen_at = now(),
    last_successful_sync_at = COALESCE(EXCLUDED.last_successful_sync_at, device_sync_status.last_successful_sync_at)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT SELECT ON TABLE public.device_sync_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_device_sync_status TO authenticated;
