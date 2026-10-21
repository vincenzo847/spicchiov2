// /api/persone con un account che esiste già e non è in nessuna pizzeria:
// non si deve poter prendere l'account di un titolare che si è registrato dall'app.
import test from 'node:test';
import assert from 'node:assert/strict';
import persone from '../src/api/persone.js';

const ME = '11111111-1111-1111-1111-111111111111', RID = '33333333-3333-3333-3333-333333333333', ALTRO = '22222222-2222-2222-2222-222222222222';
const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' };

function finto(account) {
  const calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url), m = opt.method || 'GET';
    calls.push(m + ' ' + u.replace('https://sb.test', ''));
    const j = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return j({ id: ME });
    if (u.includes('/rest/v1/membri?select=ruolo&user_id=eq.' + ME)) return j([{ ruolo: 'titolare' }]);
    if (u.includes('/rest/v1/membri?select=user_id&ristorante_id')) return j([]);
    if (u.includes('/rpc/id_utente_da_email')) return j(ALTRO);
    if (u.includes('/rest/v1/membri?select=ristorante_id,ruolo&user_id=eq.' + ALTRO)) return j([]);
    if (u.endsWith('/auth/v1/admin/users/' + ALTRO) && m === 'GET') return j(account);
    if (u.endsWith('/auth/v1/admin/users/' + ALTRO) && m === 'PUT') return j({});
    if (u.endsWith('/rest/v1/membri') && m === 'POST') return new Response(null, { status: 201 });
    return new Response('{}', { status: 404 });
  };
  return calls;
}
const aggiungi = () => persone(new Request('https://app.test/api/persone', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ ristorante_id: RID, action: 'aggiungi', email: 'altro@x.it', password: 'provvisoria1' }) }), env);

test('titolare registrato dall’app: rifiutato', async () => {
  const calls = finto({ id: ALTRO, user_metadata: { pizzeria: 'Da Peppe' } });
  const r = await aggiungi();
  assert.equal(r.status, 409);
  assert.ok(!calls.some(c => c.startsWith('PUT') || c === 'POST /rest/v1/membri'));
});

test('account già usato: collegato senza cambiare la password', async () => {
  const calls = finto({ id: ALTRO, user_metadata: {}, last_sign_in_at: '2026-10-01T10:00:00Z' });
  const r = await aggiungi();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, nuovo: false });
  assert.ok(!calls.some(c => c.startsWith('PUT')));
  assert.ok(calls.includes('POST /rest/v1/membri'));
});

test('account mai usato: riceve la password provvisoria', async () => {
  const calls = finto({ id: ALTRO, user_metadata: {}, last_sign_in_at: null });
  const r = await aggiungi();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, nuovo: true });
  assert.ok(calls.includes('PUT /auth/v1/admin/users/' + ALTRO));
});
