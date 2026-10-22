// /api/persone: il titolare aggiunge, toglie o cambia la password ai dipendenti della sua pizzeria.
// Variabili d'ambiente: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Con /api/candidatura e il promemoria, è uno dei punti che usano la chiave service_role: prima di ogni azione controlla
// che chi chiede sia collegato e sia il titolare della pizzeria indicata.
import { json, fail, readJson } from '../util.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PERSONE = 30;

// messaggio leggibile dagli errori di Supabase Auth (con il codice, per capire cosa non va)
function authMsg(status, e) {
  const code = String(e.error_code || e.code || ''), text = String(e.msg || e.message || e.error_description || e.error || '');
  if (code === 'weak_password' || /password/i.test(text)) return 'Supabase non accetta questa password' + (Array.isArray(e.weak_password && e.weak_password.reasons) ? ' (' + e.weak_password.reasons.join(', ') + ')' : '') + ': prova con lettere maiuscole, minuscole, numeri e un simbolo, oppure controlla le regole in Authentication › Providers › Email';
  if (code === 'email_address_invalid' || /email/i.test(text)) return 'Supabase non accetta questa email: ' + (text || code);
  if (status === 401 || status === 403) return 'Supabase ha rifiutato la chiave: controlla che SUPABASE_SERVICE_ROLE_KEY su Cloudflare sia la chiave segreta (service_role o sb_secret_), non quella pubblica';
  return 'Creazione dell’account non riuscita (' + status + (code ? ' · ' + code : '') + (text ? ': ' + text.slice(0, 120) : '') + ')';
}

