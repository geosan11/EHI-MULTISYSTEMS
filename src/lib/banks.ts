import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { BANKS } from './constants.js';

export const BANKS_CACHE_KEY = 'ehi_banks';
export const BANKS_CSV_CACHE_KEY = 'ehi_banks_csv_format';

export interface BankOptions {
  /** Append a synthetic 'Other' entry after the real banks. Default true. */
  includeOther?: boolean;
  /** When both the network fetch and the localStorage cache are empty,
   * fall back to the bundled BANKS constant instead of an empty array.
   * Default true. */
  coldFallback?: boolean;
}

export interface BankWithFormat {
  name: string;
  csvFormat: string;
}

// GTBank is the branch's most-used bank -- pinned to the front regardless
// of the underlying source's order (the live `banks` table sorts
// alphabetically, which buried it and staff kept picking the wrong bank).
function pinGTBankFirst(names: string[]): string[] {
  const idx = names.indexOf('GTBank');
  if (idx <= 0) return names;
  return [names[idx], ...names.slice(0, idx), ...names.slice(idx + 1)];
}

export function getCachedBanks(opts: BankOptions = {}): string[] {
  const { includeOther = true, coldFallback = true } = opts;
  let names: string[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(BANKS_CACHE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length > 0) names = parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  if (names.length === 0 && coldFallback) names = BANKS.filter(b => b !== 'Other') as string[];
  names = pinGTBankFirst(names);
  return includeOther ? [...names, 'Other'] : names;
}

export async function fetchBanks(opts: BankOptions = {}): Promise<string[] | null> {
  const { includeOther = true } = opts;
  const { data, error } = await supabase.from('banks').select('name, csv_format').eq('active', true).order('name');
  if (!data || error || data.length === 0) return null;
  const names = pinGTBankFirst(data.map((b: any) => b.name as string));
  const withFormat = data.filter((b: any) => b.csv_format).map((b: any) => ({ name: b.name, csvFormat: b.csv_format }));
  try {
    localStorage.setItem(BANKS_CACHE_KEY, JSON.stringify(names));
    localStorage.setItem(BANKS_CSV_CACHE_KEY, JSON.stringify(withFormat));
  } catch {
    // localStorage unavailable -- nothing to persist to, the fetch result is still returned
  }
  return includeOther ? [...names, 'Other'] : names;
}

// Cached/fallback list on first render (instant paint, works offline);
// swaps to the live Supabase list once the fetch resolves.
export function useBanks(opts: BankOptions = {}): string[] {
  const [banks, setBanks] = useState<string[]>(() => getCachedBanks(opts));
  useEffect(() => {
    let cancelled = false;
    fetchBanks(opts).then(names => {
      if (names && !cancelled) setBanks(names);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return banks;
}

function getCachedBanksWithFormat(): BankWithFormat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BANKS_CSV_CACHE_KEY) || 'null');
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

// BankReconciliation.tsx needs the csv_format key (not just the display
// name) to pick the right statement parser -- this is the richer read path
// for that one consumer; every other bank dropdown uses plain useBanks().
export function useBanksWithFormat(): BankWithFormat[] {
  const [banks, setBanks] = useState<BankWithFormat[]>(() => getCachedBanksWithFormat());
  useEffect(() => {
    let cancelled = false;
    fetchBanks({ includeOther: false }).then(() => {
      if (!cancelled) setBanks(getCachedBanksWithFormat());
    });
    return () => { cancelled = true; };
  }, []);
  return banks;
}
