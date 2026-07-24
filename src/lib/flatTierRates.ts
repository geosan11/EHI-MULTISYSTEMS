import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { normalizeAirlineName, cleanRoute } from './helpers.js';

export const FLAT_TIER_RATES_CACHE_KEY = 'ehi_flat_tier_rates';

export interface FlatTierRate {
  id: string;
  content_type_id: string;
  content_type_name: string;
  airline: string;
  hub_id: string;
  route_name: string;
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
      airline: r.airline, hub_id: r.hub_id, route_name: r.route_name,
      min_kg: Number(r.min_kg), max_kg: r.max_kg == null ? null : Number(r.max_kg),
      flat_amount: Number(r.flat_amount),
    };
  });
  try { localStorage.setItem(FLAT_TIER_RATES_CACHE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
  return rows;
}

export function useFlatTierRates(): FlatTierRate[] {
  const [rows, setRows] = useState<FlatTierRate[]>(getCached);
  useEffect(() => {
    let cancelled = false;
    fetchFlatTierRates().then(f => { if (f && !cancelled) setRows(f); });
    return () => { cancelled = true; };
  }, []);
  return rows;
}

// Returns the FLAT total for this content type + airline + route + hub whose
// [min_kg, max_kg] bracket contains kg (max_kg null = open top). This total is
// the whole price — callers use it instead of, not on top of, the per-kg
// cascade and minimum charge.
export function resolveFlatTier(
  rows: FlatTierRate[], contentTypeName: string, airline: string, route: string, kg: number, hubId?: string | null,
): number | null {
  if (!hubId) return null;
  const normCt = contentTypeName.trim().toLowerCase();
  const normAir = normalizeAirlineName(airline).toLowerCase();
  const normRoute = cleanRoute(route);

  const match = rows.find(r =>
    r.content_type_name.trim().toLowerCase() === normCt &&
    normalizeAirlineName(r.airline).toLowerCase() === normAir &&
    cleanRoute(r.route_name) === normRoute &&
    r.hub_id === hubId &&
    kg >= r.min_kg &&
    (r.max_kg == null || kg <= r.max_kg)
  );
  return match ? match.flat_amount : null;
}