export default async function persone(request, env) {
  if (request.method !== 'POST') return fail(405, 'Metodo non consentito');
  const SB = (env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), ANON = (env.SUPABASE_ANON_KEY || '').trim(), SR = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!SB || !ANON || !SR) return fail(500, 'Gestione persone non configurata: manca SUPABASE_SERVICE_ROLE_KEY su Cloudflare');
  // chiave nuova (sb_secret_…): basta l'header apikey; chiave vecchia (JWT eyJ…): va anche in Authorization
  const ADM = SR.startsWith('sb_') ? { apikey: SR, 'Content-Type': 'application/json' } : { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
  const sb = (path, opt = {}) => fetch(SB + path, { ...opt, headers: { ...ADM, ...(opt.headers || {}) } });
  // gestione account (Auth admin): con la chiave nuova alcuni progetti la vogliono anche in Authorization, quindi si riprova una volta
  const adm = async (path, opt = {}) => {
    const r = await sb(path, opt);
    return (r.status === 401 || r.status === 403) && SR.startsWith('sb_') ? sb(path, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + SR } }) : r;
  };

  try {
    // 1. chi chiede: sessione valida
    const auth = String(request.headers.get('authorization') || '');
    const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!tok) return fail(401, 'Accesso richiesto');
    const u = await fetch(SB + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + tok } });
    if (!u.ok) return fail(401, 'Sessione non valida: accedi di nuovo');
    const me = (await u.json()).id;

    // 2. richiesta
    const b = await readJson(request);
    if (!b) return fail(400, 'Richiesta non valida');
    const rid = String(b.ristorante_id || ''), action = String(b.action || '');
    if (!UUID.test(rid) || !UUID.test(String(me || ''))) return fail(400, 'Pizzeria non indicata');

    // 3. solo il titolare di quella pizzeria
    const mine = await sb('/rest/v1/membri?select=ruolo&user_id=eq.' + me + '&ristorante_id=eq.' + rid);
    if (!mine.ok) return fail(502, 'Controllo dei permessi non riuscito');
    if (!(await mine.json()).some(m => m.ruolo === 'titolare')) return fail(403, 'Solo il titolare gestisce le persone della pizzeria');

    const membersOf = async uid => { const r = await sb('/rest/v1/membri?select=ristorante_id,ruolo&user_id=eq.' + uid); if (!r.ok) throw new Error('membri'); return r.json(); };
    const password = String(b.password || '');
    const pwOk = password.length >= 10 && password.length <= 72;

    if (action === 'aggiungi') {
      const email = String(b.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return fail(400, 'Scrivi un’email valida');
      const cnt = await sb('/rest/v1/membri?select=user_id&ristorante_id=eq.' + rid);
      if (cnt.ok && (await cnt.json()).length >= MAX_PERSONE) return fail(400, 'Hai già ' + MAX_PERSONE + ' persone: togline qualcuna prima di aggiungere');
      const find = async () => {
        const r = await sb('/rest/v1/rpc/id_utente_da_email', { method: 'POST', body: JSON.stringify({ p_email: email }) });
        if (r.status === 404) { const e = new Error('schema'); e.schema = true; throw e; }
        if (!r.ok) throw new Error('cerca ' + r.status);
        const id = await r.json();
        return UUID.test(String(id || '')) ? id : null;
      };
      let uid = await find(), nuovo = false, usato = false;
      if (uid) {
        const ms = await membersOf(uid);
        if (ms.some(m => m.ristorante_id === rid)) return fail(409, 'Questa persona fa già parte della pizzeria');
        // account rimasto senza pizzeria (creato a mano, da un invito o da prove precedenti): riceve la password provvisoria,
        // altrimenti entrerebbe con una password che nessuno conosce. Chi lavora in altre pizzerie tiene la sua.
        // Con la registrazione aperta, un account senza pizzeria può essere di un titolare che si è appena iscritto:
        // la password si cambia solo agli account mai usati e non registrati dall'app, così nessuno prende l'account di un altro.
        if (!ms.length) {
          const g = await adm('/auth/v1/admin/users/' + uid);
          if (!g.ok) return fail(502, 'Controllo dell’account non riuscito');
          const acc = await g.json(), meta = acc.user_metadata || {};
          if (meta.pizzeria || meta.pizzeria_creata) return fail(409, 'Questa email è registrata come titolare di un’altra pizzeria: usa un’altra email');
          // account già usato: entra con la password che conosce già
          usato = !!acc.last_sign_in_at;
        }
        if (!ms.length && pwOk && !usato) {
          const p = await adm('/auth/v1/admin/users/' + uid, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) });
          if (!p.ok) { const err = await p.json().catch(() => ({})); console.error('password account esistente', p.status, JSON.stringify(err)); return fail(502, authMsg(p.status, err)); }
          nuovo = true;
        }
      } else {
        if (!pwOk) return fail(400, 'La password provvisoria deve avere almeno 10 caratteri');
        const body = JSON.stringify({ email, password, email_confirm: true });
        const c = await adm('/auth/v1/admin/users', { method: 'POST', body });
        if (c.ok) { uid = (await c.json()).id; nuovo = true; }
        else {
          const err = await c.json().catch(() => ({}));
          uid = await find();
          if (!uid) { console.error('crea utente', c.status, JSON.stringify(err)); return fail(c.status === 422 || c.status === 400 ? 400 : 502, authMsg(c.status, err)); }
        }
      }
      const ins = await sb('/rest/v1/membri', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, ristorante_id: rid, ruolo: 'staff' }) });
      if (!ins.ok) return fail(502, 'Collegamento alla pizzeria non riuscito');
      return json(200, { ok: true, nuovo });
    }

    // azioni su una persona già nella pizzeria: solo staff, mai il titolare stesso
    const uid = String(b.user_id || '');
    if (!UUID.test(uid)) return fail(400, 'Persona non indicata');
    if (uid === me) return fail(400, 'Non puoi farlo sul tuo account');
    const ms = await membersOf(uid), here = ms.find(m => m.ristorante_id === rid);
    if (!here) return fail(404, 'Questa persona non fa parte della pizzeria');
    if (here.ruolo !== 'staff') return fail(403, 'Puoi gestire solo lo staff');

    if (action === 'togli') {
      const del = await sb('/rest/v1/membri?user_id=eq.' + uid + '&ristorante_id=eq.' + rid, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!del.ok) return fail(502, 'Rimozione non riuscita');
      // se non lavora in altre pizzerie l'account non serve più
      let eliminato = false;
      if (ms.length === 1) { const d = await adm('/auth/v1/admin/users/' + uid, { method: 'DELETE' }); eliminato = d.ok; }
      return json(200, { ok: true, eliminato });
    }

    if (action === 'password') {
      if (!pwOk) return fail(400, 'La password deve avere almeno 10 caratteri');
      if (ms.length !== 1) return fail(403, 'Questa persona lavora anche in un’altra pizzeria: può cambiarla da “Password dimenticata?”');
      const p = await adm('/auth/v1/admin/users/' + uid, { method: 'PUT', body: JSON.stringify({ password }) });
      if (!p.ok) { const err = await p.json().catch(() => ({})); console.error('cambio password', p.status, JSON.stringify(err)); return fail(p.status === 422 || p.status === 400 ? 400 : 502, authMsg(p.status, err).replace('Creazione dell’account non riuscita', 'Cambio password non riuscito')); }
      return json(200, { ok: true });
    }

    return fail(400, 'Azione non riconosciuta');
  } catch (e) {
    console.error('persone', e && e.message);
    if (e && e.schema) return fail(500, 'Database da aggiornare: esegui lo script supabase-persone.sql in Supabase');
    return fail(502, 'Servizio non raggiungibile: riprova tra poco');
  }
}
