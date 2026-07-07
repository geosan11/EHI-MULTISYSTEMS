ALTER TABLE public.cargo_entries      ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
ALTER TABLE public.manifests          ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
ALTER TABLE public.marketing_entries  ADD COLUMN IF NOT EXISTS client_type text CHECK (client_type IN ('Corporate','Individual'));
