import { supabase } from '../lib/supabase';
import type { User } from '../types';

interface AuthResponse {
  user: User | null;
  error?: Error;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

export async function signUp(email: string, password: string, userData: Omit<User, 'id'>): Promise<AuthResponse> {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: userData.name,
        username: userData.username
      }
    }
  });
  
  if (authError) throw authError;
  if (!authData.user) throw new Error('Failed to create user');

  try {
    // Create the user profile
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        name: userData.name,
        username: userData.username,
        height: userData.height,
        weight: userData.weight
      })
      .select()
      .single();
      
    if (profileError) {
      console.error('Profile creation error:', profileError);
      await supabase.auth.signOut();
      throw new Error('Failed to create user profile. Please try again.');
    }

    if (profile) {
      await login(profile);
    }
    return { user: authData.user };
  } catch (err) {
    await supabase.auth.signOut();
    throw err;
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError) throw authError;
  if (!user) return null;

  const { data: userData, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError) throw profileError;
  return userData;
}