# Spicchio · gestionale per pizzerie

Food cost, scarti, ricette, fornitori e conti. Ogni pizzeria vede solo i propri dati; titolare e dipendenti accedono con email e password da telefono, tablet o PC.

## File del progetto
L'app gira su Cloudflare Workers (vedi `LEGGIMI-CLOUDFLARE.md`). Viene pubblicata solo la cartella `public/`; le funzioni del server stanno in `src/`. `sorgente/`, `supabase/` e questo README restano nel repository ma non sul sito.

- `sorgente/App.dc.html`: il sorgente dell'app. Da qui si genera `public/index.html`.
- `public/`: quello che va pubblicato.
  - `index.html`: l'app completa in un unico file.
  - `sw.js`: apertura senza rete e notifiche del promemoria.
  - `manifest.webmanifest`, `icons/`: installazione sul telefono.
- `src/`: il Worker di Cloudflare.
  - `index.js`: smista le richieste, aggiunge gli header di sicurezza e avvia il promemoria serale.
  - `api/config.js`: passa all'app indirizzo e chiave pubblica di Supabase.
  - `api/claude.js`: lettura AI di bolle, fatture e menù (la chiave resta sul server).
  - `api/persone.js`: il titolare gestisce i dipendenti.
  - `api/promemoria.js`: promemoria a fine servizio.
  - `webpush.js`: invio delle notifiche.
- `wrangler.jsonc`: configurazione del Worker (nome, cartella `public/`, orari del promemoria).
- `test/`: prove automatiche (`npm test`).
- Script SQL per Supabase, in `supabase/`:
  - `supabase/supabase-sicurezza.sql`: tabelle di base, pizzerie, membri, regole di accesso, spazio file.
  - `supabase/supabase-multidispositivo.sql`: scarti, storico prezzi, incassi, causali (una riga per record).
  - `supabase/supabase-blocco2.sql`: letture AI, limite giornaliero e rimborso delle letture non riuscite (solo da `/api/claude`).
  - `supabase/supabase-permessi.sql`: lo staff vede solo ciò che serve agli scarti; documenti, fornitori, costi e vendite sono solo del titolare.
  - `supabase/supabase-vendite.sql`: vendite importate dalla cassa (Impostazioni › Vendite dalla cassa).
  - `supabase/supabase-pizzeria.sql`: logo della pizzeria (spazio file pubblico `loghi`) e cambio di nome e logo da parte del titolare.
  - `supabase/supabase-nuova-pizzeria.sql`: crea una pizzeria, con il suo logo, e collega il titolare.
  - `supabase/supabase-registrazione.sql`: la pizzeria di chi si registra dall'app nasce al primo accesso.
  - `supabase/supabase-dipendenti.sql`: aggiunge o rimuove un dipendente, indicando la pizzeria con il suo id.
- `sorgente/support.js`, `sorgente/_ds/`, `sorgente/image-slot.js`: necessari per aprire `App.dc.html` nell'editor.
- `sorgente/icons/`, `sorgente/manifest.webmanifest`: copie usate dall'editor.

Dove i dati restano: tutto sta su Supabase. Sul dispositivo restano la sessione di accesso, gli scarti e i documenti registrati senza rete (in attesa di invio) e una copia dei dati della pizzeria, senza foto, per aprire l'app quando manca la rete. All'uscita ("Esci") la copia e le code vengono cancellate.

> **Non creare mai regole RLS con `using (true)` o `with check (true)`.** Aprirebbero i dati di tutte le pizzerie a chiunque abbia un account. L'ultima query di `supabase/supabase-sicurezza.sql` deve sempre restituire 0 righe.

## Installazione da zero
1. **Supabase**: crea un progetto.
   - In Authentication › Sign In / Providers lascia attivi **Allow new users to sign up** e **Confirm email**: i titolari si registrano dall'app (vedi "Registrazione dall'app"). Se preferisci creare tu tutti gli account, disattiva "Allow new users to sign up".
   - In Authentication › URL Configuration imposta come Site URL e Redirect URL l'indirizzo dell'app (serve per "Password dimenticata?" e per il link di conferma della registrazione).
2. Crea il tuo utente in Authentication › Users › Add user, spuntando "Auto Confirm User".
3. In SQL Editor esegui in questo ordine:
   1. `supabase/supabase-sicurezza.sql`, dopo aver scritto la tua email alla riga `v_email` e il nome della prima pizzeria alla riga `v_nome`;
   2. `supabase/supabase-multidispositivo.sql`;
   3. `supabase/supabase-blocco2.sql`;
   4. `supabase/supabase-permessi.sql`;
   5. `supabase/supabase-vendite.sql`;
   6. `supabase/supabase-persone.sql`;
   7. `supabase/supabase-promemoria.sql`;
   8. `supabase/supabase-pizzeria.sql`;
   9. `supabase/supabase-registrazione.sql`;
   10. `supabase/supabase-nuova-pizzeria.sql`, solo per le pizzerie che crei tu a mano.

