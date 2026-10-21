// Controlla che le notifiche cifrate da src/webpush.js si decifrino come farebbe il browser
// (libreria di riferimento http_ece) e che la firma VAPID sia valida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { encrypt, sendPush, b64uDecode, b64uEncode } from '../src/webpush.js';

test('il dispositivo decifra il messaggio', async () => {
  const device = createECDH('prime256v1'); device.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ title: 'Scarti di stasera', body: 'C’è qualcosa da segnare?', url: '/' });
  const body = await encrypt(msg, b64uEncode(device.getPublicKey()), b64uEncode(auth));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: device, authSecret: b64uEncode(auth) });
  assert.equal(plain.toString('utf8'), msg);
});

test('intestazioni e firma VAPID', async () => {
  const server = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64uEncode(await crypto.subtle.exportKey('raw', server.publicKey));
  const priv = (await crypto.subtle.exportKey('jwk', server.privateKey)).d;
  const device = createECDH('prime256v1'); device.generateKeys();
  let seen;
  globalThis.fetch = async (url, opt) => { seen = { url, opt }; return new Response(null, { status: 201 }); };
  const res = await sendPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64uEncode(device.getPublicKey()), auth: b64uEncode(randomBytes(16)) }, 'ciao', { publicKey: pub, privateKey: priv, subject: 'mailto:a@b.it' });
  assert.equal(res.status, 201);
  assert.equal(seen.opt.headers['Content-Encoding'], 'aes128gcm');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(seen.opt.headers.Authorization);
  assert.ok(m);
  assert.equal(m[4], pub);
  const claims = JSON.parse(new TextDecoder().decode(b64uDecode(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:a@b.it');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, server.publicKey, b64uDecode(m[3]), new TextEncoder().encode(m[1] + '.' + m[2]));
  assert.ok(ok);
});
