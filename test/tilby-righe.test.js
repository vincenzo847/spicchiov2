// Import del file Tilby "Righe di vendita" (Excel o CSV), con dati inventati.
// I test sull'export vero di una pizzeria stanno fuori dal repository (dati privati).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const src = fs.readFileSync(new URL('../sorgente/App.dc.html', import.meta.url), 'utf8');
const C = new Function('DCLogic', src.slice(src.indexOf('class Component extends DCLogic'), src.lastIndexOf('</script>')) + '\nreturn Component;')(class {
  constructor() { this.state = {}; }
  setState(u) { this.state = { ...this.state, ...(typeof u === 'function' ? u(this.state) : u) }; }
});

const HEAD = ['Data', 'Vendita', 'Nome', 'Categoria', 'Reparto', '% IVA', 'Prezzo', 'Pagamento', 'Cliente', 'Nome venditore', 'Seriale', 'Documento', 'Quantità', 'Ricavi', 'Note di riga', 'Nome Sala', 'Nome Tavolo', 'Coperti', 'Tipo ordine'];
const riga = (data, vendita, nome, cat, iva, q, ricavi, o = {}) => [data, vendita, nome, cat, '', String(iva), '', 'POS', o.cliente || 'Mario Bianchi', o.venditore || 'Anna', 'X1', o.doc || 'commercial_doc', String(q), String(ricavi), o.nota || '', o.sala ?? 'Sala', o.tavolo ?? '4', '', o.tipo || 'normal'];
const RIGHE = [
  HEAD,
  riga('01/09/2026 20:10', 'V1', 'Margherita', 'Pizza', 10, 2, 16.5),
  riga('01/09/2026 20:10', 'V1', 'Città d’Oro', 'Pizza', 10, 1, 11, { nota: 'senza basilico' }),
  riga('01/09/2026 20:10', 'V1', 'Coca Cola', 'Bibite', 22, 2, 6.1),
  riga('01/09/2026 20:10', 'V1', 'Coperto', 'COPERTO', 10, 3, 6),
  riga('01/09/2026 21:00', 'V2', 'MARGHERITA', 'Pizza', 10, 1, 8.25, { sala: '', tavolo: '' }),
  riga('02/09/2026 00:40', 'V3', 'Citta  d\'oro', 'Pizza', 10, 1.5, 16.5, { tipo: 'take_away' }),
  riga('02/09/2026 20:00', 'V4', 'Margherita', 'Pizza', 10, -1, -8.25, { doc: 'void_doc' }),
  riga('02/09/2026 20:05', 'V5', 'Tiramisù', 'Dolci', 10, 1, 5.5, { doc: 'e_invoice' })
];

