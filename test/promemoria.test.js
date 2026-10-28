// Promemoria a fine servizio: solo alle pizzerie con la sezione Scarti accesa e nessuno scarto oggi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { promemoria } from '../src/api/promemoria.js';
import { b64uEncode } from '../src/webpush.js';

test('Scarti spenta o mai accesa: nessun promemoria', async () => {
  const server = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', VAPID_PUBLIC_KEY: b64uEncode(await crypto.subtle.exportKey('raw', server.publicKey)), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', server.privateKey)).d };
  const dev = () => { const d = createECDH('prime256v1'); d.generateKeys(); return { p256dh: b64uEncode(d.getPublicKey()), auth: b64uEncode(randomBytes(16)) }; };
  const subs = [{ endpoint: 'https://push.test/accesa', ristorante_id: 'r1', ...dev() }, { endpoint: 'https://push.test/spenta', ristorante_id: 'r2', ...dev() }, { endpoint: 'https://push.test/mai', ristorante_id: 'r3', ...dev() }];
  const settings = { r1: { sezioni: { scarti: true, ordini: false, bolle: false } }, r2: { sezioni: { scarti: false } }, r3: { dayEnd: 5 } };
  const pushed = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url), j = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://push.test/')) { pushed.push(u); return new Response(null, { status: 201 }); }
    if (u.includes('/rest/v1/promemoria?select=')) return j(subs);
    const rid = (u.match(/ristorante_id=eq\.([^&]+)/) || [])[1];
    if (u.includes('/rest/v1/dati?')) return j([{ valore: settings[rid] }]);
    if (u.includes('/rest/v1/scarti?')) return j([]);
    throw new Error('richiesta inattesa ' + u);
  };
  const r = await promemoria(env, { prova: true });
  assert.equal(r.status, 200);
  assert.deepEqual(pushed, ['https://push.test/accesa']);
  assert.equal(r.body.spente, 2);
  assert.equal(r.body.inviati, 1);
});