4. **Cloudflare**: collega questo repository a Cloudflare Workers e imposta le variabili indicate in `LEGGIMI-CLOUDFLARE.md`.

## Registrazione dall'app
Nella pagina di accesso c'è **Nuova pizzeria? Crea un account**. Il titolare scrive nome della pizzeria, email e password e accetta l'informativa privacy. Supabase gli manda un'email di conferma; il link riapre l'app, che chiede di accedere. Al primo accesso l'app chiama `crea_mia_pizzeria()` (`supabase/supabase-registrazione.sql`): nasce la pizzeria, con le causali scarto predefinite, e l'account ne diventa titolare. Da lì parte la guida "Prepara la tua pizzeria".

- Un account crea una sola pizzeria. Se il nome esiste già, alla nuova si aggiunge un numero, per esempio "Da Peppe (2)".
- Senza conferma dell'email la pizzeria non nasce.
- Le pizzerie nate così hanno `origine = 'registrazione'` nella tabella `ristoranti`. L'ultima query dello script le elenca con il titolare.
- In **Impostazioni › Persone** un titolare non può aggiungere come dipendente l'email di chi si è registrato come titolare. A un account già usato non cambia la password: la persona entra con la sua.
- Per le email di conferma, oltre poche al giorno, Supabase chiede un servizio di invio tuo (Authentication › Emails › SMTP Settings). Il testo dell'email si cambia in Authentication › Emails › Templates › Confirm signup.

## Nuovo cliente creato a mano
1. Authentication › Users › Add user: email del titolare, password provvisoria (almeno 10 caratteri), "Auto Confirm User".
2. Logo (facoltativo): Storage › loghi › Upload file, poi sul file Get URL e copia il link.
3. In `supabase/supabase-nuova-pizzeria.sql` compila `v_nome_pizzeria`, `v_email_titolare` e, se c'è, `v_logo_url`, ed esegui.
4. Manda al titolare indirizzo dell'app, email e password provvisoria. Può cambiarla da "Password dimenticata?".

## Dipendenti
Li gestisce il titolare dall'app, in **Impostazioni › Persone**: aggiunge un dipendente con email e password provvisoria, gli cambia la password o lo toglie (l'accesso ai dati si chiude subito; se non lavora in altre pizzerie il suo account viene eliminato). Serve la variabile `SUPABASE_SERVICE_ROLE_KEY` su Cloudflare (vedi `LEGGIMI-CLOUDFLARE.md`) e lo script `supabase-persone.sql`.

In alternativa, a mano: crea l'utente in Authentication › Users, poi usa `supabase/supabase-dipendenti.sql` (prima la query "Elenco" per copiare l'id della pizzeria, poi `v_azione` = `'aggiungi'` o `'rimuovi'`).

Lo staff vede e usa solo la sezione **Scarti**: registra gli scarti ed elimina i propri delle ultime 48 ore. Non vede Dashboard, Menù, Conti e Acquisti, non carica bolle o fatture e non vede spese, fatture da pagare, fornitori o vendite. Il database glielo impedisce anche fuori dall’app.

## Aggiornamento di ottobre 2026 (database già installato)
In SQL Editor esegui, una volta, `supabase/supabase-blocco2.sql`, `supabase/supabase-permessi.sql` e `supabase/supabase-vendite.sql`. Si possono rieseguire senza danni. L'app pubblicata funziona anche prima dell'aggiornamento, ma finché non li esegui restano aperti i problemi che correggono.

Per Impostazioni › Persone: esegui anche `supabase/supabase-persone.sql` e aggiungi su Cloudflare la variabile `SUPABASE_SERVICE_ROLE_KEY`.

**Aggiornamento del 16 ottobre (staff solo scarti):** riesegui `supabase/supabase-permessi.sql`, `supabase/supabase-vendite.sql` e `supabase/supabase-blocco2.sql`.

**Nome e logo della pizzeria:** esegui `supabase/supabase-pizzeria.sql`.

**Promemoria a fine servizio:** esegui `supabase/supabase-promemoria.sql` e aggiungi su Cloudflare le tre variabili del promemoria.

## Ordini ai fornitori
In **Acquisti › Ordini** il titolare prepara gli ordini (lo staff non li vede). Scelto il fornitore, l'app propone gli ingredienti che compra da lui (dallo storico prezzi delle bolle e dagli ordini precedenti) con l'ultima quantità ordinata; si scrivono le quantità in kg, pezzi o confezioni, si aggiungono altri ingredienti o prodotti liberi, la consegna desiderata e una nota. «Come l'ultima volta» ricompila l'ordine precedente.