// .xlsx minimo fatto a mano: stringhe condivise, una compressa (deflate) e una no
function xlsx(rows) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
  const sst = [], at = s => { let i = sst.indexOf(s); if (i < 0) { sst.push(s); i = sst.length - 1; } return i; };
  const col = i => String.fromCharCode(65 + i);
  const sheet = '<?xml version="1.0"?><worksheet><sheetData>' + rows.map((r, y) => '<row r="' + (y + 1) + '">' + r.map((v, x) => v === '' ? '' : /^-?\d+(\.\d+)?$/.test(v) ? '<c r="' + col(x) + (y + 1) + '"><v>' + v + '</v></c>' : '<c r="' + col(x) + (y + 1) + '" t="s"><v>' + at(v) + '</v></c>').join('') + '</row>').join('') + '</sheetData></worksheet>';
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Righe" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/foglio.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst>' + sst.map(s => '<si><t>' + esc(s) + '</t></si>').join('') + '</sst>',
    'xl/worksheets/foglio.xml': sheet
  };
  const parts = [], cen = []; let off = 0;
  Object.entries(files).forEach(([name, txt], k) => {
    const raw = Buffer.from(txt), deflate = k !== 0, data = deflate ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, data); cen.push(c, nm); off += 30 + nm.length + data.length;
  });
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(4, 8); e.writeUInt16LE(4, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

test('il lettore .xlsx dà le stesse righe del file', async () => {
  // xlsx mette i numeri come numeri: "16.5" torna "16.5"
  const rows = await C.readXlsx(xlsx(RIGHE));
  assert.deepEqual(rows[0], HEAD);
  assert.equal(rows.length, RIGHE.length);
  assert.equal(rows[2][2], 'Città d’Oro');
  assert.equal(rows[6][13], '16.5');
});

test('nomi: maiuscole, accenti, apostrofi tipografici e spazi doppi non contano', () => {
  assert.equal(C.tilbyKey('Città d’Oro'), C.tilbyKey('Citta  d\'oro'));
  assert.equal(C.tilbyKey("LUCA'S PIZZA"), C.tilbyKey('Luca’s pizza'));
  assert.notEqual(C.tilbyKey('Margherita'), C.tilbyKey('Marinara'));
});

test('righe: niente Cliente né Nome venditore, netto con l’IVA della riga, banco, annulli', () => {
  assert.equal(C.isTilbyRighe(HEAD), true);
  assert.equal(C.isTilbyRighe(['data', 'prodotto', 'quantità']), false);
  const { righe, bad } = C.tilbyRighe(RIGHE, 0);
  assert.equal(bad.length, 0);
  assert.equal(JSON.stringify(righe).includes('Mario Bianchi'), false);
  assert.equal(JSON.stringify(righe).includes('Anna'), false);
  const R = C.tilbyRiepilogo(righe);
  assert.equal(R.lordo, 61.6);
  assert.equal(R.netto, Math.round((16.5 / 1.1 + 11 / 1.1 + 6.1 / 1.22 + 6 / 1.1 + 8.25 / 1.1 + 16.5 / 1.1 - 8.25 / 1.1 + 5.5 / 1.1) * 100) / 100);
  assert.equal(R.annulli, -8.25);
  assert.equal(R.coperti, 3);
  assert.deepEqual(R.banco, { righe: 2, lordo: 24.75 });
  assert.equal(R.giorni, 2);
  assert.equal(Object.keys(R.piatti).length, 3);
  assert.equal(R.piatti[C.tilbyKey('Margherita')].qty, 2);
  assert.equal(R.piatti[C.tilbyKey('Città d’Oro')].qty, 2.5);
});

test('dopo mezzanotte conta la sera prima (fine giornata alle 5)', () => {
  const { righe } = C.tilbyRighe(RIGHE, 5);
  assert.equal(righe[5].d, '2026-09-01');
  assert.equal(C.tilbyRiepilogo(righe).giorni, 2);
});

test('nell’app: categorie, piatti abbinati, incasso lordo e netto, coperti, riepilogo', async () => {
  const app = new C();
  app.state = { demo: true, role: 'owner', pizzas: [{ id: 'p1', name: 'Margherita' }, { id: 'p2', name: 'Città d’oro' }, { id: 'p3', name: 'Tiramisù' }], sales: [], waste: [], salesMap: {} };
  const file = { name: 'Righe di vendita.xlsx', arrayBuffer: async () => xlsx(RIGHE), text: async () => { throw new Error('non è testo'); } };
  await app.salesFile([file]);
  // Dolci non è nelle categorie note: la prima volta si chiede
  assert.equal(app.state.salesDlg.step, 'cats');
  assert.deepEqual(app.state.salesDlg.catSel, { pizza: 'p', bibite: 'a', coperto: 'a', dolci: 'p' });
  app.salesRigheAvanti();
  const D = app.state.salesDlg;
  assert.equal(D.step, 'done');
  const S = app.state.sales, q = (d, p) => (S.find(r => r.data === d && r.pizza_id === p) || {}).quantita;
  assert.equal(q('2026-09-01', 'p1'), 3);
  assert.equal(q('2026-09-01', 'p2'), 2.5);
  assert.equal(q('2026-09-02', 'p1'), 0);
  assert.equal(q('2026-09-02', 'p3'), 1);
  assert.equal(q('2026-09-01', '__incasso'), 64.35);
  assert.equal(q('2026-09-01', '__netto'), Math.round((16.5 / 1.1 + 11 / 1.1 + 6.1 / 1.22 + 6 / 1.1 + 8.25 / 1.1 + 16.5 / 1.1) * 100) / 100);
  assert.equal(q('2026-09-01', '__coperti'), 3);
  assert.equal(S.filter(r => r.pizza_id === '__giorno').length, 2);
  assert.deepEqual(app.state.salesCats, { pizza: 'p', bibite: 'a', coperto: 'a', dolci: 'p' });
  const L = Object.fromEntries(D.done.map(r => [r.l, r.v]));
  assert.equal(L['Coperti'], '3');
  assert.match(L['Al banco o da asporto'], /^2 righe · 24,75 €$/);
  assert.match(L['Note di riga'], /^1 /);
  // la seconda volta le categorie non si chiedono più
  app.setState({ salesDlg: { step: 'pick' } });
  await app.salesFile([file]);
  assert.equal(app.state.salesDlg.step, 'done');
});

test('un nome nuovo propone il piatto più simile', () => {
  const app = new C();
  app.state = { pizzas: [{ id: 'p1', name: 'Rude e felice' }, { id: 'p2', name: 'Marinara' }], salesMap: {} };
  const plan = app.salesPlan({ parsed: [{ d: '2026-09-01', name: 'Rude felice', q: 1 }], simile: true, map: {} });
  assert.equal(plan.map[C.norm('Rude felice')], 'p1');
  assert.deepEqual(plan.fresh, ['Rude felice']);
});
