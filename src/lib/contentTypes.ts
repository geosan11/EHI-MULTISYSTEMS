import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { CONTENT_TYPES } from './constants.js';

export const CONTENT_TYPES_CACHE_KEY = 'ehi_content_types';

export interface ContentTypesOptions {
  /** Append a synthetic 'Other' entry after the real content types. Default true. */
  includeOther?: boolean;
  /** When both the network fetch and the localStorage cache are empty
   * (a device that has never gone online), fall back to the bundled
   * CONTENT_TYPES constant instead of an empty array. Default true. */
  coldFallback?: boolean;
}

export function getCachedContentTypes(opts: ContentTypesOptions = {}): string[] {
  const { includeOther = true, coldFallback = true } = opts;
  let names: string[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTENT_TYPES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length > 0) names = parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  if (names.length === 0 && coldFallback) names = CONTENT_TYPES.filter(c => c !== 'Other') as string[];
  return includeOther ? [...names, 'Other'] : names;
}

export async function fetchContentTypes(opts: ContentTypesOptions = {}): Promise<string[] | null> {
  const { includeOther = true } = opts;
  const { data, error } = await supabase.from('content_types').select('name').eq('active', true).order('name');
  if (!data || error || data.length === 0) return null;
  const names = data.map((r: any) => r.name as string);
  try {
    localStorage.setItem(CONTENT_TYPES_CACHE_KEY, JSON.stringify(names));
  } catch {
    // localStorage unavailable -- nothing to persist to, the fetch result is still returned
  }
  return includeOther ? [...names, 'Other'] : names;
}

// Cached/fallback list on first render (instant paint, works offline);
// swaps to the live Supabase list once the fetch resolves.
// Periodic + focus/visibility refresh, matching officeWork.ts's corpRates
// pattern -- without it, an admin editing content types in ContentTypes.tsx
// mid-shift was invisible to any intake form tab already open elsewhere
// until it happened to remount.
export function useContentTypes(opts: ContentTypesOptions = {}): string[] {
  const [types, setTypes] = useState<string[]>(() => getCachedContentTypes(opts));
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetchContentTypes(opts).then(names => { if (names && !cancelled) setTypes(names); }); };
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
  return types;
}
