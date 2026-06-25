import { supabase } from './supabase';
import { UserRole, HubType } from './types';

export interface UserProfile {
  id: string;
  email: string;
  name: string; // The UI uses `name` instead of `full_name`. We map it.
  role: UserRole;
  hub: string; // Maps to `hub_name`
  hubType: HubType;
  hub_id?: string;
  active: boolean;
}

export async function signIn(email: string, password: string): Promise<UserProfile> {
  if (email === 'admin' && password === 'admin') {
    localStorage.setItem('ehi_demo_mode', 'true');
    return {
      id: 'demo-admin-id',
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'super_admin',
      hub: 'HQ Admin Server',
      hubType: 'Cargo Station',
      active: true
    };
  }

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
  
  const prof: any = profile;
  
  return {
      id: profile.id,
      email: data.user.email || profile.email || '',
      name: profile.name,
      role: profile.role,
      hub: Array.isArray(prof.hubs) ? prof.hubs[0]?.name : (prof.hubs?.name || 'Unknown Hub'),
      hubType: profile.hub_type || (Array.isArray(prof.hubs) ? prof.hubs[0]?.type : prof.hubs?.type) || 'Cargo Station',
      hub_id: profile.hub_id,
      active: profile.active
  };
}

export async function signOut() {
  try {
    localStorage.removeItem('ehi_demo_mode');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch(e) {
    console.warn("Sign out err", e);
  }
}

export async function getSession(): Promise<UserProfile | null> {
  try {
    if (localStorage.getItem('ehi_demo_mode') === 'true') {
      return {
        id: 'demo-admin-id',
        email: 'admin@demo.com',
        name: 'Demo Admin',
        role: 'super_admin',
        hub: 'HQ Admin Server',
        hubType: 'Cargo Station',
        active: true
      };
    }

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
      hubType: profile.hub_type || (Array.isArray(prof.hubs) ? prof.hubs[0]?.type : prof.hubs?.type) || 'Cargo Station',
      hub_id: profile.hub_id,
      active: profile.active
    };
  } catch (err) {
    console.error('Failed to get session:', err);
    return null;
  }
}

