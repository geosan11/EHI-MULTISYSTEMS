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
export function useMinimumCharges(): MinimumCharge[] {
  const [rows, setRows] = useState<MinimumCharge[]>(getCached);
  useEffect(() => {
    let cancelled = false;
    fetchMinimumCharges().then(fetched => {
      if (fetched && !cancelled) setRows(fetched);
    });
    return () => { cancelled = true; };
  }, []);
  return rows;
}

// Finds the tier row matching this airline + route whose [min_kg, max_kg]
// bracket contains kg (max_kg null = open-ended top tier). Shared by
// CargoForm.tsx's floor logic and the read-only rates list.
export function resolveMinimumCharge(rows: MinimumCharge[], airline: string, route: string, kg: number): number | null {
  const normAir = normalizeAirlineName(airline).toLowerCase();
  const normRoute = cleanRoute(route);

  const match = rows.find(r =>
    normalizeAirlineName(r.airline).toLowerCase() === normAir &&
    cleanRoute(r.route_name) === normRoute &&
    kg >= r.min_kg &&
    (r.max_kg == null || kg <= r.max_kg)
  );
  return match ? match.minimum_amount : null;
}

