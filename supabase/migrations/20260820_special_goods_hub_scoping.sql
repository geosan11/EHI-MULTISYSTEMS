-- Special goods rates (Tyres, Medical, etc.) were company-wide per
-- airline+weight-tier only, with no hub dimension -- the business needs
-- them to vary per hub too, the same way standard cargo pricing already
-- does via hub_route_rates/hub_airline_route_rates (20260727_hub_airline_route_rates.sql).
--
-- hub_id is nullable rather than required, mirroring that same cascade
-- convention used everywhere else in this app: NULL = company-wide
-- default/fallback, a real hub_id = that hub's override, checked first.
-- This is non-breaking -- every existing row keeps hub_id NULL and simply
-- becomes the fallback tier for hubs that haven't set their own override.
ALTER TABLE public.special_goods_rates ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.hubs(id);

-- The original inline UNIQUE (content_type_id, airline, min_kg) no longer
-- reflects the real key now that hub_id exists -- without hub_id in it, a
-- hub-specific override row for a tier would collide with the company-wide
-- default row for that same tier. Drop + recreate with hub_id included.
-- (NULL is never considered equal to NULL under a UNIQUE constraint, so
-- multiple hub-specific overrides for different hubs -- and the one
-- NULL-hub company-wide row -- can all coexist for the same tier, which is
-- exactly the intended shape.)
ALTER TABLE public.special_goods_rates DROP CONSTRAINT IF EXISTS special_goods_rates_content_type_id_airline_min_kg_key;
ALTER TABLE public.special_goods_rates ADD CONSTRAINT special_goods_rates_content_type_id_airline_hub_min_kg_key
  UNIQUE (content_type_id, airline, hub_id, min_kg);

CREATE INDEX IF NOT EXISTS special_goods_rates_hub_idx ON public.special_goods_rates(hub_id);

-- Write policies: super_admin/admin stay company-wide-unrestricted (can set
-- the NULL-hub default or any hub's override). accountant is scoped to only
-- their own hub_id -- deliberately NOT using is_hub_unrestricted() (which
-- treats accountant as unrestricted everywhere else), matching
-- hub_airline_route_rates' own carve-out for this exact same reason
-- (20260727_hub_airline_route_rates.sql). Because hub_id = current_user_hub_id()
-- is never true when hub_id IS NULL, this also naturally blocks accountant
-- from writing the company-wide default row -- only super_admin/admin can.
DROP POLICY IF EXISTS "Admins insert special_goods_rates" ON public.special_goods_rates;
CREATE POLICY "Admins insert special_goods_rates" ON public.special_goods_rates FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
DROP POLICY IF EXISTS "Admins update special_goods_rates" ON public.special_goods_rates;
CREATE POLICY "Admins update special_goods_rates" ON public.special_goods_rates FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
DROP POLICY IF EXISTS "Admins delete special_goods_rates" ON public.special_goods_rates;
CREATE POLICY "Admins delete special_goods_rates" ON public.special_goods_rates FOR DELETE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin','admin')
    OR (public.current_user_role() = 'accountant' AND hub_id = public.current_user_hub_id())
  );
-- SELECT stays "USING (true)" (unchanged from 20260716_special_goods_rates.sql)
-- -- every agent pricing an entry needs to read both tiers, matching
-- hub_route_rates' own broad-read policy.
