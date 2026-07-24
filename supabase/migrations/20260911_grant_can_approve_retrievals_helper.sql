-- =============================================================
-- current_user_can_approve_retrievals(): add the GRANT EXECUTE it was missing
-- (Real authoring date: 2026-07-24. Filename prefixed 2026090x per
-- docs/MIGRATION_POLICY.md so it sorts after every migration already
-- applied to the live database.)
-- =============================================================
-- Found during a self-review of the last 5 commits: every other function
-- added in 20260906_retrieval_approval_and_permission.sql got an explicit
-- GRANT EXECUTE ... TO authenticated (9 functions defined, only 8 grants).
-- Not currently exploitable -- this helper is only ever called from inside
-- other SECURITY DEFINER functions (approve_*_retrieval), never directly
-- via supabase.rpc() from the client, and Postgres grants EXECUTE to
-- PUBLIC by default on a newly created function -- but adding the grant
-- explicitly matches this file's own convention and removes any doubt if
-- it's ever called directly in the future.
-- =============================================================

GRANT EXECUTE ON FUNCTION public.current_user_can_approve_retrievals() TO authenticated;

INSERT INTO public.schema_migrations (filename) VALUES ('20260911_grant_can_approve_retrievals_helper.sql')
ON CONFLICT (filename) DO NOTHING;
