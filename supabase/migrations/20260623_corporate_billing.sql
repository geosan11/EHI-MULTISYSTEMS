-- ==========================================
-- EHI MULTISYSTEMS - B2B CORPORATE BILLING MIGRATION
-- ==========================================
-- NOTE: this originally included a BEFORE INSERT trigger on a "shipments"
-- table that was never the real table name (the actual cargo table is
-- cargo_entries -- see 20260706_full_schema.sql) and used column names
-- (amount_to_pay, destination_route, is_corporate_account, cargo_weight_kg)
-- that don't match cargo_entries' real columns (amount, route, is_corporate,
-- total_kg) either. That trigger was dead on arrival: corporate/B2B billing
-- has always actually run client-side in CargoForm.tsx's
-- handleFinalizeWeighing, which looks up corporate_clients/
-- corporate_route_rates directly and writes the computed Transaction itself.
-- Removed the trigger entirely rather than leaving unreachable, broken SQL
-- blocking this migration from ever completing.

-- 1. Corporate Directory Table
CREATE TABLE IF NOT EXISTS corporate_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL UNIQUE,
    contact_phone VARCHAR(50),
    accumulated_monthly_debt NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Backfill columns for a corporate_clients table that already existed
-- with an older/different shape before this migration ran -- CREATE TABLE
-- IF NOT EXISTS above is a no-op in that case and leaves old columns as-is.
ALTER TABLE corporate_clients ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE corporate_clients ADD COLUMN IF NOT EXISTS accumulated_monthly_debt NUMERIC(12, 2) DEFAULT 0.00 NOT NULL;
ALTER TABLE corporate_clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL;

-- The pre-existing table may predate the inline UNIQUE on company_name
-- too (CREATE TABLE IF NOT EXISTS above wouldn't have added it), and the
-- seed INSERT below needs an actual unique constraint/index to match
-- against for its ON CONFLICT (company_name) clause -- otherwise Postgres
-- errors with "no unique or exclusion constraint matching ON CONFLICT".
CREATE UNIQUE INDEX IF NOT EXISTS corporate_clients_company_name_key ON corporate_clients (company_name);

-- 2. Corporate Route Rates Table (Mapping Custom Contract Rates)
CREATE TABLE IF NOT EXISTS corporate_route_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corporate_client_id UUID NOT NULL REFERENCES corporate_clients(id) ON DELETE CASCADE,
    route_name VARCHAR(100) NOT NULL,
    rate_per_kg NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_corporate_route UNIQUE (corporate_client_id, route_name)
);

ALTER TABLE corporate_route_rates ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE corporate_route_rates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL;

-- Same reasoning as corporate_clients above -- guarantee a unique index
-- exists to match the seed INSERT's ON CONFLICT target, regardless of
-- whether the inline CONSTRAINT ran (table may have pre-existed).
CREATE UNIQUE INDEX IF NOT EXISTS corporate_route_rates_client_route_key ON corporate_route_rates (corporate_client_id, route_name);

-- ==========================================
-- SEED SAMPLE CORPORATE DATA FOR THE CLIENTS
-- ==========================================

INSERT INTO corporate_clients (id, company_name, contact_phone, accumulated_monthly_debt) VALUES
('a37bfa51-ef78-43f1-bdca-b96ab3201402', 'Aramex', '08011223344', 154300.00),
('f021adff-89d2-4fe0-94f7-33a59df74fa2', 'SAHCO', '08022334455', 84000.00),
('3be177df-9831-419b-a01f-0e86a0ffccca', 'GlobaCom', '09033445566', 220000.00),
('da09de12-f0ef-4f11-bc66-3d719e782ea2', 'ZeemMax', '08044556677', 0.00)
ON CONFLICT (company_name) DO NOTHING;

-- Seed custom route-specific rates
INSERT INTO corporate_route_rates (corporate_client_id, route_name, rate_per_kg) VALUES
-- Aramex Rates
('a37bfa51-ef78-43f1-bdca-b96ab3201402', 'ABV/Abuja', 600.00),
('a37bfa51-ef78-43f1-bdca-b96ab3201402', 'BNI/Benin', 400.00),
('a37bfa51-ef78-43f1-bdca-b96ab3201402', 'Lagos', 350.00),
-- SAHCO Rates
('f021adff-89d2-4fe0-94f7-33a59df74fa2', 'ABV/Abuja', 500.00),
('f021adff-89d2-4fe0-94f7-33a59df74fa2', 'BNI/Benin', 420.00),
-- GlobaCom Rates
('3be177df-9831-419b-a01f-0e86a0ffccca', 'ABV/Abuja', 650.00),
('3be177df-9831-419b-a01f-0e86a0ffccca', 'PHC/Port Harcourt', 750.00)
ON CONFLICT (corporate_client_id, route_name) DO NOTHING;
