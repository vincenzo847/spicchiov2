# Pubblicare su Cloudflare

Spicchio gira su un solo **Worker** di Cloudflare, chiamato `spicchio` (vedi `wrangler.jsonc`). Il Worker:
- serve l'app, cioè i file della cartella `public/`;
- risponde alle funzioni `/api/config`, `/api/claude`, `/api/persone` e `/api/promemoria` (codice in `src/`);
- ogni sera avvia il promemoria a fine servizio con i Cron Trigger.

`sorgente/`, `supabase/`, `test/` e i file `.md` restano nel repository ma non vengono pubblicati.

## Primo collegamento
1. Su dash.cloudflare.com apri **Workers & Pages › Create › Import a repository** e scegli questo repository GitHub.
2. Lascia vuoto il comando di build. Come comando di pubblicazione usa `npx wrangler deploy` (di solito è già proposto).
3. Da quel momento ogni push sul ramo `main` ripubblica l'app da sola.
4. Dominio: in **Settings › Domains & Routes** aggiungi il tuo dominio (per esempio `app.spicchio.it`). Senza dominio l'app risponde su `spicchio.<account>.workers.dev`.

Dal computer, in alternativa: `npm install`, poi `npx wrangler login` e `npm run deploy`.

## Variabili d'ambiente
In **Workers & Pages › spicchio › Settings › Variables and Secrets** aggiungi le variabili qui sotto. Quelle segnate *segreta* vanno create con il tipo **Secret**: dopo il salvataggio non si leggono più.

- `SUPABASE_URL`: Supabase › Project Settings › API › Project URL, per esempio `https://xxxx.supabase.co`. Da qui il Worker ricava anche le regole di sicurezza del browser (CSP): cambiando progetto Supabase basta cambiare questa variabile.
- `SUPABASE_ANON_KEY`: la chiave pubblica (anon / publishable) della stessa pagina. Non usare mai la chiave `service_role`.
- `SITE_URL`: l'indirizzo del sito di presentazione, dove torna chi esce dall'app.
- `ANTHROPIC_API_KEY` (*segreta*): la chiave di console.anthropic.com (inizia con `sk-ant-`). Serve per leggere bolle, fatture e menù.
- `SUPABASE_SERVICE_ROLE_KEY` (*segreta*): Supabase › Project Settings › API › chiave `service_role` (o "secret"). Serve a `/api/persone` e al promemoria. È la chiave che apre tutto il database: va solo qui, mai nell'app, nel repository o in un messaggio.
- `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (*segreta* la privata): la coppia di chiavi delle notifiche del promemoria. Se le avevi già su Vercel, riusa le stesse: i telefoni già iscritti continuano a ricevere le notifiche. Per crearne di nuove: `npx web-push generate-vapid-keys`.
- `VAPID_SUBJECT` (facoltativa): `mailto:` seguito dall'email di assistenza, per esempio `mailto:assistenza@tuodominio.it`.
- `CRON_SECRET` (*segreta*, facoltativa): una parola lunga e casuale. Serve solo per avviare il promemoria a mano (vedi sotto). Il promemoria serale parte comunque da solo.
- `ANTHROPIC_MODEL` e `ANTHROPIC_MODEL_FALLBACK` (facoltative): il modello AI principale e quello di riserva, per esempio `claude-sonnet-5-5` e `claude-haiku-5-5`. Se mancano si usano `claude-sonnet-4-5` e `claude-haiku-4-5`. Prima di cambiarli conviene provarli su qualche bolla vera.

Le variabili salvate nella dashboard restano anche dopo ogni nuova pubblicazione (`keep_vars` in `wrangler.jsonc`).

## Come funziona
- L'app chiede a `/api/config` indirizzo e chiave pubblica di Supabase. Se `/api/config` non risponde, la pagina di accesso mostra "Servizio non raggiungibile: riprova tra poco".
- `/api/claude` accetta solo il titolare della pizzeria (lo staff non carica documenti), con un massimo di 100 letture al giorno per pizzeria. Le letture non riuscite non vengono contate. Ogni richiesta può pesare al massimo circa 3 MB: le foto vengono ridotte in automatico e i PDF grandi diventano immagini delle pagine (fino a 12).
- `/api/persone` accetta solo il titolare della pizzeria indicata: aggiunge un dipendente (o collega un account che esiste già), gli cambia la password o lo toglie. Non agisce mai sul titolare né su chi non fa parte della pizzeria.
- Promemoria: va alle 22 (ora italiana) dal 15 ottobre al 15 aprile e alle 23 dal 16 aprile al 14 ottobre. Il Cron Trigger parte alle 20 e alle 21 UTC (`triggers` in `wrangler.jsonc`): la funzione invia solo nel giro che cade nell'ora giusta. Per ogni pizzeria con almeno un dispositivo iscritto controlla se oggi c'è uno scarto; se non c'è, manda la notifica "Scarti di stasera". Le pizzerie si controllano a gruppi in parallelo. I dispositivi che non esistono più vengono tolti dall'elenco. Le notifiche si firmano e si cifrano in `src/webpush.js`, senza librerie esterne.
- `sw.js` mostra le notifiche del promemoria e, toccandole, apre l'app. Fa anche aprire l'app senza rete: tiene una copia della pagina, delle icone e di `/api/config` (mai di `/api/claude` né dei dati di Supabase). Viene servito sempre aggiornato.
- `src/index.js` aggiunge a ogni risposta gli header di sicurezza. La Content-Security-Policy è attiva: il browser blocca script e collegamenti verso siti non elencati. Se un giorno l'app deve usare un servizio esterno nuovo, va aggiunto lì.

## Provare sul computer
1. `npm install`.
2. Crea un file `.dev.vars` (non va mai nel repository: è in `.gitignore`) con le variabili, una per riga, per esempio `SUPABASE_URL=https://xxxx.supabase.co`. Meglio usare un progetto Supabase di prova.
3. `npm run dev` e apri `http://localhost:8787`.
4. `npm test` prova la cifratura delle notifiche.

## Controllo dopo la pubblicazione
1. Apri `https://<tuo-indirizzo>/api/config`: deve mostrare `url` e `key` compilati.
2. Apri l'app: compare la pagina di accesso.
3. Accedi, registra uno scarto, carica una bolla e controlla che la lettura funzioni.
4. Profilo › Promemoria a fine servizio › Attiva: il telefono chiede il permesso per le notifiche.
5. Per provare subito il promemoria, senza aspettare la sera:
   `curl -X POST "https://<tuo-indirizzo>/api/promemoria?prova=1" -H "Authorization: Bearer <CRON_SECRET>"`.
   La notifica arriva solo se oggi la pizzeria non ha scarti. Senza `?prova=1`, fuori dall'ora del promemoria risponde `fuori_orario`.
6. I log del Worker (errori compresi) sono in **Workers & Pages › spicchio › Observability**.