Invio: **Invia su WhatsApp** apre la chat del fornitore (numero di telefono della scheda fornitore, prefisso +39 se manca) con il messaggio già scritto; **Ho ordinato per telefono** lo segna inviato (con il pulsante per chiamare); **Copia il testo** per altri canali. Stati: bozza → inviato → arrivato. Gli ordini si salvano nei dati della pizzeria (chiave `orders`, ultimi 300).

**Controllo merce.** Quando il titolare conferma una bolla (o una fattura senza bolle), l'app la collega all'ultimo ordine «inviato» allo stesso fornitore, lo segna «arrivato» e confronta le righe: non arrivato, meno o più del previsto (quantità riportate a kg quando la bolla ha kg, g, l o il peso della confezione), prezzo al kg diverso di almeno il 2% da quello del listino al momento dell'ordine, prodotti arrivati ma non ordinati. Il risultato è nel messaggio dopo la conferma e in Ordini (pulsante «Controllo merce»). Una bolla si può anche collegare o scollegare a mano dall'ordine.

**Quantità suggerite.** Nell'ordine si sceglie per quanti giorni si ordina (di base l'intervallo tra gli ultimi due ordini a quel fornitore, altrimenti 7). Per ogni ingrediente l'app mostra il consumo di quei giorni: ricette × piatti venduti negli ultimi 28 giorni (vendite della cassa dove ci sono, altrimenti la stima settimanale), con la resa di pulizia; per le righe a pezzi o confezioni lo converte con il peso della confezione dell'ultima bolla. «Usa le quantità suggerite» compila le righe vuote. È il fabbisogno del periodo: la merce già in magazzino va tolta a mano.

## Piatti del menù: pizze, fritti, antipasti e dolci
Ogni voce del menù ha un tipo: **Pizza**, **Fritto**, **Antipasto** o **Dolce**. Pizze, fritti e antipasti hanno la distinta base (ingredienti e grammi). Un dolce può essere:
- **fatto in casa**: distinta base come gli altri piatti; i suoi ingredienti entrano nel food cost e nella merce sparita;
- **acquistato**: costo al pezzo. Collegato a un articolo di Acquisti (categoria Dolci) il prezzo si aggiorna da solo con le bolle della pasticceria, e i conti di un periodo passato usano il prezzo di allora; oppure si scrive a mano.

Nei Conti i dolci sono incasso del menù con il loro costo vero; le "altre vendite" sono bevande e coperto.

## Carica menu
Nel **Menù** il titolare preme **Carica menu** e sceglie il PDF o la foto del menù. La lettura automatica (`/api/claude` con tipo `Menu`, una lettura del limite giornaliero) ricava piatti, categoria, prezzo e ingredienti, con le grammature stimate per un piatto. Prima di importare si vede l'elenco e si toglie la spunta ai piatti da lasciare fuori; bevande e coperto vengono saltati (restano nelle altre vendite). I dolci arrivano come "fatti in casa" con le dosi stimate: se li compri, aprili e scegli **Acquistato**.

