-- =====================================================================
-- Permessi dello staff: solo la sezione Scarti
-- Da eseguire dopo supabase-multidispositivo.sql. Si può rieseguire.
--
-- - Lo staff legge solo ciò che serve per registrare gli scarti:
--   ingredienti, ricette, impostazioni (impasto, fine giornata), causali,
--   storico prezzi (per il costo dello scarto) e gli scarti stessi.
-- - Documenti e file (bolle, fatture, spese, da pagare): solo il titolare.
-- - Scarti: lo staff elimina solo i propri e solo entro 48 ore dalla
--   registrazione; il titolare elimina tutto.
-- - Fornitori, articoli, costi fissi, incassi e vendite: solo il titolare.
-- Per le vendite e la lettura AI riesegui anche supabase-vendite.sql e
-- supabase-blocco2.sql.
-- =====================================================================

-- dati: il titolare tutto; lo staff solo ingredienti, ricette e impostazioni
drop policy if exists dati_lettura on public.dati;
create policy dati_lettura on public.dati for select to authenticated
  using (
    ristorante_id in (select public.miei_ristoranti_titolare())
    or (ristorante_id in (select public.miei_ristoranti()) and chiave in ('ingredients', 'pizzas', 'settings'))
  );

-- documenti: solo il titolare li vede, li carica, li modifica e li elimina
drop policy if exists documenti_lettura on public.documenti;
create policy documenti_lettura on public.documenti for select to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists documenti_inserisce on public.documenti;
create policy documenti_inserisce on public.documenti for insert to authenticated
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));
drop policy if exists documenti_modifica on public.documenti;
create policy documenti_modifica on public.documenti for update to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare()))
  with check (ristorante_id in (select public.miei_ristoranti_titolare()));

-- file dei documenti: solo il titolare
drop policy if exists file_lettura on storage.objects;
create policy file_lettura on storage.objects for select to authenticated
  using (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));
drop policy if exists file_inserisce on storage.objects;
create policy file_inserisce on storage.objects for insert to authenticated
  with check (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));
drop policy if exists file_modifica on storage.objects;
create policy file_modifica on storage.objects for update to authenticated
  using (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r))
  with check (bucket_id = 'documenti' and (storage.foldername(name))[1] in (select r::text from public.miei_ristoranti_titolare() r));

-- scarti: il titolare elimina tutto, lo staff i propri delle ultime 48 ore
drop policy if exists scarti_cancella on public.scarti;
create policy scarti_cancella on public.scarti for delete to authenticated
  using (ristorante_id in (select public.miei_ristoranti_titolare())
         or (ristorante_id in (select public.miei_ristoranti()) and creato_da = auth.uid() and creato_il > now() - interval '48 hours'));

-- regole temporanee della prima versione per spostare i file: non servono più
drop policy if exists file_migrazione_lettura on storage.objects;
drop policy if exists file_migrazione_sposta on storage.objects;

-- Controllo: deve restituire 0 righe
select tablename, policyname from pg_policies
where schemaname in ('public', 'storage') and (qual = 'true' or with_check = 'true');
