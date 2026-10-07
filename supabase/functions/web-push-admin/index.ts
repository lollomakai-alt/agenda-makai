import { createClient } from 'npm:@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';
import { createWebPushHandler } from './logic.js';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
  throw new Error('Configurazione Supabase server-side incompleta per web-push-admin.');
}

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const handler = createWebPushHandler({
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '',
  subject: Deno.env.get('VAPID_SUBJECT') || '',
  async resolveUser(token: string) {
    const { data, error } = await authClient.auth.getUser(token);
    if (error) throw error;
    return data.user;
  },
  async findSubscription(userId: string, endpoint: string) {
    const { data, error } = await serviceClient.from('admin_push_subscriptions')
      .select('endpoint,user_id,p256dh,auth,expiration_time')
      .eq('user_id', userId).eq('endpoint', endpoint).maybeSingle();
    if (error) throw error;
    return data;
  },
  async deleteSubscription(userId: string, endpoint: string) {
    const { error } = await serviceClient.from('admin_push_subscriptions')
      .delete().eq('user_id', userId).eq('endpoint', endpoint);
    if (error) throw error;
  },
  async sendNotification(row: { endpoint: string; p256dh: string; auth: string }, payload: string, vapid: { publicKey: string; privateKey: string; subject: string }) {
    webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    await webPush.sendNotification({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }, payload);
  },
});

Deno.serve(handler);
