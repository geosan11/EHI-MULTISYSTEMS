-- =============================================================
-- Add corporate_clients to the supabase_realtime publication
-- =============================================================
-- 20260932_realtime_publication_membership.sql added the 7 tables
-- EHIApp.tsx already subscribed to, but corporate_clients was never one of
-- them -- CorporateBilling.tsx's `clients` state is a one-shot fetch with
-- no realtime channel at all, so accumulated_monthly_debt (decremented
-- atomically by clear_cargo_debt on every debt payment against a corporate
-- client) only ever updates on that screen after a manual remount.
--
-- Idempotent, same pattern as 20260932: safe to run regardless of the live
-- database's current publication state.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'corporate_clients'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.corporate_clients;
  END IF;
END $$;
