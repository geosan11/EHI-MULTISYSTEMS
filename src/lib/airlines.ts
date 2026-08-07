import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';

// Same key AirlineCommissions.tsx/CargoForm.tsx/AirlineLedger.tsx already
// read/write today -- kept identical so existing devices' cached value
// isn't orphaned when those files are refactored onto this shared helper.
// Unlike hubRoutes.ts's cache (a plain string array), this key holds a
// Record<airlineName, commissionPercent> JSONB blob -- getCachedAirlines
// reads its keys.
export const AIRLINES_CACHE_KEY = 'ehi_airline_commissions';

// Cold-start fallback only -- used when both the network fetch and the
// localStorage cache are empty (a device that has never gone online).
const FALLBACK_AIRLINES = ['Arik Air', 'Green Africa Airways', 'United Nigeria Airlines'];

export interface AirlinesOptions {
  /** Append a synthetic 'Other' entry after the real airlines. Default true. */
  includeOther?: boolean;
  /** When both the network fetch and the localStorage cache are empty,
   * fall back to FALLBACK_AIRLINES instead of an empty array. Default true. */
  coldFallback?: boolean;
}

// The cache always stores the raw commissions blob only (no 'Other' baked
// in) -- includeOther is applied at read time, per caller, same convention
// hubRoutes.ts uses for its own cache key.
export function getCachedAirlines(opts: AirlinesOptions = {}): string[] {
  const { includeOther = true, coldFallback = true } = opts;
  let names: string[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(AIRLINES_CACHE_KEY) || 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      names = Object.keys(parsed);
    }
  } catch {
    // ignore -- treated the same as an empty cache
  }
  if (names.length === 0 && coldFallback) names = [...FALLBACK_AIRLINES];
  return includeOther ? [...names, 'Other'] : names;
}

export async function fetchAirlines(opts: AirlinesOptions = {}): Promise<string[] | null> {
  const { includeOther = true } = opts;
  const { data, error } = await supabase.from('pricing_config')
    .select('config_value')
    .eq('config_key', 'airline_commissions')
    .single();
  if (!data?.config_value || error) return null;
  const names = Object.keys(data.config_value as Record<string, number>);
  if (names.length === 0) return null;
  try {
    localStorage.setItem(AIRLINES_CACHE_KEY, JSON.stringify(data.config_value));
  } catch {
    // localStorage unavailable -- nothing to persist to, the fetch result is still returned
  }
  return includeOther ? [...names, 'Other'] : names;
}

// Cached/fallback list on first render (instant paint, works offline);
// swaps to the live Supabase list once the fetch resolves.
// Periodic + focus/visibility refresh, matching officeWork.ts's corpRates
// pattern -- without it, an admin adding an airline in AirlineCommissions.tsx
// mid-shift was invisible to any intake form tab already open elsewhere
// until it happened to remount.
export function useAirlines(opts: AirlinesOptions = {}): string[] {
  const [airlines, setAirlines] = useState<string[]>(() => getCachedAirlines(opts));
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetchAirlines(opts).then(names => { if (names && !cancelled) setAirlines(names); }); };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return airlines;
}

function getCachedAirlineCommissions(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(AIRLINES_CACHE_KEY) || 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  return {};
}

// The commission-percentage map itself (useAirlines above only exposes the
// airline NAMES, not their rates) -- same cached/fallback-then-live pattern,
// so a caller reading this on mount gets the last-known rates immediately
// and the fresh Supabase values the moment that fetch resolves, instead of
// each call site re-reading localStorage directly and never refreshing
// once mounted (which could book a transaction against a stale or
// default-0% commission rate if the caller renders before this key was
// ever written, e.g. a slow/offline first load on a fresh device).
export function useAirlineCommissions(): Record<string, number> {
  const [commissions, setCommissions] = useState<Record<string, number>>(() => getCachedAirlineCommissions());
  useEffect(() => {
    let cancelled = false;
    supabase.from('pricing_config').select('config_value').eq('config_key', 'airline_commissions').single()
      .then(({ data, error }) => {
        if (cancelled || error || !data?.config_value) return;
        setCommissions(data.config_value as Record<string, number>);
      });
    return () => { cancelled = true; };
  }, []);
  return commissions;
}

// Adds a new airline to pricing_config.airline_commissions if it isn't
// already present, with a default commission rate -- centralizes the
// "typed a new airline into an 'Other' field" upsert that CargoForm.tsx
// used to hand-roll inline, so every entry point for a brand-new airline
// (Cargo intake, Airline Commissions' own add form) goes through one path.
export async function addAirlineIfMissing(name: string, defaultCommission = 5): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { data } = await supabase.from('pricing_config')
    .select('config_value')
    .eq('config_key', 'airline_commissions')
    .single();
  const current: Record<string, number> = (data?.config_value as any) || {};
  if (trimmed in current) return;
  const updated = { ...current, [trimmed]: defaultCommission };
  await supabase.from('pricing_config').upsert({
    config_key: 'airline_commissions',
    config_value: updated,
    description: 'Airline commission percentages',
  }, { onConflict: 'config_key' });
  try {
    localStorage.setItem(AIRLINES_CACHE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
