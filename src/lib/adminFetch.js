import { supabase } from './supabase';
export async function adminFetch(url, options = {}) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Accedi per consultare l’agenda.');
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${session.access_token}` } });
}
