import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { normalizeAirlineName, cleanRoute } from './helpers.js';

export const MINIMUM_CHARGES_CACHE_KEY = 'ehi_minimum_charges';

export interface MinimumCharge {
  id: string;
  airline: string;
  route_name: string;
  min_kg: number;
  max_kg: number | null;
  minimum_amount: number;
}

function getCached(): MinimumCharge[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MINIMUM_CHARGES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  return [];
}

export async function fetchMinimumCharges(): Promise<MinimumCharge[] | null> {
  const { data, error } = await supabase
    .from('minimum_charges')
    .select('id, airline, route_name, min_kg, max_kg, minimum_amount')
    .order('min_kg', { ascending: true });
  if (!data || error) return null;
  const rows: MinimumCharge[] = data.map((r: any) => ({
    id: r.id,
    airline: r.airline,
    route_name: r.route_name,
    min_kg: Number(r.min_kg),
    max_kg: r.max_kg == null ? null : Number(r.max_kg),
    minimum_amount: Number(r.minimum_amount),
  }));
  try {
    localStorage.setItem(MINIMUM_CHARGES_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // localStorage unavailable -- nothing to persist to, the fetch result is still returned
  }
  return rows;
}

// Cached/empty on first render, swaps to the live list once the fetch
// resolves -- same convention as useSpecialGoodsRates().
// Periodic + focus/visibility refresh, matching officeWork.ts's corpRates
// pattern -- without it, an admin editing this table mid-shift (via
// MinimumCharges.tsx) was invisible to any pricing form tab already open
// elsewhere until it happened to remount.
export function useMinimumCharges(): MinimumCharge[] {
  const [rows, setRows] = useState<MinimumCharge[]>(getCached);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetchMinimumCharges().then(fetched => { if (fetched && !cancelled) setRows(fetched); }); };
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

// Finds the tier row matching this airline + route whose [min_kg, max_kg)
// bracket contains kg (max_kg null = open-ended top tier; max_kg itself is
// exclusive -- "1-13kg" and "13-45kg" entered as adjacent brackets means
// 13kg belongs to the SECOND bracket, not both, so a shipment weighing
// exactly the boundary doesn't deterministically fall into the cheaper
// lower tier). Shared by CargoForm.tsx's floor logic and the read-only
// rates list.
export function resolveMinimumCharge(rows: MinimumCharge[], airline: string, route: string, kg: number): number | null {
  const normAir = normalizeAirlineName(airline).toLowerCase();
  const normRoute = cleanRoute(route);

  const match = rows.find(r =>
    normalizeAirlineName(r.airline).toLowerCase() === normAir &&
    cleanRoute(r.route_name) === normRoute &&
    kg >= r.min_kg &&
    (r.max_kg == null || kg < r.max_kg)
  );
  return match ? match.minimum_amount : null;
}

