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
      can_edit_ledger,
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
      can_edit_ledger: profile.can_edit_ledger ?? false,
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
  const res = await fetch('/api/admin/create-staff', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to create account');
  return { id: data.id, email: data.email };
}

// Fetches all staff (super_admin sees all, hub admin sees own hub)
export async function fetchStaffList(hubId?: string): Promise<any[]> {
  let q = supabase
    .from('user_profiles')
    .select('id, email, name, role, hub_type, active, hub_id, hubs(name, code)')
    .order('name');

  if (hubId) q = q.eq('hub_id', hubId) as any;

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

// Update a staff profile (role, hub, active status)
export async function updateStaffProfile(
  userId: string,
  updates: { role?: string; hub_id?: string; hub_type?: string; active?: boolean; name?: string; phone?: string; can_edit_ledger?: boolean }
): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function getSession(): Promise<UserProfile | null> {
  try {
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
        can_edit_ledger,
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
      can_edit_ledger: profile.can_edit_ledger ?? false,
    } as any;
  } catch (err) {
    console.error('Failed to get session:', err);
    return null;
  }
}

