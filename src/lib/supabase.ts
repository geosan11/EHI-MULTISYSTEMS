import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { appLogger } from './logger';

let _client: SupabaseClient;

// A custom fetch wrapper to intercept and log Supabase network failures
const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  try {
    const start = Date.now();
    const response = await fetch(input, init);
    const duration = Date.now() - start;

    if (!response.ok) {
      // Log failed Supabase network requests
      const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
      // we only want to clone to read body if it's not a head request
      let errorBody = '';
      try {
        const cloned = response.clone();
        errorBody = await cloned.text();
      } catch (e) {
        errorBody = 'Could not read error body';
      }
      
      appLogger.log('ERROR', 'SUPABASE_API', `HTTP ${response.status} on ${urlStr} (${duration}ms) - ${errorBody.slice(0, 200)}`);
    } else if (duration > 1500) {
      const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
      appLogger.log('WARN', 'SUPABASE_API', `Slow API response on ${urlStr} (${duration}ms)`);
    }
    
    return response;
  } catch (error) {
    const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
    appLogger.log('ERROR', 'SUPABASE_API', `Network failure on ${urlStr}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

let lastBuiltUrl: string | null = null;

function buildClient(): SupabaseClient {
  const url =
    (import.meta as any).env?.VITE_SUPABASE_URL ||
    localStorage.getItem('ehi_supabase_url') ||
    'https://dummy.supabase.co';
  const key =
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
    localStorage.getItem('ehi_supabase_anon_key') ||
    'dummy-key';

  lastBuiltUrl = url;

  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: customFetch }
  });
}

_client = buildClient();

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    return (_client as any)[prop];
  },
});

export function reinitSupabase(): void {
  _client = buildClient();
}

export function getConnectionMode(): 'live' | 'unconfigured' {
  const url =
    (import.meta as any).env?.VITE_SUPABASE_URL ||
    localStorage.getItem('ehi_supabase_url') ||
    '';
  return url && url.includes('supabase.co') && !url.includes('dummy') ? 'live' : 'unconfigured';
}

export async function testSupabaseConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const { error } = await _client.auth.getSession();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Connection failed' };
  }
}

export async function fetchAndApplyServerConfig(): Promise<boolean> {
  // Priority 1: Vite baked-in env vars (fastest, no network needed)
  const viteUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  const viteKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
  if (viteUrl && viteKey && viteUrl.includes('supabase.co') && !viteUrl.includes('dummy')) {
    localStorage.setItem('ehi_supabase_url', viteUrl);
    localStorage.setItem('ehi_supabase_anon_key', viteKey);
    // _client was already built with these exact same Vite env vars at module
    // load time (see buildClient() — it checks the same import.meta.env values
    // first, synchronously). Calling reinitSupabase() here would create a
    // second GoTrueClient bound to the identical storage key for no reason,
    // which is exactly what produces the "Multiple GoTrueClient instances"
    // console warning on every page load. Only rebuild if the values actually
    // differ from what the client already has (e.g. localStorage held a
    // different project from a previous session/device share).
    if (lastBuiltUrl !== viteUrl) {
      reinitSupabase();
    }
    return true;
  }

  // Priority 2: Already in localStorage from a previous session
  const storedUrl = localStorage.getItem('ehi_supabase_url');
  const storedKey = localStorage.getItem('ehi_supabase_anon_key');
  if (storedUrl && storedKey && storedUrl.includes('supabase.co') && !storedUrl.includes('dummy')) {
    reinitSupabase();
    return true;
  }

  // Priority 3: Fetch from Express server (server reads process.env at runtime)
  try {
    const response = await fetch('/api/config', {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return false;

    let config: any = {};
    try {
      const text = await response.text();
      if (text) config = JSON.parse(text);
    } catch(e) {}
    
    if (config.configured && config.supabaseUrl && config.supabaseAnonKey) {
      localStorage.setItem('ehi_supabase_url', config.supabaseUrl);
      localStorage.setItem('ehi_supabase_anon_key', config.supabaseAnonKey);
      reinitSupabase();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── PAGINATED FETCH-ALL ───────────────────────────────────
// Fetches every row a query would match, transparently paging past
// PostgREST's implicit per-request row cap (commonly 1000) -- a query with
// no .range()/.limit() of its own, or one capped at exactly that limit,
// silently drops older rows (query ordered descending) or newer ones
// (ascending) the moment a table crosses that cap, with no error surfaced
// anywhere. `buildPage(from, to)` should be the caller's own query
// (select/filters/order already applied) with `.range(from, to)` as the
// last call, e.g. `(from, to) => supabase.from('t').select('*').eq(...).range(from, to)`.
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Same pagination shape as fetchAllRows, but stops once `maxRows` is
// reached instead of paging through the entire table -- for the rare case
// where a fetch is intentionally unbounded by date/filter (so it WILL
// keep growing as the underlying table does) and could otherwise page
// through an unbounded number of rows as that growth continues, hanging
// the UI and ballooning memory with no ceiling (e.g. the Transaction
// Ledger's "All Time" view). A plain fetchAllRows() is still correct and
// preferred everywhere else in this codebase, where the query is already
// narrowed enough (a specific filter, a bounded window) that it can't
// grow unboundedly on its own. Returns whether the cap was actually hit
// so the caller can warn the user their view may be incomplete, mirroring
// EHIApp.tsx's fetchInitial 5000-row-cap warning.
export async function fetchRowsCapped<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  maxRows: number,
  pageSize = 1000,
): Promise<{ rows: T[]; capped: boolean }> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    if (all.length >= maxRows) return { rows: all, capped: true };
    from += pageSize;
  }
  return { rows: all, capped: false };
}

// ── AUDIT LOG WRITER ─────────────────────────────────────
// Call this from any action that should appear in the audit trail
export async function writeAuditLog(entry: {
  user_id?: string;
  user_name: string;
  action: 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EOD_LOCK' | 'SETTINGS_CHANGE' | 'PAYMENT_CONFIRM' | 'RETRIEVAL' | 'UNRETRIEVE' | 'RETRIEVAL_APPROVE' | 'DEBT_COLLECTION' | 'DEBT_REOPENED';
  table_name?: string;
  record_id?: string;
  description: string;
  hub?: string;
  hub_id?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
}) {
  try {
    await supabase.from('audit_log').insert({
      user_id: entry.user_id && entry.user_id.length > 30 ? entry.user_id : null,
      user_name: entry.user_name,
      action: entry.action,
      table_name: entry.table_name || null,
      record_id: entry.record_id || null,
      description: entry.description,
      hub: entry.hub || null,
      hub_id: entry.hub_id && entry.hub_id.length > 30 ? entry.hub_id : null,
      old_values: entry.old_values || null,
      new_values: entry.new_values || null,
    });
  } catch {
    // Audit log failures must never break the main workflow
  }
}
