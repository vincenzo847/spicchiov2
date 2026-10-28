// Promemoria a fine servizio: ogni sera manda una notifica ai dispositivi delle pizzerie
// che oggi non hanno ancora registrato nessuno scarto. Le pizzerie con la sezione Scarti spenta
// (Impostazioni › Sezioni dell'app, spenta finché il titolare non la accende) non lo ricevono.
// Parte da solo con i Cron Trigger di Cloudflare (vedi "triggers" in wrangler.jsonc).
// Si può avviare a mano con POST /api/promemoria e l'header "Authorization: Bearer <CRON_SECRET>";
// con ?prova=1 salta il controllo dell'ora.
// Variabili d'ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// CRON_SECRET (solo per l'avvio a mano), VAPID_SUBJECT facoltativa.
import { json, fail } from '../util.js';
import { sendPush } from '../webpush.js';

// pizzerie controllate in parallelo, a gruppi, per non aprire troppe connessioni insieme
const GRUPPO = 6;

export async function promemoria(env, { prova = false } = {}) {
  const SB = (env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), SR = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const PUB = (env.VAPID_PUBLIC_KEY || '').trim(), PRIV = (env.VAPID_PRIVATE_KEY || '').trim();
  if (!SB || !SR || !PUB || !PRIV) return { status: 500, body: { error: 'Promemoria non configurati: mancano le chiavi su Cloudflare' } };
  const vapid = { publicKey: PUB, privateKey: PRIV, subject: (env.VAPID_SUBJECT || '').trim() || 'mailto:assistenza@example.com', ttl: 3 * 3600 };
  const H = SR.startsWith('sb_') ? { apikey: SR } : { apikey: SR, Authorization: 'Bearer ' + SR };
  const sb = (path, opt = {}) => fetch(SB + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } });

  // data e ora in Italia (la funzione parte la sera, prima della fine giornata lavorativa)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const oggi = p.year + '-' + p.month + '-' + p.day, md = +p.month * 100 + +p.day;
  // promemoria alle 22 dal 15 ottobre al 15 aprile, alle 23 dal 16 aprile al 14 ottobre.
  // Il cron parte alle 20 e alle 21 UTC: con l'ora legale o solare, solo uno dei due giri cade nell'ora giusta.
  const ora = md >= 1015 || md <= 415 ? 22 : 23;
  if (!prova && +p.hour !== ora) return { status: 200, body: { oggi, fuori_orario: true, ora_italia: +p.hour, ora_promemoria: ora } };

  const out = { oggi, pizzerie: 0, inviati: 0, saltate: 0, spente: 0, rimossi: 0, errori: 0 };
  try {
    const r = await sb('/rest/v1/promemoria?select=endpoint,ristorante_id,p256dh,auth');
    if (!r.ok) return { status: 502, body: { error: 'Lettura dei dispositivi non riuscita (' + r.status + ')' } };
    const subs = await r.json(), byR = {};
    subs.forEach(x => { (byR[x.ristorante_id] = byR[x.ristorante_id] || []).push(x); });
    const body = JSON.stringify({ title: 'Scarti di stasera', body: 'Oggi non è ancora registrato nessuno scarto. C’è qualcosa da segnare?', url: '/' });

    const invia = async x => {
      try {
        const res = await sendPush(x, body, vapid);
        if (res.ok) { out.inviati++; return; }
        // dispositivo che non esiste più (app disinstallata, permesso tolto): lo togliamo
        if (res.status === 404 || res.status === 410) { await sb('/rest/v1/promemoria?endpoint=eq.' + encodeURIComponent(x.endpoint), { method: 'DELETE' }); out.rimossi++; }
        else { out.errori++; console.error('promemoria', res.status, (await res.text().catch(() => '')).slice(0, 200)); }
      } catch (e) { out.errori++; console.error('promemoria', e && e.message); }
    };
    const pizzeria = async ([rid, list]) => {
      out.pizzerie++;
      const s = await sb('/rest/v1/dati?select=valore&chiave=eq.settings&ristorante_id=eq.' + encodeURIComponent(rid));
      if (!s.ok) { out.errori++; return; }
      const set = ((await s.json())[0] || {}).valore || {};
      if (!set.sezioni || set.sezioni.scarti !== true) { out.spente++; return; }
      const w = await sb('/rest/v1/scarti?select=client_id&limit=1&ristorante_id=eq.' + encodeURIComponent(rid) + '&data=eq.' + oggi);
      if (!w.ok) { out.errori++; return; }
      if ((await w.json()).length) { out.saltate++; return; }
      await Promise.all(list.map(invia));
    };
    const tutte = Object.entries(byR);
    for (let i = 0; i < tutte.length; i += GRUPPO) await Promise.all(tutte.slice(i, i + GRUPPO).map(pizzeria));
    return { status: 200, body: out };
  } catch (e) {
    console.error('promemoria', e && e.message);
    return { status: 502, body: { error: 'Promemoria non riusciti: riprova' } };
  }
}

// avvio a mano, solo con la parola segreta CRON_SECRET
export default async function promemoriaHttp(request, env) {
  const CRON = (env.CRON_SECRET || '').trim();
  if (!CRON || String(request.headers.get('authorization') || '') !== 'Bearer ' + CRON) return fail(401, 'Non autorizzato');
  const r = await promemoria(env, { prova: new URL(request.url).searchParams.get('prova') === '1' });
  return json(r.status, r.body);
}
