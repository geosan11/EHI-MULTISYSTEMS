import { supabase } from './supabase';
import { writeAuditLog } from './supabase';
import { UserRole, HubType } from './types';

export interface UserProfile {
  id: string;
  email: string;
  name: string; // The UI uses `name` instead of `full_name`. We map it.
  role: UserRole;
  hub: string; // Maps to `hub_name`
  hub_code?: string;
  hubType: HubType;
  hub_id?: string;
  active: boolean;
}

export async function signIn(email: string, password: string): Promise<UserProfile> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error('Invalid email or password.');
  }

  if (!data?.user) {
    throw new Error('Login failed. Try again.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select(`
      id,
      email,
      name,
      role,
      hub_type,
      active,
      hub_id,
      can_print_ledger,
      hubs (
        name,
        code,
        type
      )
    `)
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Account exists but profile not set up. Contact your admin.');
  }

  if (!profile.active) {
    await supabase.auth.signOut();
    throw new Error('Your account has been deactivated. Contact your admin.');
  }

  const prof: any = profile;
  const result = {
      id: profile.id,
      email: data.user.email || profile.email || '',
      name: profile.name,
      role: profile.role,
      hub: Array.isArray(prof.hubs) ? prof.hubs[0]?.name : (prof.hubs?.name || 'Unknown Hub'),
      hub_code: Array.isArray(prof.hubs) ? prof.hubs[0]?.code : (prof.hubs?.code || 'HQ'),
      hubType: profile.hub_type || (Array.isArray(prof.hubs) ? prof.hubs[0]?.type : prof.hubs?.type) || 'Cargo Station',
      hub_id: profile.hub_id,
      active: profile.active,
      can_print_ledger: profile.can_print_ledger ?? false,
  };

  // Write audit log (fire-and-forget)
  writeAuditLog({
    user_id: result.id,
    user_name: result.name,
    action: 'LOGIN',
    description: `${result.name} logged in at ${result.hub}`,
    hub: result.hub,
    hub_id: result.hub_id,
  }).catch(() => {});

  return result;
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch(e) {
    console.warn("Sign out err", e);
  }
}

// ── STAFF ACCOUNT MANAGEMENT ──────────────────────────────────────

export interface CreateStaffPayload {
  name:      string;
  email:     string;
  password:  string;
  role:      string;
  hub_id:    string;
  hub_type:  string;
  phone?:    string;
}

// Creates a new staff account via the server endpoint
// (server uses service role key — client anon key can't create users)
export async function createStaffAccount(payload: CreateStaffPayload): Promise<{ id: string; email: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';
  const res = await fetch('/api/admin/create-staff', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body:    JSON.stringify(payload),
  });

  let data: any = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) {
      data = JSON.parse(rawText);
    }
  } catch (e) {
    // Not valid JSON — rawText still holds whatever the server actually sent,
    // surfaced below instead of being silently discarded.
  }

  if (!res.ok || data.error) {
    if (res.status === 503) {
      throw new Error('Staff account creation is not configured on the server. Add SUPABASE_SERVICE_ROLE_KEY to your environment variables.');
    }
    const fallback = rawText
      ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
      : `Server returned error status ${res.status} with an empty response`;
    throw new Error(data.error || fallback);
  }
  return { id: data.id, email: data.email };
}

export interface BulkStaffRow {
  row: number; // original CSV row number, kept through chunking for clean error reporting
  name: string;
  email: string;
  role: string;
  hub_code: string;
  hub_type?: string;
  phone?: string;
}

export interface BulkStaffResult {
  row: number;
  email: string;
  success: boolean;
  tempPassword?: string;
  error?: string;
}

// Creates one chunk (max 50 rows) of staff accounts via the bulk endpoint.
// Callers with larger CSVs should split into chunks and call this
// repeatedly — see BulkStaffImport.tsx, which does this with a visible
// progress bar rather than one long-running request.
export async function createStaffAccountsBulk(rows: BulkStaffRow[]): Promise<{ results: BulkStaffResult[]; successCount: number; failureCount: number }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';
  const res = await fetch('/api/admin/create-staff-bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ staff: rows }),
  });

  let data: any = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) data = JSON.parse(rawText);
  } catch (e) {
    // Not valid JSON — rawText still holds whatever the server actually sent.
  }

  if (!res.ok || data.error) {
    const fallback = rawText
      ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
      : `Server returned error status ${res.status} with an empty response`;
    throw new Error(data.error || fallback);
  }
  return data;
}

// Fetches all staff (super_admin sees all, hub admin sees own hub)
export async function fetchStaffList(hubId?: string): Promise<any[]> {
  let q = supabase
    .from('user_profiles')
    .select('id, email, name, role, hub_type, active, hub_id, can_print_ledger, hubs(name, code)')
    .order('name');

  if (hubId) q = q.eq('hub_id', hubId) as any;

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

// Update a staff profile (role, hub, active status)
export async function updateStaffProfile(
  userId: string,
  updates: { role?: string; hub_id?: string; hub_type?: string; active?: boolean; name?: string; phone?: string; can_print_ledger?: boolean }
): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';

  const res = await fetch('/api/admin/update-staff', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body:    JSON.stringify({ userId, updates }),
  });
  
  let data: any = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) data = JSON.parse(rawText);
  } catch(e) {}

  if (!res.ok || data.error) {
    if (res.status === 503) {
      throw new Error('Staff management is not available — the server is not fully configured. Contact your system administrator.');
    }
    const fallback = rawText
      ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
      : `Server returned error status ${res.status} with an empty response`;
    throw new Error(data.error || fallback);
  }
}

async function getSessionInner(): Promise<UserProfile | null> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !data?.session) return null;

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select(`
      id,
      email,
      name,
      role,
      hub_type,
      active,
      hub_id,
      can_print_ledger,
      hubs (
        name,
        code,
        type
      )
    `)
    .eq('id', data.session.user.id)
    .single();

  const prof: any = profile;

  if (error || !profile) {
    return null;
  }

  // A deactivated account is blocked at signIn() time, but that alone
  // doesn't revoke an already-issued refresh token -- without this check,
  // reopening the app or a new tab in an already-signed-in session let a
  // deactivated staffer straight back in, no fresh sign-in required. Tear
  // the session down here too, matching signIn()'s handling.
  if (!profile.active) {
    await supabase.auth.signOut();
    return null;
  }

  return {
    id: profile.id,
    email: data.session.user.email || profile.email || '',
    name: profile.name,
    role: profile.role,
    hub: Array.isArray(prof.hubs) ? prof.hubs[0]?.name : (prof.hubs?.name || 'Unknown Hub'),
    hub_code: Array.isArray(prof.hubs) ? prof.hubs[0]?.code : (prof.hubs?.code || 'HQ'),
    hubType: profile.hub_type || (Array.isArray(prof.hubs) ? prof.hubs[0]?.type : prof.hubs?.type) || 'Cargo Station',
    hub_id: profile.hub_id,
    active: profile.active,
    can_print_ledger: profile.can_print_ledger ?? false,
  } as any;
}

export async function getSession(): Promise<UserProfile | null> {
  try {
    // Neither Supabase call below carries a client-side timeout, so a
    // stalled mobile connection could leave AuthenticatedApp's loading
    // spinner (App.tsx) spinning forever with no fallback. Race against a
    // timeout the same way fetchAndApplyServerConfig already does for
    // /api/config, so a bad connection degrades to the login screen
    // instead of an infinite spinner.
    return await Promise.race([
      getSessionInner(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  } catch (err) {
    console.error('Failed to get session:', err);
    return null;
  }
}

