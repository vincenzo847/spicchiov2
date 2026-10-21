// Spicchio su Cloudflare Workers: un solo Worker serve l'app (cartella public/), le funzioni in /api/
// e il promemoria serale (Cron Trigger). Tutte le richieste passano prima da qui ("run_worker_first"),
// così le intestazioni di sicurezza si costruiscono con l'indirizzo Supabase della variabile SUPABASE_URL:
// cambiando progetto Supabase basta cambiare la variabile, senza toccare il codice.
import config from './api/config.js';
import claude from './api/claude.js';
import persone from './api/persone.js';
import promemoriaHttp, { promemoria } from './api/promemoria.js';
import { fail } from './util.js';

const API = { '/api/config': config, '/api/claude': claude, '/api/persone': persone, '/api/promemoria': promemoriaHttp };

function sicurezza(env) {
  let sb = '';
  try { sb = new URL(env.SUPABASE_URL || '').origin; } catch (e) {}
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdnjs.cloudflare.com https://unpkg.com",
    "worker-src 'self' blob: https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: blob: https://fonts.gstatic.com",
    "img-src 'self' data: blob: " + sb,
    "connect-src 'self' blob: data: " + sb + ' https://cdnjs.cloudflare.com',
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  return {
    'Content-Security-Policy': csp.replace(/ +;/g, ';'),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let res;
    if (url.pathname.startsWith('/api/')) {
      const h = API[url.pathname.replace(/\/+$/, '')];
      try { res = h ? await h(request, env) : fail(404, 'Funzione inesistente'); }
      catch (e) { console.error(url.pathname, e && e.stack); res = fail(500, 'Errore del server: riprova tra poco'); }
    } else {
      res = await env.ASSETS.fetch(request);
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(sicurezza(env))) res.headers.set(k, v);
    // il service worker va sempre ricontrollato, altrimenti gli aggiornamenti dell'app tardano ad arrivare
    if (url.pathname === '/sw.js') res.headers.set('Cache-Control', 'no-cache');
    return res;
  },

  async scheduled(controller, env, ctx) {
    const r = await promemoria(env);
    console.log('promemoria', r.status, JSON.stringify(r.body));
  }
};
