import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';

export const SPECIAL_GOODS_RATES_CACHE_KEY = 'ehi_special_goods_rates';

export interface SpecialGoodsRate {
  id: string;
  content_type_id: string;
  content_type_name: string;
  airline: string;
  hub_id: string | null;
  hub_name: string | null;
  min_kg: number;
  max_kg: number | null;
  rate_per_kg: number;
}

function getCached(): SpecialGoodsRate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPECIAL_GOODS_RATES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  return [];
}

export async function fetchSpecialGoodsRates(): Promise<SpecialGoodsRate[] | null> {
  const { data, error } = await supabase
    .from('special_goods_rates')
    .select('id, content_type_id, airline, hub_id, min_kg, max_kg, rate_per_kg, content_types(name), hubs(name)');
  if (!data || error) return null;
  const rows: SpecialGoodsRate[] = data.map((r: any) => {
    const ct = Array.isArray(r.content_types) ? r.content_types[0] : r.content_types;
    const hub = Array.isArray(r.hubs) ? r.hubs[0] : r.hubs;
    return {
      id: r.id,
      content_type_id: r.content_type_id,
      content_type_name: ct?.name || '',
      airline: r.airline,
      hub_id: r.hub_id ?? null,
      hub_name: hub?.name || null,
      min_kg: Number(r.min_kg),
      max_kg: r.max_kg == null ? null : Number(r.max_kg),
      rate_per_kg: Number(r.rate_per_kg),
    };
  });
  try {
    localStorage.setItem(SPECIAL_GOODS_RATES_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // localStorage unavailable -- nothing to persist to, the fetch result is still returned
  }
  return rows;
}

// Cached/empty on first render (instant paint, works offline); swaps to the
// live Supabase list once the fetch resolves. Same convention as
// useContentTypes()/useAirlines() -- an empty array here just means
// resolveSpecialGoodsRate() finds no match and callers fall back to their
// normal rate cascade, not an error state.
export function useSpecialGoodsRates(): SpecialGoodsRate[] {
  const [rows, setRows] = useState<SpecialGoodsRate[]>(getCached);
  useEffect(() => {
    let cancelled = false;
    fetchSpecialGoodsRates().then(fetched => {
      if (fetched && !cancelled) setRows(fetched);
    });
    return () => { cancelled = true; };
  }, []);
  return rows;
}

// Finds the tier row matching this content type + airline whose [min_kg,
// max_kg] bracket contains kg (max_kg null = open-ended top tier). Shared
// by CargoForm.tsx's resolveRate() and the read-only rates list so the
// bracket-matching rule lives in exactly one place.
//
// hub_id is nullable on each row (see 20260820_special_goods_hub_scoping.sql):
// NULL is the company-wide default/fallback, a real hub_id is that hub's
// override. An exact match for the caller's hubId is checked first; a
// company-wide (hub_id == null) row for the same tier is only used if no
// hub-specific override exists.
export function resolveSpecialGoodsRate(rows: SpecialGoodsRate[], contentTypeName: string, airline: string, kg: number, hubId?: string | null): number | null {
  const matches = rows.filter(r =>
    r.content_type_name === contentTypeName &&
    r.airline === airline &&
    kg >= r.min_kg &&
    (r.max_kg == null || kg <= r.max_kg)
  );
  const hubMatch = hubId ? matches.find(r => r.hub_id === hubId) : undefined;
  const fallbackMatch = matches.find(r => r.hub_id == null);
  const match = hubMatch || fallbackMatch;
  return match ? match.rate_per_kg : null;
}
