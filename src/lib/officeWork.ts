import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { roundMoney } from './helpers';

export interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
  accumulated_monthly_debt: number;
  active: boolean;
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
//
// Deactivated clients are filtered out before matching (not from the
// roster the caller passed in -- callers still need the full roster,
// inactive clients included, for ID-based lookups like debt increments on
// already-in-flight corporate shipments) so a deactivated client simply
// stops being suggested for new work instead of disappearing everywhere.
export function matchOfficeClient(rawName: string, corpClients: CorporateClient[]): OfficeMatch {
  const raw = rawName.trim();
  if (raw.length < 3) return { client: null, type: null };
  const activeClients = corpClients.filter(c => c.active !== false);
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const q = norm(raw);
  const exact = activeClients.find(c => norm(c.company_name) === q);
  if (exact) return { client: exact, type: 'exact' };
  // Shared-prefix length capped at 8 chars (or the whole name, if shorter)
  // -- a fixed 4-char floor was loose enough that two unrelated companies
  // sharing just their first 4 letters (e.g. "GLOB..." vs "GLOB...") could
  // trigger a fuzzy suggestion. Only affects the suggestion banner (never
  // auto-bills), but a tighter bar means fewer irrelevant prompts.
  const fuzzy = activeClients.find(c => norm(c.company_name).startsWith(q) || q.startsWith(norm(c.company_name).slice(0, Math.min(8, norm(c.company_name).length))));
  return fuzzy ? { client: fuzzy, type: 'fuzzy' } : { client: null, type: null };
}

export function useCorporateClients(): CorporateClient[] {
  const [clients, setClients] = useState<CorporateClient[]>([]);
  useEffect(() => {
    let active = true;
    const fetchClients = async () => {
      try {
        const { data } = await supabase
          .from('corporate_clients')
          .select('id, company_name, contact_phone, accumulated_monthly_debt, active')
          .order('company_name');
        if (active && data) {
          setClients(data.map((c: any) => ({
            id: c.id,
            company_name: c.company_name,
            contact_phone: c.contact_phone || '',
            accumulated_monthly_debt: c.accumulated_monthly_debt ?? 0,
            active: c.active ?? true,
          })));
        }
      } catch { /* keep empty if offline */ }
    };
    fetchClients();

    // Without this, an admin adding a new B2B client (or deactivating one)
    // in Pricing Configuration mid-shift is invisible to any Package/Excess
    // Baggage/Marketing intake tab already open elsewhere until that tab is
    // reloaded -- same staleness class as the corporate_route_rates fetch
    // below, just for the client roster instead of the rate itself.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchClients, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchClients(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchClients);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchClients);
    };
  }, []);
  return clients;
}

// Auto-fills a form's amount field from the contract rate whenever an
// entry is linked as office work and a rate + weight are both available.
// Keyed on a client|route|weight signature so it fills once per change and
// doesn't fight a manual edit the agent makes afterward (the edit sticks
// until weight/route/client changes) -- mirrors CargoForm.tsx's own
// dedicated effect for this. Necessary because the banner's "Yes, Link as
// Office Work" button only ever fires for a FUZZY match (it's only
// rendered before linking); an EXACT match auto-links immediately via a
// separate effect with no click involved, so without this the amount is
// silently left at whatever was typed while applied_rate_per_kg still gets
// stamped with the contract rate -- the row looks linked and priced, but
// was never actually billed at that rate.
export function useOfficeWorkAutoPrice(
  linkedAsOfficeWork: boolean,
  officeWorkRate: CorporateRouteRate | null,
  weight: number,
  route: string,
  setAmount: (v: string) => void,
) {
  const sigRef = useRef<string>('');
  useEffect(() => {
    if (!linkedAsOfficeWork || !officeWorkRate || weight <= 0) return;
    const sig = `${officeWorkRate.corporate_client_id}|${route}|${weight}`;
    if (sigRef.current === sig) return;
    sigRef.current = sig;
    const computed = Math.max(roundMoney(weight * officeWorkRate.rate_per_kg), officeWorkRate.minimum_amount ?? 0);
    setAmount(String(computed));
  }, [linkedAsOfficeWork, officeWorkRate, weight, route]);
}

export function useCorporateRouteRates(): CorporateRouteRate[] {
  const [rates, setRates] = useState<CorporateRouteRate[]>([]);
  useEffect(() => {
    let active = true;
    const fetchRates = async () => {
      try {
        const { data } = await supabase
          .from('corporate_route_rates')
          .select('id, corporate_client_id, route_name, rate_per_kg, minimum_amount');
        if (active && data) setRates(data as CorporateRouteRate[]);
      } catch { /* keep empty if offline */ }
    };
    fetchRates();

    // Same staleness reasoning as CargoForm.tsx's own equivalent fetch: an
    // admin editing a corporate client's negotiated rate in Pricing
    // Configuration mid-shift wouldn't otherwise show up here until the
    // agent navigated away and back or reloaded, silently billing every B2B
    // shipment finalized in the meantime (Package/Excess Baggage/Marketing,
    // the three forms that consume this shared hook) at the stale rate.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchRates, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchRates(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchRates);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchRates);
    };
  }, []);
  return rates;
}
