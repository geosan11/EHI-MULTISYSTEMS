import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { normalizeAirlineName, cleanRoute } from './helpers.js';

export const SPECIAL_GOODS_RATES_CACHE_KEY = 'ehi_special_goods_rates';

export interface SpecialGoodsRate {
  id: string;
  content_type_id: string;
  content_type_name: string;
  airline: string;
  hub_id: string | null;
  hub_name: string | null;
  route_name: string | null;   // NULL = applies to any route
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
    .select('id, content_type_id, airline, hub_id, route_name, min_kg, max_kg, rate_per_kg, content_types(name), hubs(name)')
    .order('min_kg', { ascending: true });
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
      route_name: r.route_name ?? null,
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
// hub_id and route_name are each independently nullable (see
// 20260820_special_goods_hub_scoping.sql and
// 20260828_special_goods_route_and_perishable.sql): NULL is the
// company-wide/any-route default, a real value is that hub's or that
// route's override. Most specific wins: this hub + this route, then
// hub-only (any route), then route-only (any hub), then the fully
// company-wide/any-route default.
export function resolveSpecialGoodsRate(
  rows: SpecialGoodsRate[],
  contentTypeName: string,
  airline: string,
  kg: number,
  hubId?: string | null,
  route?: string | null,
): number | null {
  const normCt = contentTypeName.trim().toLowerCase();
  const normAir = normalizeAirlineName(airline).toLowerCase();
  const normRoute = route ? cleanRoute(route) : null;

  const scoped = rows.filter(r =>
    r.content_type_name.trim().toLowerCase() === normCt &&
    normalizeAirlineName(r.airline).toLowerCase() === normAir &&
    kg >= r.min_kg &&
    (r.max_kg == null || kg <= r.max_kg)
  );

  const pick = (hubOk: boolean, routeOk: boolean) => scoped.find(r =>
    (hubOk ? r.hub_id === hubId : r.hub_id == null) &&
    (routeOk ? (r.route_name != null && normRoute != null && cleanRoute(r.route_name) === normRoute) : r.route_name == null)
  );

  const match =
    (hubId && normRoute && pick(true, true)) ||
    (hubId && pick(true, false)) ||
    (normRoute && pick(false, true)) ||
    pick(false, false);

  return match ? match.rate_per_kg : null;
}

