// /api/candidatura: il modulo "Partecipa alla prova" salva solo risposte complete, con i consensi datati,
// ignora i programmi automatici e limita gli invii ripetuti.
import test from 'node:test';
import assert from 'node:assert/strict';
import candidatura, { preparaCandidatura, VERSIONE_TESTI } from '../src/api/candidatura.js';

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' };
const OK = {
  nome: 'Mario Rossi', ruolo: 'Titolare', email: 'Mario@Esempio.it ', telefono: '333 123 4567', quando: 'Mattina',
  pizzeria: 'Da Mario', citta: 'Napoli', chiusura: ['Martedì', 'Martedì', 'Festa'], servizi: 'Solo cena', pizze: '300–600', staff: '4',
  cassa: 'Tilby', csv: 'Sì', bolle: ['Su carta'], fornitori: 'Caseificio X', foodCost: 'A occhio', dispositivi: ['iPhone', 'PC'], rete: 'Sì',
  obiettivi: ['Ridurre gli scarti'], feedback: 'Messaggi WhatsApp',
  consensi: { prova: true, privacy: true, aggregati: true, riservatezza: true, citazione: false }
};

function finto(giaInviati = 0) {
  const calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url), m = opt.method || 'GET';
    calls.push({ m, u: u.replace('https://sb.test', ''), body: opt.body ? JSON.parse(opt.body) : null, headers: opt.headers });
    if (m === 'GET' && u.includes('/rest/v1/candidature?select=id')) return new Response(JSON.stringify(Array.from({ length: giaInviati }, (_, i) => ({ id: i }))), { status: 200 });
    if (m === 'POST' && u.endsWith('/rest/v1/candidature')) return new Response(null, { status: 201 });
    return new Response('{}', { status: 404 });
  };
  return calls;
}
const invia = body => candidatura(new Request('https://app.test/api/candidatura', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'prova' }, body: JSON.stringify(body) }), env);

test('risposte complete: salvate con consensi datati e scelte ripulite', async () => {
  const calls = finto();
  const r = await invia(OK);
  assert.equal(r.status, 200);
  const ins = calls.find(c => c.m === 'POST');
  assert.equal(ins.body.email, 'mario@esempio.it');
  assert.deepEqual(ins.body.dati.chiusura, ['Martedì']);
  assert.equal(ins.body.dati.staff, 4);
  assert.match(ins.body.consensi.privacy, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ins.body.consensi.citazione, null);
  assert.equal(ins.body.consensi.versione_testi, VERSIONE_TESTI);
  assert.equal(ins.body.ip_hash.length, 32);
  assert.notEqual(ins.body.ip_hash, '1.2.3.4');
  assert.equal(ins.headers.apikey, 'sb_secret_x');
});

test('manca un consenso obbligatorio: non salva', async () => {
  const calls = finto();
  const r = await invia({ ...OK, consensi: { ...OK.consensi, riservatezza: false } });
  assert.equal(r.status, 400);
  assert.equal(calls.filter(c => c.m === 'POST').length, 0);
});

test('email non valida o telefono mancante: errore chiaro', () => {
  assert.match(preparaCandidatura({ ...OK, email: 'mario' }).errore, /email/);
  assert.match(preparaCandidatura({ ...OK, telefono: '12' }).errore, /telefono/);
  assert.match(preparaCandidatura({ ...OK, pizzeria: '' }).errore, /pizzeria/);
});

test('campo nascosto compilato (programma automatico): risponde ok ma non salva', async () => {
  const calls = finto();
  const r = await invia({ ...OK, sito: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 0);
});

test('troppi invii dallo stesso indirizzo in un’ora: 429', async () => {
  const calls = finto(5);
  const r = await invia(OK);
  assert.equal(r.status, 429);
  assert.equal(calls.filter(c => c.m === 'POST').length, 0);
});

test('tabella non ancora creata: messaggio per eseguire lo script', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  const r = await invia(OK);
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /supabase-candidature\.sql/);
});
