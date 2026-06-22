import { supabase } from './supabase';
import { UserRole, HubType } from './types';
import { DEMO_USERS } from './constants';

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
  let data, error;
  try {
    const res = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    data = res.data;
    error = res.error;
  } catch (err) {
    error = err;
  }

  if (error || !data?.user) {
    // Look up the email directly in DEMO_USERS
    // This is the single source of truth for all demo accounts
    const demoUser = DEMO_USERS[email as keyof typeof DEMO_USERS];
    
    if (demoUser) {
      // Optionally verify password in demo mode
      if (password !== demoUser.password) {
        throw new Error('Incorrect password. Check the demo credentials below.');
      }
      return {
        id: `demo-${email.split('@')[0]}`,
        email,
        name: demoUser.name,
        role: demoUser.role,
        hub: demoUser.hub,
        hubType: demoUser.hubType,
        active: true,
      };
    }

    // Not a demo user and Supabase failed
    throw new Error('Invalid credentials. Please use one of the demo credentials below.');
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      const fallbackDemo = DEMO_USERS[email as keyof typeof DEMO_USERS];
      if (fallbackDemo) {
        return {
          id: data.user.id ?? `demo-${email.split('@')[0]}`,
          email,
          name: fallbackDemo.name,
          role: fallbackDemo.role,
          hub: fallbackDemo.hub,
          hubType: fallbackDemo.hubType,
          active: true,
        };
      }
      throw new Error('Your account profile was not found. Contact admin.');
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
  } catch (err: any) {
    const fallbackDemo = DEMO_USERS[email as keyof typeof DEMO_USERS];
    if (fallbackDemo) {
      return {
        id: data?.user?.id ?? `demo-${email.split('@')[0]}`,
        email,
        name: fallbackDemo.name,
        role: fallbackDemo.role,
        hub: fallbackDemo.hub,
        hubType: fallbackDemo.hubType,
        active: true,
      };
    }
    throw new Error('Your account profile was not found. Contact admin.');
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch(e) {
    console.warn("Sign out err", e);
  }
}

export async function getSession(): Promise<UserProfile | null> {
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data?.session) return null;

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data.session.user.id)
      .single();

    if (error) {
      if (error.message === 'Failed to fetch' || error instanceof TypeError) {
        return {
          id: data.session.user.id,
          email: data.session.user.email || 'admin@geosan.com',
          name: 'Demo Admin',
          role: 'super_admin',
          hub: 'Lagos HQ',
          hubType: 'Head Office',
          active: true
        };
      }
      return null;
    }

    return {
      id: profile.id,
      email: data.session.user.email || '',
      name: profile.full_name,
      role: profile.role,
      hub: profile.hub_name,
      hubType: profile.hub_type,
      active: profile.active
    };
  } catch (err) {
    console.error('Failed to get session:', err);
    if (err instanceof TypeError || (err as Error)?.message === 'Failed to fetch') {
      return null; // or could return a mock
    }
    return null;
  }
}

