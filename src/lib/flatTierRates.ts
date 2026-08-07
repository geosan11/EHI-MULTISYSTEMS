import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { normalizeAirlineName, cleanRoute } from './helpers.js';

export const FLAT_TIER_RATES_CACHE_KEY = 'ehi_flat_tier_rates';

export interface FlatTierRate {
  id: string;
  content_type_id: string;
  content_type_name: string;
  airline: string;
  hub_id: string | null;
  route_name: string | null;
  min_kg: number;
  max_kg: number | null;
  flat_amount: number;
}

function getCached(): FlatTierRate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLAT_TIER_RATES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}

export async function fetchFlatTierRates(): Promise<FlatTierRate[] | null> {
  const { data, error } = await supabase
    .from('flat_tier_rates')
    .select('id, content_type_id, airline, hub_id, route_name, min_kg, max_kg, flat_amount, content_types(name)')
    .order('min_kg', { ascending: true });
  if (!data || error) return null;
  const rows: FlatTierRate[] = data.map((r: any) => {
    const ct = Array.isArray(r.content_types) ? r.content_types[0] : r.content_types;
    return {
      id: r.id, content_type_id: r.content_type_id, content_type_name: ct?.name || '',
      airline: r.airline, hub_id: r.hub_id ?? null, route_name: r.route_name ?? null,
      min_kg: Number(r.min_kg), max_kg: r.max_kg == null ? null : Number(r.max_kg),
      flat_amount: Number(r.flat_amount),
    };
  });
  try { localStorage.setItem(FLAT_TIER_RATES_CACHE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
  return rows;
}

// Periodic + focus/visibility refresh, matching officeWork.ts's corpRates
// pattern -- without it, an admin editing this table mid-shift (via
// FlatTierRates.tsx) was invisible to any pricing form tab already open
// elsewhere until it happened to remount.
export function useFlatTierRates(): FlatTierRate[] {
  const [rows, setRows] = useState<FlatTierRate[]>(getCached);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetchFlatTierRates().then(f => { if (f && !cancelled) setRows(f); }); };
    refresh();
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return rows;
}

// Returns the FLAT total for this content type + airline + route + hub whose
// [min_kg, max_kg) bracket contains kg (max_kg null = open top, otherwise
// exclusive -- "1-13kg"/"13-45kg" entered as adjacent brackets means 13kg
// belongs to the second one, not both). This total is the whole price —
// callers use it instead of, not on top of, the per-kg cascade and minimum
// charge.
export function resolveFlatTier(
  rows: FlatTierRate[], contentTypeName: string, airline: string, route: string, kg: number, hubId?: string | null, equivalentHubIds?: string[] | null,
): number | null {
  const normCt = contentTypeName.trim().toLowerCase();
  const normAir = normalizeAirlineName(airline).toLowerCase();
  const normRoute = route ? cleanRoute(route) : null;
  const isTargetHub = (rHubId: string | null) => {
    if (!rHubId) return false;
    if (rHubId === hubId) return true;
    if (equivalentHubIds && equivalentHubIds.includes(rHubId)) return true;
    return false;
  };

  const scoped = rows.filter(r =>
    r.content_type_name.trim().toLowerCase() === normCt &&
    normalizeAirlineName(r.airline).toLowerCase() === normAir &&
    kg >= r.min_kg &&
    (r.max_kg == null || kg < r.max_kg)
  );

  const pick = (hubOk: boolean, routeOk: boolean) => scoped.find(r =>
    (hubOk ? isTargetHub(r.hub_id) : (r.hub_id == null || r.hub_id === '')) &&
    (routeOk ? (r.route_name != null && normRoute != null && cleanRoute(r.route_name) === normRoute) : (r.route_name == null || r.route_name === ''))
  );

  const match =
    (hubId && normRoute && pick(true, true)) ||
    (hubId && pick(true, false)) ||
    (normRoute && pick(false, true)) ||
    pick(false, false);

  return match ? match.flat_amount : null;
}

