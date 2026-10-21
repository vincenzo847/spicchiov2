// /api/claude: legge un DDT, una fattura o il menù della pizzeria con Anthropic.
// Variabili d'ambiente: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY;
// facoltative ANTHROPIC_MODEL e ANTHROPIC_MODEL_FALLBACK per cambiare modello senza toccare il codice.
// Il client invia solo i file e il tipo di documento: modello, istruzioni e limiti sono decisi qui.
import { json, fail, readJson } from '../util.js';

const models = env => [...new Set([
  (env.ANTHROPIC_MODEL || '').trim() || 'claude-sonnet-4-5',
  (env.ANTHROPIC_MODEL_FALLBACK || '').trim() || 'claude-haiku-4-5'
])];
const MAX_TOKENS = 8000;
const MAX_TOKENS_MENU = 14000;
const SYSTEM_MENU = 'Leggi il menù di una pizzeria e ricava le ricette dei piatti. Rispondi sempre e solo con un oggetto JSON valido, senza altro testo.';

// menù: piatti con categoria, prezzo e ingredienti, con grammature stimate da far verificare al pizzaiolo
function promptMenu(nome, ings) {
  const cats = [...new Set(ings.map(i => i.sup).filter(Boolean))];
  const list = ings.map(i => i.id + ' = ' + i.name).join('\n') || '(nessuno)';
  return 'Questo è il menù della pizzeria "' + nome + '". Estrai TUTTI i piatti e rispondi SOLO con un oggetto JSON:\n' +
    '{"piatti":[{"nome":"nome del piatto come sul menù","categoria":"titolo della sezione del menù (es. Classiche, Speciali, Fritti)","tipo":"pizza, fritto, antipasto, dolce o altro","prezzo":prezzo in euro o null,"ingredienti":[["nome ingrediente","id del listino o null",grammi,"categoria del listino"]]}]}\n' +
    'Ogni ingrediente è un elenco di 4 valori nell’ordine indicato, senza nomi dei campi, per tenere la risposta corta.\n' +
    'Per "tipo": "pizza" per pizze, calzoni, padellini, pinse e focacce farcite; "fritto" per fritti (supplì, crocchè, arancini, frittatine, montanare, patatine); "antipasto" per antipasti, taglieri, insalate e bruschette; "dolce" per dolci e dessert (tiramisù, cannoli, babà, torte, gelati); "altro" per bevande, birre, vini, caffè, coperto e servizio (per "altro" lascia "ingredienti" vuoto).\n' +
    'Per "ingredienti": usa gli ingredienti scritti nella descrizione del piatto, uno per voce. Se una pizza classica non ha descrizione usa la ricetta tradizionale (es. Margherita: pomodoro, fior di latte, basilico, olio). NON mettere farina, lievito, acqua e sale dell’impasto: l’impasto si aggiunge a parte.\n' +
    'Per "grammi": stima la dose tipica per UN piatto (pizza da circa 30-33 cm o porzione di fritto/antipasto/dolce). Per i dolci metti gli ingredienti della ricetta tradizionale per UNA porzione, come se fosse fatto in casa (es. tiramisù: mascarpone 60-80, uova 30-40, savoiardi 30-40, zucchero 15-25, caffè 20-30, cacao 2-3). Riferimenti: pomodoro 70-90, fior di latte o mozzarella 90-120, bufala 100-120, provola 80-100, salumi 40-70, verdure 50-80, pesce 60-90, formaggi stagionati grattugiati 8-15, creme e salse 15-30, rucola 10-15, basilico e erbe 2-5, olio 5-8, spezie 1-2. Numeri interi.\n' +
    'Per l’id del listino scegli da questo elenco, solo se è chiaramente lo stesso ingrediente:\n' + list + '\n' +
    'Per la categoria dell’ingrediente scegli una di queste: ' + (cats.length ? cats : ['Caseificio', 'Salumeria', 'Ittico', 'Ortofrutta', 'Dispensa', 'Molino']).join(', ') + '.\n' +
    'Il prezzo usa il punto come separatore decimale. Se un piatto ha più formati (es. normale e maxi) usa il prezzo del formato normale.';
}
// limite tenuto uguale a quello dell'app, che riduce foto e PDF sotto i 3 MB (il base64 pesa 4/3 del file)
const MAX_BYTES = 3.2 * 1024 * 1024;
const MAX_PARTS = 12;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const ART_CATS = ['Bevande', 'Pulizia', 'Monouso e imballi', 'Altro'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEM = 'Leggi documenti di fornitori (DDT e fatture) per una pizzeria. Rispondi sempre e solo con un oggetto JSON valido, senza altro testo.';

function prompt(nome, ings, arts, docType) {
  const cats = [...new Set(ings.map(i => i.sup).filter(Boolean))];
  const list = ings.map(i => i.id + ' = ' + i.name).join('\n') || '(nessuno)';
  const alist = arts.map(a => a.id + ' = ' + a.name).join('\n') || '(nessuno)';
  return 'Questo è un documento di un fornitore della pizzeria "' + nome + '": ' + (docType === 'DDT' ? 'un documento di trasporto (DDT)' : docType === 'Fattura' ? 'una fattura' : 'un documento di trasporto (DDT) oppure una fattura') + '. La pizzeria è il cliente/destinatario/cessionario: NON è mai il fornitore. Il fornitore è chi emette il documento (mittente, cedente/prestatore). Estrai i dati e rispondi SOLO con un oggetto JSON:\n' +
    '{"type":"DDT o Fattura","number":"numero del documento","date":"YYYY-MM-DD","due":"YYYY-MM-DD scadenza del pagamento se è una fattura, altrimenti null","supplier":"ragione sociale del mittente","supplierVat":"partita IVA del mittente, solo cifre, o null","total":totale del documento in euro (per le fatture il totale da pagare IVA inclusa; per i DDT il totale se indicato, altrimenti null),"ddtRefs":["numeri dei DDT citati nella fattura"],"items":[{"desc":"descrizione prodotto","qty":numero,"unit":"kg|g|l|ml|pz|conf","price":prezzo unitario netto in euro per quella unità,"kgPerUnit":peso in kg di un pz/conf se indicato nella descrizione altrimenti null,"kind":"ingrediente o altro","match":"id ingrediente o articolo, o null","category":"categoria"}]}\n' +
    'Usa il punto come separatore decimale. Se il prezzo unitario manca ma c’è l’importo di riga, dividi per la quantità. Se manca del tutto metti 0. Ignora trasporto, imballi, cauzioni e righe di totale.\n' +
    'Per "kind": "ingrediente" se è cibo usato per preparare pizze e piatti (farine, latticini, salumi, verdure, olio, conserve, uova…); "altro" per tutto il resto: bevande da rivendere (birre, acqua, bibite, vino), detersivi e pulizia, monouso, imballi, attrezzatura.\n' +
    'Per "category": se kind è "ingrediente" scegli una di queste categorie del listino: ' + (cats.length ? cats : ['Caseificio', 'Salumeria', 'Ittico', 'Ortofrutta', 'Dispensa', 'Molino']).join(', ') + '; se kind è "altro" scegli una di queste: ' + ART_CATS.join(', ') + '. Le righe dello stesso documento possono avere categorie diverse.\n' +
    'Per le righe "altro" lascia unit e price come sul documento (prezzo per pz, cartone o confezione).\n' +
    'Per "match" scegli l’id corrispondente da questi elenchi, solo se è chiaramente lo stesso prodotto.\nIngredienti:\n' + list + '\nAltri articoli:\n' + alist;
}

export default async function claude(request, env) {
  if (request.method !== 'POST') return fail(405, 'Metodo non consentito');
  const SB = (env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), ANON = (env.SUPABASE_ANON_KEY || '').trim(), KEY = env.ANTHROPIC_API_KEY, MODELS = models(env);
  if (!SB || !ANON || !KEY) return fail(500, 'Servizio di lettura non configurato');

  // 1. sessione Supabase obbligatoria
  const auth = String(request.headers.get('authorization') || '');
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!tok) return fail(401, 'Accesso richiesto');
  const H = { apikey: ANON, Authorization: 'Bearer ' + tok };
  let u;
  try { u = await fetch(SB + '/auth/v1/user', { headers: H }); } catch (e) { return fail(502, 'Verifica dell’accesso non riuscita'); }
  if (!u.ok) return fail(401, 'Sessione non valida: accedi di nuovo');

  // 2. richiesta: solo file + tipo di documento
  const b = await readJson(request);
  if (!b) return fail(400, 'Richiesta non valida');
  const rid = String(b.ristorante_id || '');
  if (!UUID.test(rid)) return fail(400, 'Pizzeria non indicata');
  const docType = ['DDT', 'Fattura', 'Menu'].includes(b.docType) ? b.docType : 'auto', isMenu = docType === 'Menu';
  const files = Array.isArray(b.files) ? b.files : [];
  if (!files.length || files.length > MAX_PARTS) return fail(400, 'Nessun file da leggere');
  let bytes = 0;
  for (const f of files) {
    if (!f || !TYPES.includes(f.media_type) || typeof f.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(f.data)) return fail(415, 'Tipo di file non ammesso: usa PDF, JPG, PNG o HEIC');
    bytes += Math.floor(f.data.length * 3 / 4);
  }
  if (bytes > MAX_BYTES) return fail(413, 'Documento troppo pesante: massimo 3 MB. Carica meno pagine o una foto');
  if (files.some(f => /heic|heif/.test(f.media_type))) return fail(415, 'Le foto HEIC vanno convertite in JPG prima dell’invio');

  // 3. limite giornaliero per pizzeria
  let q;
  try { q = await fetch(SB + '/rest/v1/rpc/consuma_lettura_ai', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_ristorante: rid }) }); }
  catch (e) { return fail(502, 'Controllo delle letture non riuscito'); }
  if (q.status === 401) return fail(401, 'Sessione non valida: accedi di nuovo');
  if (!q.ok) { const t = await q.text().catch(() => ''); return /non_membro/.test(t) ? fail(403, 'La lettura dei documenti è riservata al titolare della pizzeria') : fail(500, 'Controllo delle letture non riuscito'); }
  const qj = await q.json().catch(() => ({}));
  if (!qj.ok) return fail(429, 'Limite giornaliero di letture raggiunto');
  // id della lettura: lo conosce solo questa funzione e serve per chiuderla o rimborsarla
  const lid = UUID.test(String(qj.lettura || '')) ? qj.lettura : null;
  const rpc = async fn => {
    if (!lid) return;
    try {
      const r = await fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_lettura: lid }) });
      if (!r.ok) console.error(fn, r.status, await r.text().catch(() => ''));
    } catch (e) { console.error(fn, e && e.message); }
  };

  // 4. elenchi per abbinare i prodotti (letti con i permessi dell'utente)
  let ings = [], arts = [], nome = 'la pizzeria';
  try {
    const [rd, rr] = await Promise.all([
      fetch(SB + '/rest/v1/dati?select=chiave,valore&ristorante_id=eq.' + rid + '&chiave=in.(ingredients,articles)', { headers: H }),
      fetch(SB + '/rest/v1/ristoranti?select=nome&id=eq.' + rid, { headers: H })
    ]);
    if (rd.ok) (await rd.json()).forEach(x => { if (x.chiave === 'ingredients' && Array.isArray(x.valore)) ings = x.valore; if (x.chiave === 'articles' && Array.isArray(x.valore)) arts = x.valore; });
    if (rr.ok) { const r0 = (await rr.json())[0]; if (r0 && r0.nome) nome = r0.nome; }
  } catch (e) {}

  const content = files.map(f => f.media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: f.media_type, data: f.data } }
    : { type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
  content.push({ type: 'text', text: isMenu ? promptMenu(nome, ings) : prompt(nome, ings, arts, docType) });

  // 5. Anthropic (modello di riserva se il primo non risponde)
  // il menù genera molto testo: prima il modello più veloce, per stare nei 60 secondi della funzione
  for (const model of isMenu ? [...MODELS].reverse() : MODELS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: isMenu ? MAX_TOKENS_MENU : MAX_TOKENS, system: isMenu ? SYSTEM_MENU : SYSTEM, messages: [{ role: 'user', content }] })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        await rpc('chiudi_lettura_ai');
        if (j.stop_reason === 'max_tokens') return fail(422, isMenu ? 'Menù troppo lungo: caricalo in due parti (per esempio prima le pizze, poi il resto)' : 'Documento troppo lungo: caricalo in due parti (una foto per pagina)');
        return json(200, { text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('') });
      }
      console.error('Anthropic', model, r.status, (j.error && j.error.message) || '');
      if (r.status === 400 || r.status === 401 || r.status === 403) break;
    } catch (e) { console.error('Anthropic', model, e && e.message); }
  }
  // nessun modello ha risposto: la lettura non va contata
  await rpc('rimborsa_lettura_ai');
  return fail(502, 'Lettura non riuscita: riprova tra poco');
}
