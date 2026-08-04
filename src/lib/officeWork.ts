import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
  accumulated_monthly_debt: number;
}

export interface CorporateRouteRate {
  id: string;
  corporate_client_id: string;
  route_name: string;
  rate_per_kg: number;
  minimum_amount?: number;
}

export interface OfficeMatch {
  client: CorporateClient | null;
  type: 'exact' | 'fuzzy' | null;
}

// Matches a free-text customer/consignee name against the registered
// corporate-client roster -- exact (normalized) matches are safe to
// auto-link; fuzzy (prefix) matches are only ever suggested, because
// auto-billing a coincidental walk-in as a corporate account is worse than
// asking. Mirrors the DB's normalize_company_name(). Originally written
// inline in CargoForm.tsx (kept there as-is to avoid regressing an
// already-verified flow); pulled out here so Package/Marketing/Excess
// Baggage intake can share the exact same matching rule instead of each
// carrying its own copy that could quietly drift from Cargo's.
export function matchOfficeClient(rawName: string, corpClients: CorporateClient[]): OfficeMatch {
  const raw = rawName.trim();
  if (raw.length < 3) return { client: null, type: null };
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const q = norm(raw);
  const exact = corpClients.find(c => norm(c.company_name) === q);
  if (exact) return { client: exact, type: 'exact' };
  const fuzzy = corpClients.find(c => norm(c.company_name).startsWith(q) || q.startsWith(norm(c.company_name).slice(0, 4)));
  return fuzzy ? { client: fuzzy, type: 'fuzzy' } : { client: null, type: null };
}

// No 'active' column exists on corporate_clients (nothing in the app
// exposes a way to deactivate one) -- filtering on it made the equivalent
// CargoForm.tsx query error and silently fall back to an empty list.
export function useCorporateClients(): CorporateClient[] {
  const [clients, setClients] = useState<CorporateClient[]>([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('corporate_clients')
          .select('id, company_name, contact_phone, accumulated_monthly_debt')
          .order('company_name');
        if (active && data) {
          setClients(data.map((c: any) => ({
            id: c.id,
            company_name: c.company_name,
            contact_phone: c.contact_phone || '',
            accumulated_monthly_debt: c.accumulated_monthly_debt ?? 0,
          })));
        }
      } catch { /* keep empty if offline */ }
    })();
    return () => { active = false; };
  }, []);
  return clients;
}

export function useCorporateRouteRates(): CorporateRouteRate[] {
  const [rates, setRates] = useState<CorporateRouteRate[]>([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('corporate_route_rates')
          .select('id, corporate_client_id, route_name, rate_per_kg, minimum_amount');
        if (active && data) setRates(data as CorporateRouteRate[]);
      } catch { /* keep empty if offline */ }
    })();
    return () => { active = false; };
  }, []);
  return rates;
}
