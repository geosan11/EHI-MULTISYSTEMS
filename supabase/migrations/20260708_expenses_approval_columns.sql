-- The app has been writing date/time/logged_by/logged_by_id/status/
-- requires_approval on every expense insert since it was built, but the
-- expenses table from 20260706_full_schema.sql never had those columns --
-- meaning those inserts have been failing against Supabase and silently
-- falling back to the offline queue. This also adds the approval audit
-- trail (approved_by/approved_at/rejected_by/rejected_at) needed to make
-- the Approve/Reject buttons in ExpensesTab actually do something.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS date              date,
  ADD COLUMN IF NOT EXISTS time              text,
  ADD COLUMN IF NOT EXISTS logged_by         text,
  ADD COLUMN IF NOT EXISTS logged_by_id      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'approved'
                                              CHECK (status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by       text,
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by       text,
  ADD COLUMN IF NOT EXISTS rejected_at       timestamptz;

CREATE INDEX IF NOT EXISTS expenses_status_idx ON public.expenses(status);
