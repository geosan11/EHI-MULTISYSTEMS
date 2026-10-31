-- MANUAL TEST SCRIPT for 20260953_device_sync_status.sql
-- Run ONLY against a disposable/staging database, never production.
-- Replace the UUIDs with real ids: :staff (role counter staff), :admin (role admin), :other_hub.
-- Each block runs in a transaction and ROLLBACKs. Expectations are in comments.

-- 1. anon rejected  (expect: permission denied for function report_device_sync_status)
BEGIN;
SET LOCAL ROLE anon;
SELECT public.report_device_sync_status('t-dev-1');
ROLLBACK;

-- 2. non-admin cannot SELECT  (expect: 0 rows, even after a successful report)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-1', NULL, 1, '{"cargo_entries":1}', 0, now(), NULL);
SELECT count(*) AS visible_rows FROM public.device_sync_status;  -- expect 0
ROLLBACK;

-- 3. hub spoofing blocked  (expect: stored hub_id = staff's user_profiles.hub_id, not <OTHER_HUB_UUID>)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-2', '<OTHER_HUB_UUID>'::uuid, 0, '{}', 0, NULL, NULL);
RESET ROLE;
SELECT hub_id = (SELECT hub_id FROM public.user_profiles WHERE id = '<STAFF_UUID>') AS hub_from_profile
FROM public.device_sync_status WHERE device_id = 't-dev-2';  -- expect true
ROLLBACK;

-- 3b. admin MAY override hub  (expect: hub_id = <OTHER_HUB_UUID>)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<ADMIN_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-3', '<OTHER_HUB_UUID>'::uuid, 0, '{}', 0, NULL, NULL);
SELECT hub_id FROM public.device_sync_status WHERE device_id = 't-dev-3';
ROLLBACK;

-- 4. invalid inputs rejected (each statement must raise SQLSTATE 22023); run each in its own transaction
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-4', NULL, -1);                                  -- negative count
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-4', NULL, 0, '[]'::jsonb);                      -- not an object
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-4', NULL, 0,
  (SELECT jsonb_object_agg('k' || g, 1) FROM generate_series(1, 51) g));                       -- 51 keys
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-4', NULL, 0, jsonb_build_object('a', repeat('x', 9000))); -- >8KB / non-numeric
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-4', NULL, 0, '{"x":-5}');                       -- negative value
ROLLBACK;

-- 5. future timestamp is clamped (expect oldest_pending_at <= now())
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<ADMIN_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-5', NULL, 1, '{}', 0, now() + interval '1 year', NULL);
SELECT oldest_pending_at <= now() AS clamped FROM public.device_sync_status WHERE device_id = 't-dev-5';
ROLLBACK;

-- 6. audit on takeover (expect one audit_log row with table_name='device_sync_status')
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-6');
SELECT set_config('request.jwt.claims', '{"sub":"<ADMIN_UUID>","role":"authenticated"}', true);
SELECT public.report_device_sync_status('t-dev-6');
RESET ROLE;
SELECT count(*) FROM public.audit_log WHERE table_name = 'device_sync_status' AND record_id = 't-dev-6';  -- expect 1
ROLLBACK;

-- 7. list_device_sync_status: non-admin rejected (expect SQLSTATE 42501), anon rejected (permission denied)
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<STAFF_UUID>","role":"authenticated"}', true);
SELECT * FROM public.list_device_sync_status();
ROLLBACK;
BEGIN; SET LOCAL ROLE anon;
SELECT * FROM public.list_device_sync_status();
ROLLBACK;
