-- =============================================================
-- Ensure every table the app subscribes to via postgres_changes is
-- actually in the supabase_realtime publication
-- =============================================================
-- EHIApp.tsx opens `supabase.channel(...).on('postgres_changes', ...)`
-- subscriptions against 7 tables: customer_wallets, wallet_transactions,
-- cargo_entries, manifests, marketing_entries, package_entries, hub_shifts.
-- postgres_changes delivers NOTHING for a table that was never added to
-- the supabase_realtime publication (via SQL, or a one-off Dashboard
-- toggle that leaves no trace in migration history) -- not intermittently,
-- silently and permanently, for every session already open when the gap
-- exists. No migration in this repo's history has ever run
-- ALTER PUBLICATION supabase_realtime ADD TABLE for any table, for any of
-- these 7 -- so this has likely never been guaranteed.
--
-- Concretely: customer_wallets' global client-side cache (EHIApp.tsx) is
-- fetched once on mount and from then on relies ENTIRELY on this
-- publication actually delivering INSERT/UPDATE events -- if it doesn't,
-- a wallet created or credited later in the same session (e.g. via a
-- retrieval refund) never appears in that cache, which is exactly the
-- reported bug: a wallet correctly shown (fresh-fetched) on
-- CustomerWallets.tsx was invisible ("0 Active") in the Edit Transaction
-- modal's wallet picker, which reads the stale global cache instead.
--
-- Idempotent: checks pg_publication_tables first, so this is a no-op for
-- any table already correctly configured (via SQL or the Dashboard) and
-- safe to run regardless of the live database's current state.
-- =============================================================

DO $$
DECLARE
  t text;
BEGIN
  -- Every real Supabase project has this publication created by the
  -- platform itself, but guard anyway rather than assume -- ADD TABLE
  -- against a publication that doesn't exist would abort this whole block
  -- instead of degrading gracefully.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'customer_wallets', 'wallet_transactions', 'cargo_entries',
    'manifests', 'marketing_entries', 'package_entries', 'hub_shifts'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