All'importazione:
- i piatti nuovi entrano con la ricetta stimata (per le pizze l'impasto della pizzeria più gli ingredienti del menù), segnata "Grammature stimate · da verificare";
- i piatti già presenti cambiano solo il prezzo (la ricetta solo se era vuota);
- gli ingredienti che non ci sono nel listino entrano senza prezzo: il prezzo arriva con la prima bolla o fattura, o si scrive a mano.

Se nel menù ci sono già piatti, prima di scegliere il file bisogna scrivere «aggiungi nuovo menu». Prima di ogni caricamento il menù attuale viene copiato nell'**Archivio menu** (dati, chiave `menuArch`, solo titolare; ultime 12 versioni): lì si vedono i piatti di ogni versione e si può ripristinarne una scrivendo «ripristina menu». Anche il ripristino salva prima una copia del menù che sostituisce.

## Vendite dalla cassa (Tilby)
In **Impostazioni › Vendite dalla cassa** il titolare sceglie insieme i due file esportati da Tilby:
- **scontrini** (una riga per vendita, con `final_amount` e `closed_at`): danno l'incasso di ogni giorno. Annulli e resi si compensano da soli, le righe doppie (stesso `uuid`) contano una volta, le vendite dopo mezzanotte vanno sul giorno prima (come gli scarti);
- **righe di vendita** (i prodotti di ogni scontrino): danno i piatti venduti. La data viene dallo scontrino (`sale_id`); i prodotti delle vendite annullate per intero non contano.

L'app li riconosce da sola, senza scegliere colonne. I nomi dei prodotti vengono abbinati ai piatti del menù; un nome mai visto viene chiesto una volta sola e poi ricordato. Gli incassi finiscono nella tabella `vendite` come righe `__incasso` (un valore al giorno, con IVA): Conti, Dashboard e riepilogo del mese li usano al posto dell'incasso scritto a mano, togliendo l'IVA del menù e stimando in proporzione i giorni non ancora importati. Il file di un'altra cassa funziona ancora scegliendo le colonne data, prodotto e quantità.

Le righe con un prodotto che inizia con **"Rifacimento"** (es. "Rifacimento – Bufala e Latte") non sono vendite: diventano scarti del piatto intero con causale "Rifacimento". Il piatto si abbina come le vendite (un nome nuovo si chiede una volta); reimportare lo stesso file non li raddoppia.

## Merce sparita (Scarti)
A fine serata non si pesa niente: si registrano a mano solo gli imprevisti (pizza bruciata, reso, merce caduta). La merce che manca la misura l'app per ogni ingrediente **fresco** (di base Caseificio, Ortofrutta, Ittico, Salumeria; si cambia nella scheda ingrediente):

non spiegato = acquistato (bolle e fatture, senza doppioni) − consumo da ricetta (piatti venduti × grammi) − scarti registrati.

Il periodo sono i 28 giorni che finiscono il giorno prima dell'ultima consegna, quando il frigo è quasi vuoto; servono le vendite della cassa per tutti i giorni di apertura. L'incertezza è metà di una consegna media. Allarme se, tolta l'incertezza, mancano più del 5% del consumo e più di 20 €: l'ingrediente compare anche in "Da fare" della Dashboard.

Sulla riga in allarme: **Conta il frigo** (due conteggi ad almeno 7 giorni tolgono l'incertezza) e **Avvia 7 giorni di diagnosi** (serve il peso della vaschetta). Durante la diagnosi, ogni sera di apertura dalle 21:30, titolare (in Dashboard) e staff (in Scarti) rispondono "Quante vaschette buttate stasera?": la risposta è uno scarto "Avanzo a fine serata". Dopo 7 giorni o 5 risposte l'app confronta gli avanzi con il resto non spiegato e dice cosa fare. Non servono tabelle nuove: la risposta dello staff è uno scarto, che lo staff può già registrare.

## Promemoria a fine servizio
Ogni persona (titolare o staff) può attivarlo dal profilo, su ogni telefono che deve ricevere l'avviso. Ogni sera, se la pizzeria non ha ancora segnato nessuno scarto, arriva una notifica. Su iPhone funziona solo con l'app aggiunta alla schermata Home (iOS 16.4 o successivo). All'uscita dall'account il dispositivo smette di riceverlo.

Servono lo script `supabase/supabase-promemoria.sql` e, su Cloudflare, le variabili `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (vedi `LEGGIMI-CLOUDFLARE.md`).

## Modificare l'app
Apri `sorgente/App.dc.html` nell'editor, fai le modifiche e rigenera `public/index.html`.
Dopo la rigenerazione, nell'`<head>` di `public/index.html` vanno rimesse le righe di installazione (lingua, `theme-color`, descrizione, icone, manifest e la riga `<script>` che registra `sw.js`): sono le prime righe dell'head dell'ultima versione pubblicata.

Il nome del prodotto è **Spicchio**, con uno spicchio di pizza come logo: compare nella pagina di accesso, nel titolo, nel manifest, nelle icone e nel riepilogo del mese. Dopo l'accesso, in alto ci sono invece nome e logo della pizzeria.

## Nome e logo della pizzeria
Dopo l'accesso, in alto compaiono il nome e il logo della pizzeria (senza logo, la sua iniziale). Li imposti tu alla creazione (`supabase-nuova-pizzeria.sql`) o dopo, con il blocco in fondo a `supabase-pizzeria.sql`; il titolare può cambiarli da **Impostazioni › Pizzeria**. I loghi stanno nello spazio file pubblico `loghi` di Supabase: chi ha il link li vede, come un'insegna. Il titolare carica solo nella cartella della sua pizzeria; lo staff non li cambia. La demo mostra la pizzeria d'esempio **Gli Artigiani**.

## Informativa privacy
Si apre dalla pagina di accesso ("Privacy e uso dei dati") e dal profilo. Prima di usarla con i clienti:
- sostituisci `[RAGIONE SOCIALE]` (chi gestisce l'app) e `[EMAIL ASSISTENZA]` (l'indirizzo per le richieste privacy) in `sorgente/App.dc.html` e `public/index.html`;
- falla controllare da un consulente privacy, insieme al contratto con le pizzerie (art. 28 GDPR) e alla verifica dei fornitori (Supabase, Cloudflare, Anthropic) e della regione del database.

## Profilo
- **Cambia password**: chiede la password attuale, poi la nuova due volte.
- **Cambia pizzeria**: compare solo a chi fa parte di più pizzerie. Si può cambiare solo quando non ci sono scarti o documenti in attesa di invio; l'ultima scelta resta ricordata sul dispositivo.
