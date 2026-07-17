ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));

-- Resolve stale schema and new user roles
ALTER TABLE public.corporate_route_rates ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS can_edit_remarks boolean NOT NULL DEFAULT false;
ALTER TABLE public.corporate_route_rates ADD COLUMN IF NOT EXISTS minimum_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;
