// /api/config: passa all'app indirizzo e chiave pubblica di Supabase, il sito e la chiave pubblica delle notifiche.
import { json } from '../util.js';

export default async function config(request, env) {
  return json(200, { url: env.SUPABASE_URL || '', key: env.SUPABASE_ANON_KEY || '', site: env.SITE_URL || '', vapid: (env.VAPID_PUBLIC_KEY || '').trim() });
}
