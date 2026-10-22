// /api/candidatura: il modulo "Partecipa alla prova" del login. Chi vuole provare Spicchio lascia contatti,
// informazioni sulla pizzeria e i consensi; la riga finisce nella tabella public.candidature, che nessuno può
// leggere dall'app (nessuna regola RLS): si guarda solo da Supabase › Table Editor. Usa SUPABASE_SERVICE_ROLE_KEY.
import { json, fail, readJson } from '../util.js';

// versione dei testi dei consensi: se cambiano, si cambia anche questa (resta salvata con ogni risposta)
export const VERSIONE_TESTI = '2026-10-23';
const MAX_ORA = 5; // invii per indirizzo IP in un'ora

const testo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lista = (v, ammessi) => (Array.isArray(v) ? v : []).map(x => testo(x, 60)).filter(x => !ammessi || ammessi.includes(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 12);

export const SCELTE = {
  ruolo: ['Titolare', 'Socio', 'Responsabile di sala', 'Responsabile di cucina', 'Altro'],
  quando: ['Mattina', 'Pomeriggio', 'Sera dopo il servizio', 'Quando capita'],
  chiusura: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
  servizi: ['Solo cena', 'Pranzo e cena'],
  pizze: ['Meno di 300', '300–600', '600–1.000', 'Oltre 1.000'],
  cassa: ['Tilby', 'Un’altra cassa', 'Nessuna cassa elettronica'],
  csv: ['Sì', 'No', 'Non lo so'],
  bolle: ['Su carta', 'In PDF via email', 'Solo fattura elettronica'],
  foodCost: ['Con un foglio Excel', 'A occhio', 'Ci pensa il commercialista', 'No'],
  dispositivi: ['iPhone', 'Telefono Android', 'Tablet', 'PC'],
  rete: ['Sì', 'No', 'Non sempre'],
  obiettivi: ['Tenere sotto controllo il food cost', 'Ridurre gli scarti', 'Capire i margini', 'Controllare i prezzi dei fornitori', 'Altro'],
  feedback: ['Una chiamata di 15 minuti a settimana', 'Messaggi WhatsApp', 'Tutti e due']
};
const CONSENSI_OBBL = ['prova', 'privacy', 'aggregati', 'riservatezza'];

// controlla e ripulisce le risposte; restituisce { errore } oppure { riga }
export function preparaCandidatura(b, adesso = new Date()) {
  const s = k => (SCELTE[k].includes(testo(b[k], 60)) ? testo(b[k], 60) : '');
  const email = testo(b.email, 120).toLowerCase();
  const d = {
    nome: testo(b.nome, 80), ruolo: s('ruolo'), telefono: testo(b.telefono, 30), quando: s('quando'),
    pizzeria: testo(b.pizzeria, 80), citta: testo(b.citta, 80), chiusura: lista(b.chiusura, SCELTE.chiusura), servizi: s('servizi'), pizze: s('pizze'),
    staff: Math.max(0, Math.min(99, Math.round(+b.staff || 0))),
    cassa: s('cassa'), cassaAltra: testo(b.cassaAltra, 60), csv: s('csv'), bolle: lista(b.bolle, SCELTE.bolle), fornitori: testo(b.fornitori, 400),
    foodCost: s('foodCost'), dispositivi: lista(b.dispositivi, SCELTE.dispositivi), rete: s('rete'),
    obiettivi: lista(b.obiettivi, SCELTE.obiettivi), obiettiviAltro: testo(b.obiettiviAltro, 200), feedback: s('feedback')
  };
  if (!d.nome) return { errore: 'Scrivi nome e cognome.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { errore: 'Scrivi un’email valida.' };
  if (d.telefono.replace(/\D/g, '').length < 6) return { errore: 'Scrivi un numero di telefono valido.' };
  if (!d.pizzeria || !d.citta) return { errore: 'Scrivi nome e città della pizzeria.' };
  const c = b.consensi || {};
  if (!CONSENSI_OBBL.every(k => c[k] === true)) return { errore: 'Per partecipare servono le quattro spunte obbligatorie in fondo.' };
  const ora = adesso.toISOString();
  const consensi = Object.fromEntries([...CONSENSI_OBBL, 'citazione'].map(k => [k, c[k] === true ? ora : null]));
  return { riga: { email, pizzeria: d.pizzeria, dati: d, consensi: { ...consensi, versione_testi: VERSIONE_TESTI } } };
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('spicchio-candidature:' + ip));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export default async function candidatura(request, env) {
  if (request.method !== 'POST') return fail(405, 'Metodo non consentito');
  const SB = (env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), SR = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!SB || !SR) return fail(500, 'Modulo non configurato: manca SUPABASE_SERVICE_ROLE_KEY su Cloudflare');
  const b = await readJson(request);
  if (!b) return fail(400, 'Richiesta non valida');
  // campo nascosto: lo compilano solo i programmi automatici. Si risponde "ok" senza salvare niente.
  if (testo(b.sito)) return json(200, { ok: true });
  const p = preparaCandidatura(b);
  if (p.errore) return fail(400, p.errore);
  const ADM = SR.startsWith('sb_') ? { apikey: SR, 'Content-Type': 'application/json' } : { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'sconosciuto', ipHash = await hashIp(ip);
  // al massimo 5 invii all'ora dallo stesso indirizzo
  const da = new Date(Date.now() - 3600e3).toISOString();
  const cnt = await fetch(SB + '/rest/v1/candidature?select=id&ip_hash=eq.' + ipHash + '&creato_il=gte.' + encodeURIComponent(da), { headers: ADM });
  if (cnt.status === 404) return fail(500, 'Database da aggiornare: esegui supabase-candidature.sql in Supabase');
  if (cnt.ok && (await cnt.json()).length >= MAX_ORA) return fail(429, 'Hai già inviato il modulo più volte: riprova tra un’ora.');
  const r = await fetch(SB + '/rest/v1/candidature', { method: 'POST', headers: { ...ADM, Prefer: 'return=minimal' }, body: JSON.stringify({ ...p.riga, ip_hash: ipHash, user_agent: testo(request.headers.get('user-agent'), 200) }) });
  if (r.status === 404) return fail(500, 'Database da aggiornare: esegui supabase-candidature.sql in Supabase');
  if (!r.ok) return fail(500, 'Invio non riuscito: riprova tra poco');
  return json(200, { ok: true });
}
