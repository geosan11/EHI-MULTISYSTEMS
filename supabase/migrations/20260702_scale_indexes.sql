-- Indexes for the query patterns actually used across this codebase.
-- Every one of these is derived from a real .eq()/.gte()/.lte()/.order()
-- call found in the current source, not a generic guess -- see the
-- comment above each block for where that pattern lives.
--
-- Not CONCURRENTLY: whatever runs this (Supabase migration tooling / the
-- SQL-query tool) wraps execution in a transaction block, and
-- CREATE INDEX CONCURRENTLY cannot run inside one. These tables don't carry
-- enough production traffic yet for the brief lock during index build to
-- matter; revisit with CONCURRENTLY run statement-by-statement outside a
-- transaction if that changes.
--
-- IF NOT EXISTS makes this safe to re-run if some of these already exist
-- from manual dashboard work.

-- cargo_entries: EHIApp.tsx fetchInitial does
--   .eq('hub_id', ...).gte('created_at', ...).lte('created_at', ...).order('created_at', desc)
-- and App.tsx's public tracking page does
--   .or('entry_ref.eq...,awb_tag_number.eq...')
CREATE INDEX IF NOT EXISTS idx_cargo_entries_hub_created
  ON public.cargo_entries (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_entries_entry_ref
  ON public.cargo_entries (entry_ref);
CREATE INDEX IF NOT EXISTS idx_cargo_entries_awb_tag
  ON public.cargo_entries (awb_tag_number);

-- manifests: same hub+date pattern, plus tracking lookups by transaction_id
CREATE INDEX IF NOT EXISTS idx_manifests_hub_created
  ON public.manifests (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifests_transaction_id
  ON public.manifests (transaction_id);

-- marketing_entries: same hub+date pattern, plus tracking lookups by entry_ref
CREATE INDEX IF NOT EXISTS idx_marketing_entries_hub_created
  ON public.marketing_entries (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_entries_entry_ref
  ON public.marketing_entries (entry_ref);

-- expenses: same hub+date pattern (EHIApp.tsx fetchInitial)
CREATE INDEX IF NOT EXISTS idx_expenses_hub_created
  ON public.expenses (hub_id, created_at DESC);

-- support_tickets: SupportTickets.tsx scopes non-admin reads to
-- .eq('user_id', ...) -- this is the exact fix from the last security
-- audit; the query is only correct AND fast with this index in place.
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
  ON public.support_tickets (user_id);

-- driver_trips: MyTrips.tsx does .eq('driver_id', ...).order('created_at', desc);
-- Dispatch.tsx does .eq('gps_enabled', true) -- partial index since that's
-- always queried as true, never false, so indexing only the true rows
-- keeps the index small as trip history grows.
CREATE INDEX IF NOT EXISTS idx_driver_trips_driver_created
  ON public.driver_trips (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_trips_gps_enabled
  ON public.driver_trips (driver_id) WHERE gps_enabled = true;
