import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { normalizeAirlineName, cleanRoute } from './helpers.js';

export const SIZE_TIER_RATES_CACHE_KEY = 'ehi_size_tier_rates';

export interface SizeTierRate {
  id: string;
  content_type_id: string;
  content_type_name: string;
  airline: string;
  hub_id: string | null;
  route_name: string | null;
  min_inches: number;
  max_inches: number | null;
  flat_amount: number;
}

function getCached(): SizeTierRate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIZE_TIER_RATES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}

export async function fetchSizeTierRates(): Promise<SizeTierRate[] | null> {
  const { data, error } = await supabase
    .from('size_tier_rates')
    .select('id, content_type_id, airline, hub_id, route_name, min_inches, max_inches, flat_amount, content_types(name)')
    .order('min_inches', { ascending: true });
  if (!data || error) return null;
  const rows: SizeTierRate[] = data.map((r: any) => {
    const ct = Array.isArray(r.content_types) ? r.content_types[0] : r.content_types;
    return {
      id: r.id, content_type_id: r.content_type_id, content_type_name: ct?.name || '',
      airline: r.airline, hub_id: r.hub_id ?? null, route_name: r.route_name ?? null,
      min_inches: Number(r.min_inches), max_inches: r.max_inches == null ? null : Number(r.max_inches),
      flat_amount: Number(r.flat_amount),
    };
  });
  try { localStorage.setItem(SIZE_TIER_RATES_CACHE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
  return rows;
}

export function useSizeTierRates(): SizeTierRate[] {
  const [rows, setRows] = useState<SizeTierRate[]>(getCached);
  useEffect(() => {
    let cancelled = false;
    fetchSizeTierRates().then(f => { if (f && !cancelled) setRows(f); });
    return () => { cancelled = true; };
  }, []);
  return rows;
}

// Returns the FLAT total for this content type + airline + route + hub whose
// [min_inches, max_inches] bracket contains inches (max_inches null = open
// top). This total is the whole price -- callers use it instead of, not on
// top of, the per-kg cascade and minimum charge (same contract as
// resolveFlatTier, just keyed on screen-size inches instead of weight).
export function resolveSizeTier(
  rows: SizeTierRate[], contentTypeName: string, airline: string, route: string, inches: number, hubId?: string | null,
): number | null {
  const normCt = contentTypeName.trim().toLowerCase();
  const normAir = normalizeAirlineName(airline).toLowerCase();
  const normRoute = route ? cleanRoute(route) : null;

  const scoped = rows.filter(r =>
    r.content_type_name.trim().toLowerCase() === normCt &&
    normalizeAirlineName(r.airline).toLowerCase() === normAir &&
    inches >= r.min_inches &&
    (r.max_inches == null || inches <= r.max_inches)
  );

  const pick = (hubOk: boolean, routeOk: boolean) => scoped.find(r =>
    (hubOk ? r.hub_id === hubId : (r.hub_id == null || r.hub_id === '')) &&
    (routeOk ? (r.route_name != null && normRoute != null && cleanRoute(r.route_name) === normRoute) : (r.route_name == null || r.route_name === ''))
  );

  const match =
    (hubId && normRoute && pick(true, true)) ||
    (hubId && pick(true, false)) ||
    (normRoute && pick(false, true)) ||
    pick(false, false);

  return match ? match.flat_amount : null;
}


// Set of content-type names flagged is_size_tier -- lets CargoForm decide
// whether to show the "Screen Size (inches)" input for whatever content
// type is currently selected, without widening the shared useContentTypes()
// hook (used by many screens that only ever need plain names) to also
// carry per-type flags.
export function useSizeTierContentTypeNames(): Set<string> {
  const [names, setNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    supabase.from('content_types').select('name').eq('is_size_tier', true).eq('active', true)
      .then(({ data }) => { if (data && !cancelled) setNames(new Set(data.map((r: any) => r.name))); });
    return () => { cancelled = true; };
  }, []);
  return names;
}
