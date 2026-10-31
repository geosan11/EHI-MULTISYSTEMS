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
-- SECURITY DEFINER hardening:
--   * last_staff_id is always auth.uid(); never client supplied.
--   * hub_id comes from user_profiles; p_hub_id is honoured ONLY for admin/super_admin.
--   * inputs are validated (counts >= 0, pending_by_table <= 50 keys / 8 KB, numeric values >= 0);
--     timestamps are clamped to now().
--   * changes of last_staff_id or hub_id on an existing device are written to audit_log.
--   * returns void; EXECUTE revoked from PUBLIC/anon.
DROP FUNCTION IF EXISTS public.report_device_sync_status(text, uuid, integer, jsonb, integer, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.report_device_sync_status(
  p_device_id text,
  p_hub_id uuid DEFAULT NULL,
  p_pending_total integer DEFAULT 0,
  p_pending_by_table jsonb DEFAULT '{}'::jsonb,
  p_quarantined_count integer DEFAULT 0,
  p_oldest_pending_at timestamptz DEFAULT NULL,
  p_last_successful_sync_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id   uuid := auth.uid();
  v_role       text;
  v_profile_hub uuid;
  v_staff_name text;
  v_hub_id     uuid;
  v_by_table   jsonb := COALESCE(p_pending_by_table, '{}'::jsonb);
  v_oldest     timestamptz;
  v_last_sync  timestamptz;
  v_prev       public.device_sync_status%ROWTYPE;
  v_had_prev   boolean := false;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Input validation
  IF p_device_id IS NULL OR btrim(p_device_id) = '' OR length(p_device_id) > 128 THEN
    RAISE EXCEPTION 'device_id is required (max 128 chars)' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_pending_total, 0) < 0 OR COALESCE(p_pending_total, 0) > 10000000
     OR COALESCE(p_quarantined_count, 0) < 0 OR COALESCE(p_quarantined_count, 0) > 10000000 THEN
    RAISE EXCEPTION 'counts must be between 0 and 10000000' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_by_table) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'pending_by_table must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_by_table)) > 50 THEN
    RAISE EXCEPTION 'pending_by_table may have at most 50 keys' USING ERRCODE = '22023';
  END IF;
  IF octet_length(v_by_table::text) > 8192 THEN
    RAISE EXCEPTION 'pending_by_table exceeds 8 KB' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(v_by_table) e
    WHERE jsonb_typeof(e.value) <> 'number' OR (e.value)::text !~ '^[0-9]{1,8}$'
  ) THEN
    RAISE EXCEPTION 'pending_by_table values must be non-negative integers' USING ERRCODE = '22023';
  END IF;

  -- Timestamps can never be in the future (Postgres LEAST(NULL, now()) evaluates to now(), so guard NULLs explicitly)
  v_oldest    := CASE WHEN p_oldest_pending_at IS NULL THEN NULL WHEN p_oldest_pending_at > now() THEN now() ELSE p_oldest_pending_at END;
  v_last_sync := CASE WHEN p_last_successful_sync_at IS NULL THEN NULL WHEN p_last_successful_sync_at > now() THEN now() ELSE p_last_successful_sync_at END;

  -- Hub comes from the server-side profile; only admins may override it
  SELECT role, hub_id, name INTO v_role, v_profile_hub, v_staff_name
  FROM public.user_profiles WHERE id = v_staff_id;

  IF v_role IN ('admin', 'super_admin') AND p_hub_id IS NOT NULL THEN
    v_hub_id := p_hub_id;
  ELSE
    v_hub_id := v_profile_hub;
  END IF;

  SELECT * INTO v_prev FROM public.device_sync_status WHERE device_id = p_device_id FOR UPDATE;
  v_had_prev := FOUND;

  INSERT INTO public.device_sync_status (
    device_id, hub_id, last_staff_id, pending_total, pending_by_table,
    quarantined_count, oldest_pending_at, last_seen_at, last_successful_sync_at
  )
  VALUES (
    p_device_id, v_hub_id, v_staff_id, COALESCE(p_pending_total, 0), v_by_table,
    COALESCE(p_quarantined_count, 0), v_oldest, now(), v_last_sync
  )
  ON CONFLICT (device_id) DO UPDATE SET
    hub_id = COALESCE(EXCLUDED.hub_id, device_sync_status.hub_id),
    last_staff_id = v_staff_id,
    pending_total = EXCLUDED.pending_total,
    pending_by_table = EXCLUDED.pending_by_table,
    quarantined_count = EXCLUDED.quarantined_count,
    oldest_pending_at = EXCLUDED.oldest_pending_at,
    last_seen_at = now(),
    last_successful_sync_at = COALESCE(EXCLUDED.last_successful_sync_at, device_sync_status.last_successful_sync_at);

  -- Audit takeover / hub relabel of an existing device
  IF v_had_prev
     AND (v_prev.last_staff_id IS DISTINCT FROM v_staff_id
          OR v_prev.hub_id IS DISTINCT FROM COALESCE(v_hub_id, v_prev.hub_id)) THEN
    INSERT INTO public.audit_log (
      user_id, user_name, action, table_name, record_id, description, hub_id, old_values, new_values
    ) VALUES (
      v_staff_id, v_staff_name, 'UPDATE', 'device_sync_status', p_device_id,
      'Device sync status: staff or hub changed',
      COALESCE(v_hub_id, v_prev.hub_id),
      jsonb_build_object('last_staff_id', v_prev.last_staff_id, 'hub_id', v_prev.hub_id),
      jsonb_build_object('last_staff_id', v_staff_id, 'hub_id', COALESCE(v_hub_id, v_prev.hub_id))
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_device_sync_status(text, uuid, integer, jsonb, integer, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_device_sync_status(text, uuid, integer, jsonb, integer, timestamptz, timestamptz) TO authenticated;

GRANT SELECT ON TABLE public.device_sync_status TO authenticated;

-- Realtime: the admin card subscribes via postgres_changes, which delivers nothing
-- unless the table is in the supabase_realtime publication (see 20260932).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'device_sync_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_sync_status;
  END IF;
END $$;

-- Admin-card read path. Auditors may not be able to read user_profiles/hubs under RLS,
-- so resolve hub/staff display names server-side, gated to the same roles as the table policy.
DROP FUNCTION IF EXISTS public.list_device_sync_status();
CREATE OR REPLACE FUNCTION public.list_device_sync_status()
RETURNS TABLE (
  device_id text,
  hub_id uuid,
  last_staff_id uuid,
  pending_total integer,
  pending_by_table jsonb,
  quarantined_count integer,
  oldest_pending_at timestamptz,
  last_seen_at timestamptz,
  last_successful_sync_at timestamptz,
  hub_name text,
  hub_code text,
  staff_name text,
  staff_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('admin', 'super_admin', 'auditor') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT d.device_id, d.hub_id, d.last_staff_id, d.pending_total, d.pending_by_table,
         d.quarantined_count, d.oldest_pending_at, d.last_seen_at, d.last_successful_sync_at,
         h.name::text, h.code::text, u.name::text, u.email::text
  FROM public.device_sync_status d
  LEFT JOIN public.hubs h ON h.id = d.hub_id
  LEFT JOIN public.user_profiles u ON u.id = d.last_staff_id
  ORDER BY d.last_seen_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_device_sync_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_device_sync_status() TO authenticated;
