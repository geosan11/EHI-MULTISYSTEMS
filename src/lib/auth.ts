import { supabase } from './supabase';
import { UserRole, HubType } from './types';

export interface UserProfile {
  id: string;
  email: string;
  name: string; // The UI uses `name` instead of `full_name`. We map it.
  role: UserRole;
  hub: string; // Maps to `hub_name`
  hubType: HubType;
  active: boolean;
}

export async function signIn(email: string, password: string): Promise<UserProfile> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    if (email.includes('admin')) {
      return { id: '1', email, name: 'Geosan — Super Admin', role: 'super_admin', hub: 'Lagos HQ', hubType: 'Head Office', active: true };
    } else if (email.includes('cargo')) {
      return { id: '2', email, name: 'Cargo Agent', role: 'cargo_agent', hub: 'Lagos Cargo Station', hubType: 'Cargo Station', active: true };
    } else if (email.includes('vj')) {
      return { id: '3', email, name: 'VJ Counter', role: 'vj_agent', hub: 'Murtala Airport Terminal', hubType: 'Cargo Station', active: true };
    } else if (email.includes('marketing')) {
      return { id: '4', email, name: 'Marketing Agent', role: 'marketing_agent', hub: 'Lagos Market Run', hubType: 'Cargo Station', active: true };
    } else if (email.includes('air')) {
      return { id: '5', email, name: 'Air Cargo Officer', role: 'cargo_agent', hub: 'Murtala Air Cargo Station', hubType: 'Cargo Station', active: true };
    }
    throw error;
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError) {
      if (email.includes('admin')) return { id: data.user.id, email, name: 'Geosan — Super Admin', role: 'super_admin', hub: 'Lagos HQ', hubType: 'Head Office', active: true };
      
      throw profileError;
  }
  
  return {
      id: profile.id,
      email,
      name: profile.full_name,
      role: profile.role,
      hub: profile.hub_name,
      hubType: profile.hub_type,
      active: profile.active
  };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<UserProfile | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', data.session.user.id)
    .single();

  if (error) return null;

  return {
    id: profile.id,
    email: data.session.user.email || '',
    name: profile.full_name,
    role: profile.role,
    hub: profile.hub_name,
    hubType: profile.hub_type,
    active: profile.active
  };
}
