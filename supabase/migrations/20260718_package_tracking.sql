-- Package/Parcel was built as a flat-fee walk-in service with no
-- status/transit tracking. Confirmed it should travel hub-to-hub like
-- Cargo, so bring it in line: add status, and grant anon the same
-- column-restricted public-tracking read the other three streams got
-- in 20260716_security_hardening.sql.

ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Intake';

-- Column-restricted anon read, matching the pattern for
-- cargo_entries/manifests/marketing_entries in 20260716_security_hardening.sql.
-- No separate awb_tag_number column exists here -- entry_ref IS the
-- unified tag number for this stream, so it's the only ref column granted.
REVOKE ALL ON TABLE public.package_entries FROM anon;
GRANT SELECT (entry_ref, customer_name, destination, content_type, status)
  ON public.package_entries TO anon;
DROP POLICY IF EXISTS "Anon read package_entries for tracking" ON public.package_entries;
CREATE POLICY "Anon read package_entries for tracking" ON public.package_entries
  FOR SELECT TO anon USING (true);
