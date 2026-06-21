import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient;

function buildClient(): SupabaseClient {
  const url =
    localStorage.getItem('ehi_supabase_url') ||
    (import.meta as any).env?.VITE_SUPABASE_URL ||
    'https://mock.supabase.co';
  const key =
    localStorage.getItem('ehi_supabase_anon_key') ||
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
    'mock-key';

  const isMock = url === 'https://mock.supabase.co';

  const real = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  if (!isMock) return real;

  // Full mock — prevents "Failed to fetch" in demo mode
  return {
    ...real,
    auth: {
      ...real.auth,
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signInWithPassword: async () => {
        throw new Error('Use demo credentials below.');
      },
      signOut: async () => ({ error: null }),
    },
    channel: () => ({
      on: function() { return this; },
      subscribe: () => ({ unsubscribe: () => {} }),
    }),
    removeChannel: async () => {},
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }), limit: () => ({ data: [], error: null }) }),
      insert: async () => ({ data: null, error: null }),
      upsert: async () => ({ data: null, error: null }),
    }),
  } as any;
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

export function getConnectionMode(): 'live' | 'demo' {
  const url =
    localStorage.getItem('ehi_supabase_url') ||
    (import.meta as any).env?.VITE_SUPABASE_URL ||
    '';
  return url && url !== 'https://mock.supabase.co' ? 'live' : 'demo';
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
