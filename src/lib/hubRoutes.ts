import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { CARGO_ROUTES } from './constants.js';

// Same key PackageForm.tsx already used for its own inline version of this
// fetch -- kept identical so real devices' existing cached value isn't
// orphaned when that file is refactored onto this shared helper.
export const HUB_ROUTES_CACHE_KEY = 'ehi_hub_destinations';

export interface HubRoutesOptions {
  /** Append a synthetic 'Other' entry after the real hubs. Default true. */
  includeOther?: boolean;
  /** When both the network fetch and the localStorage cache are empty
   * (a device that has never gone online), fall back to the bundled
   * CARGO_ROUTES constant instead of an empty array. Default true. */
  coldFallback?: boolean;
}

// The cache always stores the raw hub list only (no 'Other' appended) --
// includeOther is applied at read time, per caller. If 'Other' were baked
// into the persisted value, two consumers with different includeOther
// settings sharing this one cache key would stomp on each other's cached
// value depending on write order.
export function getCachedHubRoutes(opts: HubRoutesOptions = {}): string[] {
  const { includeOther = true, coldFallback = true } = opts;
  let hubs: string[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HUB_ROUTES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length > 0) hubs = parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  if (hubs.length === 0 && coldFallback) hubs = CARGO_ROUTES.filter(r => r !== 'Other');
  return includeOther ? [...hubs, 'Other'] : hubs;
}

export async function fetchHubRoutes(opts: HubRoutesOptions = {}): Promise<string[] | null> {
  const { includeOther = true } = opts;
  try {
    const { data, error } = await supabase.from('hubs').select('name, code').eq('active', true).order('name');
    if (!data || error || data.length === 0) return null;
    const formatted = data.map((h: any) => `${h.code}/${h.name}`);
    try {
      localStorage.setItem(HUB_ROUTES_CACHE_KEY, JSON.stringify(formatted));
    } catch {
      // localStorage unavailable -- nothing to persist to, the fetch result is still returned
    }
    return includeOther ? [...formatted, 'Other'] : formatted;
  } catch {
    // Network failure etc. -- caller (useHubRoutes) keeps showing the
    // cached/fallback list rather than this becoming an unhandled rejection.
    return null;
  }
}

// Cached/fallback list on first render (instant paint, works offline);
// swaps to the live Supabase list once the fetch resolves.
export function useHubRoutes(opts: HubRoutesOptions = {}): string[] {
  const [routes, setRoutes] = useState<string[]>(() => getCachedHubRoutes(opts));
  useEffect(() => {
    let cancelled = false;
    fetchHubRoutes(opts).then(formatted => {
      if (formatted && !cancelled) setRoutes(formatted);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return routes;
}

// A selection seeded from routes[0] on first render (before the live fetch
// resolves) never re-checks itself once `routes` later swaps to the live
// list -- if that cache/fallback-era first entry was since renamed or
// deactivated, the selection keeps holding a value that no longer matches
// any real option, and a form can silently submit it. Callers that seed a
// selection from useHubRoutes()'s result should also call this so the
// selection snaps back to a valid option once the live list is in.
export function useValidatedRouteSelection(
  routes: string[],
  selected: string,
  setSelected: (v: string) => void,
): void {
  useEffect(() => {
    // An intentionally empty selection (a form seeded with "" so staff must
    // consciously pick one, instead of a silently-prefilled first option)
    // is not a stale value to snap back from -- only correct a genuinely
    // stale non-empty selection left over from a cached/fallback list.
    if (routes.length > 0 && selected !== '' && !routes.includes(selected)) setSelected(routes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);
}
